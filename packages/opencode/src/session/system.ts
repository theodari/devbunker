import { Instance } from "../project/instance"
import PROMPT_LOCAL from "./prompt/qwen.txt"
import type { Provider } from "@/provider/provider"

export namespace SystemPrompt {
  export function instructions() {
    return PROMPT_LOCAL.trim()
  }

  export function provider(_model: Provider.Model) {
    return [PROMPT_LOCAL]
  }

  export async function environment(model: Provider.Model) {
    const project = Instance.project
    return [
      [
        `You are powered by ${model.api.id} (${model.providerID}/${model.api.id}).`,
        `<env>`,
        `  Working directory: ${Instance.directory}`,
        `  Git repo: ${project.vcs === "git" ? "yes" : "no"}`,
        `  Platform: ${process.platform}`,
        `  Date: ${new Date().toDateString()}`,
        `</env>`,
      ].join("\n"),
    ]
  }
}
