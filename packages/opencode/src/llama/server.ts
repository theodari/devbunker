import { spawn, type ChildProcess } from "child_process"
import { existsSync } from "fs"
import path from "path"
import os from "os"
import { Log } from "@/util/log"
import { Config } from "@/config/config"

const log = Log.create({ service: "llama-server" })

const DEVBUNKER_DIR = path.join(os.homedir(), ".devbunker")

const DEFAULTS = {
  port: 8081,
  gpuLayers: 18,
  ctxSize: 8192,
  threads: 8,
}

let child: ChildProcess | undefined
let managedByUs = false

function defaultCudaBinary(): string {
  const ext = process.platform === "win32" ? ".exe" : ""
  return path.join(DEVBUNKER_DIR, "llama-cuda", "cuda-bin", `llama-server${ext}`)
}

function defaultVulkanBinary(): string {
  const ext = process.platform === "win32" ? ".exe" : ""
  return path.join(DEVBUNKER_DIR, "llama", `llama-server${ext}`)
}

function defaultModelPath(): string | undefined {
  const modelsDir = path.join(DEVBUNKER_DIR, "models")
  if (!existsSync(modelsDir)) return undefined
  const { readdirSync } = require("fs")
  const files = (readdirSync(modelsDir) as string[]).filter((f: string) => f.endsWith(".gguf"))
  return files.length > 0 ? path.join(modelsDir, files[0]) : undefined
}

function resolveBinary(config: any): { binary: string; mode: string } | undefined {
  const cudaPath = config?.llama?.cudaBinary ?? defaultCudaBinary()
  if (existsSync(cudaPath)) return { binary: cudaPath, mode: "CUDA" }

  const vulkanPath = config?.llama?.vulkanBinary ?? defaultVulkanBinary()
  if (existsSync(vulkanPath)) return { binary: vulkanPath, mode: "Vulkan" }

  // CPU fallback: use whichever binary exists, with 0 gpu layers
  if (existsSync(cudaPath)) return { binary: cudaPath, mode: "CPU" }
  if (existsSync(vulkanPath)) return { binary: vulkanPath, mode: "CPU" }

  return undefined
}

async function isAlreadyRunning(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, {
      signal: AbortSignal.timeout(2000),
    })
    if (response.ok) {
      const data = await response.json()
      return data?.object === "list" || Array.isArray(data?.data)
    }
  } catch {
    // not running
  }
  return false
}

async function waitForReady(port: number, timeoutMs = 60000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isAlreadyRunning(port)) return true
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

function shouldAutoLaunch(cfg: any): boolean {
  // Explicit config
  if (cfg?.llama?.enabled === true) return true
  if (cfg?.llama?.enabled === false) return false
  // Auto-detect: if there's a provider with baseURL pointing to localhost:8081
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

    const gpuLayers = resolved.mode === "CPU" ? 0 : (cfg?.llama?.gpuLayers ?? DEFAULTS.gpuLayers)
    const ctxSize = cfg?.llama?.ctxSize ?? DEFAULTS.ctxSize
    const threads = cfg?.llama?.threads ?? DEFAULTS.threads

    const args = [
      "--model", modelPath,
      "--port", String(port),
      "--host", "127.0.0.1",
      "--gpu-layers", String(gpuLayers),
      "--ctx-size", String(ctxSize),
      "--threads", String(threads),
    ]

    if (resolved.mode !== "CPU") {
      args.push("--flash-attn", "on")
    }

    log.info("starting llama-server", { mode: resolved.mode, port, gpuLayers, model: path.basename(modelPath) })

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
      log.info("llama-server ready", { mode: resolved.mode, port })
    } else {
      log.warn("llama-server did not become ready within timeout")
    }
  }

  export async function stop() {
    if (!child || !managedByUs) return

    log.info("stopping llama-server")
    try {
      child.kill()
      // Wait up to 5s for graceful exit
      await Promise.race([
        new Promise<void>((resolve) => child?.on("exit", resolve)),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ])
      if (child && !child.killed) {
        child.kill("SIGKILL")
      }
    } catch {
      // already dead
    }
    child = undefined
    managedByUs = false
  }
}
