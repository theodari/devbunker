import { BusEvent } from "@/bus/bus-event"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import PROMPT_INITIALIZE from "./template/initialize.txt"
import PROMPT_REVIEW from "./template/review.txt"

// DevBunker: BMAD command templates
import PROMPT_BMAD_CREATE_STORY from "./template/bmad-create-story.txt"
import PROMPT_BMAD_ARCHITECT from "./template/bmad-architect.txt"
import PROMPT_BMAD_GENERATE_TESTS from "./template/bmad-generate-tests.txt"
import PROMPT_BMAD_IMPLEMENT from "./template/bmad-implement.txt"
import PROMPT_BMAD_QA_GATE from "./template/bmad-qa-gate.txt"
import PROMPT_BMAD_VALIDATE_STORY from "./template/bmad-validate-story.txt"
import PROMPT_BMAD_TRACE from "./template/bmad-trace.txt"
import PROMPT_BMAD_INIT from "./template/bmad-init.txt"
import PROMPT_TDD from "./template/tdd.txt"
import PROMPT_TDD_RED from "./template/tdd-red.txt"
import PROMPT_TDD_GREEN from "./template/tdd-green.txt"
import PROMPT_DETECT_TOOLS from "./template/detect-tools.txt"
import { MCP } from "../mcp"
import { Skill } from "../skill"
import { Global } from "../global"
import path from "path"

export namespace Command {
  export const Event = {
    Executed: BusEvent.define(
      "command.executed",
      z.object({
        name: z.string(),
        sessionID: Identifier.schema("session"),
        arguments: z.string(),
        messageID: Identifier.schema("message"),
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      description: z.string().optional(),
      agent: z.string().optional(),
      model: z.string().optional(),
      source: z.enum(["command", "mcp", "skill"]).optional(),
      // workaround for zod not supporting async functions natively so we use getters
      // https://zod.dev/v4/changelog?id=zfunction
      template: z.promise(z.string()).or(z.string()),
      subtask: z.boolean().optional(),
      hints: z.array(z.string()),
    })
    .meta({
      ref: "Command",
    })

  // for some reason zod is inferring `string` for z.promise(z.string()).or(z.string()) so we have to manually override it
  export type Info = Omit<z.infer<typeof Info>, "template"> & { template: Promise<string> | string }

  export function hints(template: string): string[] {
    const result: string[] = []
    const numbered = template.match(/\$\d+/g)
    if (numbered) {
      for (const match of [...new Set(numbered)].sort()) result.push(match)
    }
    if (template.includes("$ARGUMENTS")) result.push("$ARGUMENTS")
    return result
  }

  export const Default = {
    INIT: "init",
    REVIEW: "review",
  } as const

  const state = Instance.state(async () => {
    const cfg = await Config.get()

    const result: Record<string, Info> = {
      [Default.INIT]: {
        name: Default.INIT,
        description: "create/update AGENTS.md",
        source: "command",
        get template() {
          return PROMPT_INITIALIZE.replace("${path}", Instance.worktree)
        },
        hints: hints(PROMPT_INITIALIZE),
      },
      [Default.REVIEW]: {
        name: Default.REVIEW,
        description: "review changes [commit|branch|pr], defaults to uncommitted",
        source: "command",
        get template() {
          return PROMPT_REVIEW.replace("${path}", Instance.worktree)
        },
        subtask: true,
        hints: hints(PROMPT_REVIEW),
      },

      // ── DevBunker: BMAD Commands ──────────────────────────────────

      "create-story": {
        name: "create-story",
        description: "BMAD: Create a user story from a requirement",
        agent: "bmad-analyst",
        source: "command",
        get template() {
          return PROMPT_BMAD_CREATE_STORY
        },
        hints: hints(PROMPT_BMAD_CREATE_STORY),
      },

      architect: {
        name: "architect",
        description: "BMAD: Design technical architecture for a story",
        agent: "bmad-architect",
        source: "command",
        get template() {
          return PROMPT_BMAD_ARCHITECT
        },
        hints: hints(PROMPT_BMAD_ARCHITECT),
      },

      "generate-tests": {
        name: "generate-tests",
        description: "BMAD: Generate tests from specs (TDD-first, no code access)",
        agent: "bmad-qa",
        source: "command",
        get template() {
          return PROMPT_BMAD_GENERATE_TESTS
        },
        hints: hints(PROMPT_BMAD_GENERATE_TESTS),
      },

      implement: {
        name: "implement",
        description: "BMAD: Implement code to make failing tests pass",
        agent: "bmad-dev",
        source: "command",
        get template() {
          return PROMPT_BMAD_IMPLEMENT
        },
        hints: hints(PROMPT_BMAD_IMPLEMENT),
      },

      "qa-gate": {
        name: "qa-gate",
        description: "BMAD: Check test status (RED/GREEN/MIXED phase)",
        agent: "bmad-qa",
        source: "command",
        get template() {
          return PROMPT_BMAD_QA_GATE
        },
        hints: hints(PROMPT_BMAD_QA_GATE),
      },

      "validate-story": {
        name: "validate-story",
        description: "BMAD: Validate a story against acceptance criteria",
        agent: "bmad-po",
        source: "command",
        get template() {
          return PROMPT_BMAD_VALIDATE_STORY
        },
        hints: hints(PROMPT_BMAD_VALIDATE_STORY),
      },

      "trace-requirements": {
        name: "trace-requirements",
        description: "BMAD: Build traceability matrix (Spec→Story→Test→Code)",
        source: "command",
        get template() {
          return PROMPT_BMAD_TRACE
        },
        hints: hints(PROMPT_BMAD_TRACE),
      },

      "bmad-init": {
        name: "bmad-init",
        description: "BMAD: Initialize project structure (docs/, tests/ directories)",
        source: "command",
        get template() {
          return PROMPT_BMAD_INIT
        },
        hints: hints(PROMPT_BMAD_INIT),
      },

      tdd: {
        name: "tdd",
        description: "TDD-first full workflow (RED → validate → GREEN)",
        source: "command",
        get template() {
          return PROMPT_TDD
        },
        hints: hints(PROMPT_TDD),
      },

      "tdd-red": {
        name: "tdd-red",
        description: "TDD Step 1: Write tests from specs (RED phase — no source code access)",
        source: "command",
        get template() {
          return PROMPT_TDD_RED
        },
        hints: hints(PROMPT_TDD_RED),
      },

      "tdd-green": {
        name: "tdd-green",
        description: "TDD Step 2: Implement code to pass failing tests (GREEN phase)",
        source: "command",
        get template() {
          return PROMPT_TDD_GREEN
        },
        hints: hints(PROMPT_TDD_GREEN),
      },

      "detect-tools": {
        name: "detect-tools",
        description: "Scan this machine for compilers, Qt, build tools, and save globally",
        source: "command",
        get template() {
          const toolchainFile = path.join(Global.Path.home, ".devbunker", "toolchain.json")
          return PROMPT_DETECT_TOOLS.replace("$TOOLCHAIN_FILE", toolchainFile)
        },
        hints: [],
      },
    }

    for (const [name, command] of Object.entries(cfg.command ?? {})) {
      result[name] = {
        name,
        agent: command.agent,
        model: command.model,
        description: command.description,
        source: "command",
        get template() {
          return command.template
        },
        subtask: command.subtask,
        hints: hints(command.template),
      }
    }
    for (const [name, prompt] of Object.entries(await MCP.prompts())) {
      result[name] = {
        name,
        source: "mcp",
        description: prompt.description,
        get template() {
          // since a getter can't be async we need to manually return a promise here
          return new Promise<string>(async (resolve, reject) => {
            const template = await MCP.getPrompt(
              prompt.client,
              prompt.name,
              prompt.arguments
                ? // substitute each argument with $1, $2, etc.
                  Object.fromEntries(prompt.arguments?.map((argument, i) => [argument.name, `$${i + 1}`]))
                : {},
            ).catch(reject)
            resolve(
              template?.messages
                .map((message) => (message.content.type === "text" ? message.content.text : ""))
                .join("\n") || "",
            )
          })
        },
        hints: prompt.arguments?.map((_, i) => `$${i + 1}`) ?? [],
      }
    }

    // Add skills as invokable commands
    for (const skill of await Skill.all()) {
      // Skip if a command with this name already exists
      if (result[skill.name]) continue
      result[skill.name] = {
        name: skill.name,
        description: skill.description,
        source: "skill",
        get template() {
          return skill.content
        },
        hints: [],
      }
    }

    return result
  })

  export async function get(name: string) {
    return state().then((x) => x[name])
  }

  export async function list() {
    return state().then((x) => Object.values(x))
  }
}
