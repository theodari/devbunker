import { spawn, execSync, type ChildProcess } from "child_process"
import { existsSync, readdirSync, statSync } from "fs"
import path from "path"
import os from "os"
import { Log } from "@/util/log"
import { Config } from "@/config/config"

const log = Log.create({ service: "llama-server" })

const DEVBUNKER_DIR = path.join(os.homedir(), ".devbunker")

const DEFAULTS = {
  port: 8081,
  ctxSize: 8192,
  threads: 8,
}

let child: ChildProcess | undefined
let managedByUs = false

// ---------------------------------------------------------------------------
// VRAM detection
// ---------------------------------------------------------------------------

function detectVramMb(): number {
  try {
    const out = execSync("nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits", {
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim()
    // Take the first GPU (largest if multiple)
    const values = out.split("\n").map((l) => parseInt(l.trim(), 10)).filter((n) => !isNaN(n))
    return values.length > 0 ? Math.max(...values) : 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Auto GPU layers: estimate how many layers fit in VRAM
// ---------------------------------------------------------------------------

// Approximate VRAM per layer (MB) by model size
// overhead includes KV cache (ctx=8192) + compute buffers + safety margin
const LAYER_SIZES: Record<string, { perLayer: number; overhead: number; totalLayers: number }> = {
  "7b":  { perLayer: 90,  overhead: 1500, totalLayers: 32 },
  "14b": { perLayer: 170, overhead: 2000, totalLayers: 48 },
  "32b": { perLayer: 320, overhead: 2500, totalLayers: 64 },
}

function detectModelSize(modelPath: string): string {
  const name = path.basename(modelPath).toLowerCase()
  if (name.includes("32b")) return "32b"
  if (name.includes("14b")) return "14b"
  if (name.includes("7b")) return "7b"
  // Guess from file size
  try {
    const sizeMb = statSync(modelPath).size / (1024 * 1024)
    if (sizeMb > 15000) return "32b"
    if (sizeMb > 6000) return "14b"
    return "7b"
  } catch {
    return "14b"
  }
}

function autoGpuLayers(vramMb: number, modelPath: string): number {
  if (vramMb <= 0) return 0

  const size = detectModelSize(modelPath)
  const info = LAYER_SIZES[size] ?? LAYER_SIZES["14b"]

  // Reserve VRAM for KV cache and OS
  const available = vramMb - info.overhead
  if (available <= 0) return 0

  const layers = Math.min(Math.floor(available / info.perLayer), info.totalLayers)
  return layers
}

// ---------------------------------------------------------------------------
// Binary resolution
// ---------------------------------------------------------------------------

function findBinary(...candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (existsSync(c)) return c
  }
  return undefined
}

function defaultCudaBinary(): string | undefined {
  const ext = process.platform === "win32" ? ".exe" : ""
  return findBinary(
    path.join(DEVBUNKER_DIR, "llama-cuda", "cuda-bin", `llama-server${ext}`),
    path.join(DEVBUNKER_DIR, "llama-cuda", `llama-server${ext}`),
  )
}

function defaultVulkanBinary(): string | undefined {
  const ext = process.platform === "win32" ? ".exe" : ""
  return findBinary(
    path.join(DEVBUNKER_DIR, "llama", `llama-server${ext}`),
    path.join(DEVBUNKER_DIR, "llama-vulkan", `llama-server${ext}`),
  )
}

function defaultModelPath(): string | undefined {
  const modelsDir = path.join(DEVBUNKER_DIR, "models")
  if (!existsSync(modelsDir)) return undefined
  const files = readdirSync(modelsDir).filter((f) => f.endsWith(".gguf"))
  // Prefer largest model (best quality)
  files.sort((a, b) => {
    try {
      return statSync(path.join(modelsDir, b)).size - statSync(path.join(modelsDir, a)).size
    } catch { return 0 }
  })
  return files.length > 0 ? path.join(modelsDir, files[0]) : undefined
}

function resolveBinary(config: any): { binary: string; mode: string } | undefined {
  const cudaPath = config?.llama?.cudaBinary ?? defaultCudaBinary()
  if (cudaPath && existsSync(cudaPath)) return { binary: cudaPath, mode: "CUDA" }

  const vulkanPath = config?.llama?.vulkanBinary ?? defaultVulkanBinary()
  if (vulkanPath && existsSync(vulkanPath)) return { binary: vulkanPath, mode: "Vulkan" }

  // CPU fallback
  if (cudaPath && existsSync(cudaPath)) return { binary: cudaPath, mode: "CPU" }
  if (vulkanPath && existsSync(vulkanPath)) return { binary: vulkanPath, mode: "CPU" }

  return undefined
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

async function isAlreadyRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) {
      const data = await response.json()
      return data?.object === "list" || Array.isArray(data?.data)
    }
  } catch {}
  return false
}

async function waitForReady(port: number, timeoutMs = 90000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isAlreadyRunning(port)) return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

function shouldAutoLaunch(cfg: any): boolean {
  if (cfg?.llama?.enabled === true) return true
  if (cfg?.llama?.enabled === false) return false
  const providers = cfg?.provider ?? {}
  for (const [, p] of Object.entries(providers) as [string, any][]) {
    const url = p?.options?.baseURL ?? ""
    if (url.includes("localhost:8081") || url.includes("127.0.0.1:8081")) return true
  }
  return false
}

export namespace LlamaServer {
  export async function start() {
    const cfg = await Config.global() as any

    if (!shouldAutoLaunch(cfg)) {
      log.info("auto-launch disabled or no local provider configured")
      return
    }

    const port = cfg?.llama?.port ?? DEFAULTS.port

    if (await isAlreadyRunning(port)) {
      log.info("llama-server already running", { port })
      return
    }

    const resolved = resolveBinary(cfg)
    if (!resolved) {
      log.warn("llama-server binary not found. Install it in ~/.devbunker/llama-cuda/ or ~/.devbunker/llama/")
      return
    }

    const modelPath = cfg?.llama?.model ?? defaultModelPath()
    if (!modelPath || !existsSync(modelPath)) {
      log.warn("no GGUF model found", { path: modelPath ?? "~/.devbunker/models/" })
      return
    }

    // Auto-detect VRAM and compute optimal GPU layers
    const vramMb = detectVramMb()
    const autoLayers = autoGpuLayers(vramMb, modelPath)
    const gpuLayers = resolved.mode === "CPU" ? 0 : (cfg?.llama?.gpuLayers ?? autoLayers)
    const ctxSize = cfg?.llama?.ctxSize ?? DEFAULTS.ctxSize
    const threads = cfg?.llama?.threads ?? DEFAULTS.threads
    const modelSize = detectModelSize(modelPath)

    log.info("GPU detection", { vramMb, modelSize, autoLayers, gpuLayers: gpuLayers })

    const args = [
      "--model", modelPath,
      "--port", String(port),
      "--host", "127.0.0.1",
      "--gpu-layers", String(gpuLayers),
      "--ctx-size", String(ctxSize),
      "--threads", String(threads),
    ]

    if (resolved.mode !== "CPU" && gpuLayers > 0) {
      args.push("--flash-attn", "on")
    }

    log.info("starting llama-server", {
      mode: resolved.mode,
      port,
      gpuLayers,
      model: path.basename(modelPath),
      vramMb,
    })

    child = spawn(resolved.binary, args, {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    })

    child.stdout?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trimEnd()
      if (line) log.info(line)
    })

    child.stderr?.on("data", (chunk: Buffer) => {
      const line = chunk.toString().trimEnd()
      if (line) log.info(line)
    })

    child.on("exit", (code) => {
      log.info("llama-server exited", { code })
      child = undefined
      managedByUs = false
    })

    managedByUs = true

    const ready = await waitForReady(port)
    if (ready) {
      log.info("llama-server ready", { mode: resolved.mode, port, gpuLayers })
    } else {
      log.warn("llama-server did not become ready within timeout")
    }
  }

  export async function stop() {
    if (!child || !managedByUs) return

    log.info("stopping llama-server")
    try {
      child.kill()
      await Promise.race([
        new Promise<void>((resolve) => child?.on("exit", resolve)),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ])
      if (child && !child.killed) {
        child.kill("SIGKILL")
      }
    } catch {}
    child = undefined
    managedByUs = false
  }
}
