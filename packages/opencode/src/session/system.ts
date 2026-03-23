import { Instance } from "../project/instance"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import path from "path"
import PROMPT_LOCAL from "./prompt/qwen.txt"
import type { Provider } from "@/provider/provider"

// Load toolchain cache (global, shared across all projects)
let toolchainCache: string | undefined
async function loadToolchain(): Promise<string> {
  if (toolchainCache !== undefined) return toolchainCache
  const file = path.join(Global.Path.home, ".devbunker", "toolchain.json")
  try {
    const raw = await Filesystem.readText(file)
    const data = JSON.parse(raw)
    const lines: string[] = []
    const add = (category: string, entries: Record<string, any>) => {
      for (const [name, info] of Object.entries(entries ?? {})) {
        if (!info) continue
        const ver = info.version ? ` (${info.version})` : ""
        lines.push(`  ${name}: ${info.path}${ver}`)
      }
    }
    lines.push("<toolchain>")
    add("compilers", data.compilers)
    if (data.qt?.path) lines.push(`  qt: ${data.qt.path} (${data.qt.version ?? "?"}, kit: ${data.qt.kit ?? "?"})`)
    add("build", data.build)
    add("languages", data.languages)
    add("tools", data.tools)
    lines.push("</toolchain>")
    toolchainCache = lines.length > 2 ? lines.join("\n") : ""
  } catch {
    toolchainCache = ""
  }
  return toolchainCache
}

export namespace SystemPrompt {
  export function instructions() {
    return PROMPT_LOCAL.trim()
  }

  export function provider(_model: Provider.Model) {
    return [PROMPT_LOCAL]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    const toolchain = await loadToolchain()

    const parts = [
      `You are powered by ${model.api.id} (${model.providerID}/${model.api.id}).`,
      `<env>`,
      `  Working directory: ${Instance.directory}`,
      `  Git repo: ${project.vcs === "git" ? "yes" : "no"}`,
      `  Platform: ${process.platform}`,
      `  Date: ${new Date().toDateString()}`,
      `</env>`,
    ]

    if (toolchain) {
      parts.push(toolchain)
    }

    return [parts.join("\n")]
  }

  // Reset cache (called when /detect-tools runs)
  export function resetToolchainCache() {
    toolchainCache = undefined
  }
}
