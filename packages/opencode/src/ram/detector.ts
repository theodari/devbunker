import os from "os"
import { Log } from "../util/log"

export namespace RAM {
  const log = Log.create({ service: "ram" })

  export interface SystemMemory {
    totalGB: number
    availableGB: number
    gpuVramGB?: number
  }

  let cached: SystemMemory | undefined

  export function detect(): SystemMemory {
    if (cached) return cached

    const totalBytes = os.totalmem()
    const freeBytes = os.freemem()

    const result: SystemMemory = {
      totalGB: Math.round((totalBytes / (1024 ** 3)) * 10) / 10,
      availableGB: Math.round((freeBytes / (1024 ** 3)) * 10) / 10,
    }

    log.info("system memory detected", {
      totalGB: result.totalGB,
      availableGB: result.availableGB,
    })

    cached = result
    return result
  }

  export function refresh(): SystemMemory {
    cached = undefined
    return detect()
  }

  /**
   * Estimate the RAM required to run a model based on its parameter count and quantization.
   * Formula: params_billions * bytes_per_param * overhead_factor / 1024^3
   *
   * For Q4 quantization: ~0.5 bytes per parameter + ~2GB overhead
   * For Q5 quantization: ~0.625 bytes per parameter + ~2GB overhead
   * For Q8 quantization: ~1.0 bytes per parameter + ~2GB overhead
   * For FP16: ~2.0 bytes per parameter + ~2GB overhead
   */
  export function estimateModelRAM(params: string, quantization?: string): number {
    const paramsBillions = parseParamCount(params)
    if (paramsBillions === 0) return 0

    const bytesPerParam = getQuantizationBytes(quantization)
    const overheadGB = 2
    const ramGB = (paramsBillions * bytesPerParam) + overheadGB

    return Math.ceil(ramGB * 10) / 10
  }

  function parseParamCount(params: string): number {
    const normalized = params.toUpperCase().trim()
    const match = normalized.match(/^([\d.]+)\s*([BMK]?)$/)
    if (!match) return 0

    const value = parseFloat(match[1])
    const unit = match[2]

    switch (unit) {
      case "B":
      case "":
        return value
      case "M":
        return value / 1000
      case "K":
        return value / 1_000_000
      default:
        return value
    }
  }

  function getQuantizationBytes(quantization?: string): number {
    if (!quantization) return 0.5 // default Q4

    const q = quantization.toUpperCase()
    if (q.startsWith("Q4") || q.includes("4BIT") || q.includes("4_")) return 0.5
    if (q.startsWith("Q5") || q.includes("5BIT") || q.includes("5_")) return 0.625
    if (q.startsWith("Q6") || q.includes("6BIT") || q.includes("6_")) return 0.75
    if (q.startsWith("Q8") || q.includes("8BIT") || q.includes("8_")) return 1.0
    if (q.includes("FP16") || q.includes("F16")) return 2.0
    if (q.includes("FP32") || q.includes("F32")) return 4.0

    return 0.5 // default to Q4
  }

  /**
   * Check if a model can run on the current system.
   * Returns { canRun, requiredGB, availableGB, reason }
   */
  export function checkModel(params: string, quantization?: string): {
    canRun: boolean
    requiredGB: number
    availableGB: number
    reason?: string
  } {
    const mem = detect()
    const requiredGB = estimateModelRAM(params, quantization)

    if (requiredGB === 0) {
      return { canRun: true, requiredGB: 0, availableGB: mem.totalGB }
    }

    const canRun = requiredGB <= mem.totalGB
    return {
      canRun,
      requiredGB,
      availableGB: mem.totalGB,
      reason: canRun
        ? undefined
        : `Requires ~${requiredGB}GB RAM, system has ${mem.totalGB}GB`,
    }
  }
}
