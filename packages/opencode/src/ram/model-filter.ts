import { RAM } from "./detector"
import { Log } from "../util/log"

export namespace ModelFilter {
  const log = Log.create({ service: "model-filter" })

  /**
   * Known model parameter sizes for common Ollama models.
   * Used to estimate RAM requirements when the model name contains size hints.
   */
  const KNOWN_PATTERNS: Array<{ pattern: RegExp; params: string; quant?: string }> = [
    // Explicit size in model name (most common in Ollama)
    { pattern: /(\d+\.?\d*)b/i, params: "$1B" },

    // Well-known model families with known sizes
    { pattern: /^llama-?3\.?3[-:].*70b/i, params: "70B" },
    { pattern: /^llama-?3\.?[12][-:].*8b/i, params: "8B" },
    { pattern: /^llama-?3\.?[12][-:].*70b/i, params: "70B" },
    { pattern: /^mistral[-:].*7b/i, params: "7B" },
    { pattern: /^mixtral[-:].*8x7b/i, params: "47B" },
    { pattern: /^mixtral[-:].*8x22b/i, params: "141B" },
    { pattern: /^phi-?4[-:].*14b/i, params: "14B" },
    { pattern: /^phi-?3[-:].*mini/i, params: "3.8B" },
    { pattern: /^phi-?3[-:].*medium/i, params: "14B" },
    { pattern: /^gemma-?2[-:].*2b/i, params: "2B" },
    { pattern: /^gemma-?2[-:].*9b/i, params: "9B" },
    { pattern: /^gemma-?2[-:].*27b/i, params: "27B" },
    { pattern: /^qwen-?3[-:].*0\.6b/i, params: "0.6B" },
    { pattern: /^qwen-?3[-:].*1\.7b/i, params: "1.7B" },
    { pattern: /^qwen-?3[-:].*4b/i, params: "4B" },
    { pattern: /^qwen-?3[-:].*8b/i, params: "8B" },
    { pattern: /^qwen-?3[-:].*14b/i, params: "14B" },
    { pattern: /^qwen-?3[-:].*32b/i, params: "32B" },
    { pattern: /^qwen-?3[-:].*72b/i, params: "72B" },
    { pattern: /^qwen-?3[-:].*235b/i, params: "235B" },
    { pattern: /^qwen-?3[-:].*coder/i, params: "32B" },
    { pattern: /^deepseek[-:].*r1[-:].*1\.5b/i, params: "1.5B" },
    { pattern: /^deepseek[-:].*r1[-:].*7b/i, params: "7B" },
    { pattern: /^deepseek[-:].*r1[-:].*8b/i, params: "8B" },
    { pattern: /^deepseek[-:].*r1[-:].*14b/i, params: "14B" },
    { pattern: /^deepseek[-:].*r1[-:].*32b/i, params: "32B" },
    { pattern: /^deepseek[-:].*r1[-:].*70b/i, params: "70B" },
    { pattern: /^deepseek[-:].*r1[-:].*671b/i, params: "671B" },
    { pattern: /^codestral[-:].*22b/i, params: "22B" },
    { pattern: /^starcoder/i, params: "15B" },
    { pattern: /^codellama[-:].*7b/i, params: "7B" },
    { pattern: /^codellama[-:].*13b/i, params: "13B" },
    { pattern: /^codellama[-:].*34b/i, params: "34B" },
    { pattern: /^codellama[-:].*70b/i, params: "70B" },
    { pattern: /^command-r[-:].*35b/i, params: "35B" },
    { pattern: /^command-r[-:].*104b/i, params: "104B" },
  ]

  /**
   * Extract quantization from model name (Ollama convention).
   * Examples: "llama3.1:8b-q4_K_M" → "Q4_K_M"
   */
  function extractQuantization(modelName: string): string | undefined {
    const match = modelName.match(/[:-](q\d[_\w]*|f(?:p)?(?:16|32))/i)
    return match ? match[1] : undefined
  }

  /**
   * Extract parameter count from model name.
   * Examples: "llama3.1:8b" → "8B", "qwen3:32b-q4_K_M" → "32B"
   */
  function extractParamCount(modelName: string): string | undefined {
    // Try explicit NB patterns first
    const explicit = modelName.match(/(\d+\.?\d*)\s*b(?:[-_:]|$)/i)
    if (explicit) return `${explicit[1]}B`

    // Try known model patterns
    for (const known of KNOWN_PATTERNS) {
      const match = modelName.match(known.pattern)
      if (match) {
        // If params contains $1, replace with capture group
        if (known.params.includes("$1") && match[1]) {
          return known.params.replace("$1", match[1])
        }
        return known.params
      }
    }

    return undefined
  }

  export interface FilteredModel {
    modelID: string
    canRun: boolean
    requiredGB: number
    availableGB: number
    reason?: string
    params?: string
    quantization?: string
  }

  /**
   * Filter a model by checking if it can run on the current system.
   */
  export function check(modelID: string): FilteredModel {
    const params = extractParamCount(modelID)
    const quantization = extractQuantization(modelID)

    if (!params) {
      // Can't determine size — allow it (user configured it manually)
      const mem = RAM.detect()
      return {
        modelID,
        canRun: true,
        requiredGB: 0,
        availableGB: mem.totalGB,
        params: undefined,
        quantization,
      }
    }

    const result = RAM.checkModel(params, quantization)

    log.info("model filter", {
      modelID,
      params,
      quantization,
      canRun: result.canRun,
      requiredGB: result.requiredGB,
    })

    return {
      modelID,
      ...result,
      params,
      quantization,
    }
  }

  /**
   * Filter a list of model IDs and annotate each with RAM compatibility.
   */
  export function filterAll(modelIDs: string[]): FilteredModel[] {
    return modelIDs.map(check)
  }
}
