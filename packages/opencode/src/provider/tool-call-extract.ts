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

// Strip markdown code fences from text
function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?\s*([\s\S]*?)\s*```/g, "$1").trim()
}

function parseToolCallsFromText(text: string): ExtractedToolCall[] {
  const results: ExtractedToolCall[] = []

  // 1. Try tagged patterns first
  for (const pattern of TOOL_CALL_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(text)) !== null) {
      const tc = tryParseToolCall(match[1])
      if (tc) results.push(tc)
    }
    if (results.length > 0) return results
  }

  // 2. Strip markdown code fences (```json ... ```) then try raw JSON
  const stripped = stripCodeFences(text)
  if (stripped.startsWith("{") && stripped.endsWith("}")) {
    const tc = tryParseToolCall(stripped)
    if (tc) return [tc]
  }

  // 3. Try raw JSON without stripping
  const trimmed = text.trim()
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    const tc = tryParseToolCall(trimmed)
    if (tc) return [tc]
  }

  // 4. Try JSON array of tool calls
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
    } catch {
      // not valid JSON array
    }
  }

  return results
}

// Remove tool call content from text, keeping any surrounding content
function stripToolCallContent(text: string, toolCalls: ExtractedToolCall[]): string {
  let result = text
  // Remove tagged tool calls
  for (const pattern of TOOL_CALL_PATTERNS) {
    pattern.lastIndex = 0
    result = result.replace(pattern, "")
  }
  // Remove markdown code fences containing tool calls
  result = result.replace(/```(?:json)?\s*\{[\s\S]*?\}\s*```/g, "")
  // If the entire text was a raw JSON tool call, return empty
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
      for (const part of parts) {
        controller.enqueue(part)
      }
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
 * This handles local models (Qwen2.5, etc.) served via llama-server.
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
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
      }

      // Check if stream already has proper tool calls
      const hasNativeToolCalls = parts.some((p) => p.type === "tool-input-start")
      if (hasNativeToolCalls) {
        return { ...result, stream: arrayToStream(parts) }
      }

      // Accumulate text
      let fullText = ""
      for (const part of parts) {
        if (part.type === "text-delta") {
          fullText += part.delta
        }
      }

      // Try to extract tool calls from text
      const toolCalls = parseToolCallsFromText(fullText)
      if (toolCalls.length === 0) {
        // No tool calls found — pass through unchanged
        return { ...result, stream: arrayToStream(parts) }
      }

      log.info("extracted tool calls from text", {
        count: toolCalls.length,
        tools: toolCalls.map((tc) => tc.name),
      })

      // Build replacement stream
      const newParts: LanguageModelV2StreamPart[] = []

      // Keep stream-start and response-metadata
      for (const part of parts) {
        if (part.type === "stream-start" || part.type === "response-metadata" || part.type === "raw") {
          newParts.push(part)
        }
      }

      // Emit remaining text (before tool call tags) if any
      const remainingText = stripToolCallContent(fullText, toolCalls)
      if (remainingText) {
        const textId = "text-0"
        newParts.push({ type: "text-start", id: textId })
        newParts.push({ type: "text-delta", id: textId, delta: remainingText })
        newParts.push({ type: "text-end", id: textId })
      }

      // Emit tool call parts (input stream + tool-call event)
      for (const tc of toolCalls) {
        const id = generateToolCallId()
        const argsStr = JSON.stringify(tc.arguments)
        newParts.push({ type: "tool-input-start", id, toolName: tc.name })
        newParts.push({ type: "tool-input-delta", id, delta: argsStr })
        newParts.push({ type: "tool-input-end", id })
        // Emit the tool-call event that triggers actual execution
        newParts.push({ type: "tool-call", toolCallId: id, toolName: tc.name, input: argsStr } as LanguageModelV2StreamPart)
      }

      // Emit finish with tool-calls reason
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
