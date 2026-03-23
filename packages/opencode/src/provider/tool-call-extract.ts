import type { LanguageModelV2Middleware, LanguageModelV2StreamPart } from "@ai-sdk/provider"
import { Log } from "@/util/log"

const log = Log.create({ service: "tool-call-extract" })

// Patterns for tool calls embedded in text by local models (Qwen2.5, Hermes, etc.)
const TOOL_CALL_PATTERNS = [
  /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g,
  /<function-call>\s*([\s\S]*?)\s*<\/function-call>/g,
  /<function>\s*([\s\S]*?)\s*<\/function>/g,
  /<response>\s*([\s\S]*?)\s*<\/response>/g,
]

// Quick check: does text potentially contain a tool call?
// Avoids full parsing for pure text responses.
const QUICK_INDICATORS = ['"name"', "<tool_call>", "<function-call>", "<function>", "<response>", "```json"]

interface ExtractedToolCall {
  name: string
  arguments: Record<string, unknown>
}

function tryParseToolCall(json: string): ExtractedToolCall | undefined {
  try {
    const parsed = JSON.parse(json)
    const name = parsed.name ?? parsed.function?.name
    const args = parsed.arguments ?? parsed.function?.arguments ?? {}
    if (name && typeof name === "string") {
      return { name, arguments: typeof args === "string" ? JSON.parse(args) : args }
    }
  } catch {
    // Invalid JSON
  }
  return undefined
}

function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, "$1").trim()
}

function parseToolCallsFromText(text: string): ExtractedToolCall[] {
  const results: ExtractedToolCall[] = []

  // 1. Tagged patterns
  for (const pattern of TOOL_CALL_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      const tc = tryParseToolCall(match[1])
      if (tc) results.push(tc)
    }
    if (results.length > 0) return results
  }

  // 2. Markdown code fences
  const stripped = stripCodeFences(text)
  if (stripped.startsWith("{") && stripped.endsWith("}")) {
    const tc = tryParseToolCall(stripped)
    if (tc) return [tc]
  }

  // 3. Raw JSON
  const trimmed = text.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const tc = tryParseToolCall(trimmed)
    if (tc) return [tc]
  }

  // 4. JSON array
  const arrText = stripped.startsWith("[") ? stripped : trimmed
  if (arrText.startsWith("[") && arrText.endsWith("]")) {
    try {
      const arr = JSON.parse(arrText)
      if (Array.isArray(arr)) {
        for (const item of arr) {
          const tc = tryParseToolCall(JSON.stringify(item))
          if (tc) results.push(tc)
        }
      }
    } catch {}
  }

  return results
}

function stripToolCallContent(text: string, toolCalls: ExtractedToolCall[]): string {
  let result = text
  for (const pattern of TOOL_CALL_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, "")
  }
  result = result.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, "")
  const trimmed = result.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const tc = tryParseToolCall(trimmed)
    if (tc && toolCalls.some((t) => t.name === tc.name)) return ""
  }
  return result.trim()
}

function arrayToStream(parts: LanguageModelV2StreamPart[]): ReadableStream<LanguageModelV2StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
}

let callCounter = 0
function generateToolCallId(): string {
  return `call_local_${Date.now()}_${callCounter++}`
}

/**
 * Middleware that extracts tool calls from text content when the LLM server
 * doesn't return them in the proper OpenAI tool_calls format.
 *
 * Optimized: skips buffering entirely when the stream already has native
 * tool calls or when text doesn't contain any tool call indicators.
 */
export function extractToolCallMiddleware(): LanguageModelV2Middleware {
  return {
    middlewareVersion: "v2" as const,
    async wrapStream({ doStream }) {
      const result = await doStream()
      const originalStream = result.stream

      // Collect all stream parts
      const parts: LanguageModelV2StreamPart[] = []
      const reader = originalStream.getReader()
      let hasNativeToolCalls = false
      let fullText = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
        if (value.type === "tool-input-start") hasNativeToolCalls = true
        if (value.type === "text-delta") fullText += value.delta
      }

      // Fast path: native tool calls already present
      if (hasNativeToolCalls) {
        return { ...result, stream: arrayToStream(parts) }
      }

      // Fast path: no indicators of a tool call in text — pass through immediately
      if (!QUICK_INDICATORS.some((ind) => fullText.includes(ind))) {
        return { ...result, stream: arrayToStream(parts) }
      }

      // Slow path: parse tool calls from text
      const toolCalls = parseToolCallsFromText(fullText)
      if (toolCalls.length === 0) {
        return { ...result, stream: arrayToStream(parts) }
      }

      log.info("extracted tool calls from text", {
        count: toolCalls.length,
        tools: toolCalls.map((tc) => tc.name),
      })

      // Build replacement stream
      const newParts: LanguageModelV2StreamPart[] = []

      // Keep metadata parts
      for (const part of parts) {
        if (part.type === "stream-start" || part.type === "response-metadata" || part.type === "raw") {
          newParts.push(part)
        }
      }

      // Emit remaining text if any
      const remainingText = stripToolCallContent(fullText, toolCalls)
      if (remainingText) {
        const textId = "text-0"
        newParts.push({ type: "text-start", id: textId })
        newParts.push({ type: "text-delta", id: textId, delta: remainingText })
        newParts.push({ type: "text-end", id: textId })
      }

      // Emit tool call events
      for (const tc of toolCalls) {
        const id = generateToolCallId()
        const argsStr = JSON.stringify(tc.arguments)
        newParts.push({ type: "tool-input-start", id, toolName: tc.name })
        newParts.push({ type: "tool-input-delta", id, delta: argsStr })
        newParts.push({ type: "tool-input-end", id })
        newParts.push({ type: "tool-call", toolCallId: id, toolName: tc.name, input: argsStr } as LanguageModelV2StreamPart)
      }

      // Finish with tool-calls reason
      const originalFinish = parts.find((p) => p.type === "finish")
      if (originalFinish && originalFinish.type === "finish") {
        newParts.push({
          type: "finish",
          usage: originalFinish.usage,
          finishReason: "tool-calls",
          providerMetadata: originalFinish.providerMetadata,
        })
      }

      return { ...result, stream: arrayToStream(newParts) }
    },
  }
}
