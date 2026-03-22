import * as fs from "fs/promises"
import * as path from "path"
import { Instance } from "../project/instance"
import { Log } from "../util/log"

export namespace GuardLog {
  const log = Log.create({ service: "guard-log" })

  export type Decision = "allow" | "confirm" | "block" | "warn"

  export interface Entry {
    timestamp: string
    guard: "filesystem" | "shell" | "git" | "secret"
    decision: Decision
    target: string // filepath or command
    reason?: string
    details?: Record<string, any>
  }

  const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

  function logDir(): string {
    return path.join(Instance.worktree, ".devbunker", "logs")
  }

  function logFile(): string {
    return path.join(logDir(), "guard.jsonl")
  }

  export async function write(entry: Omit<Entry, "timestamp">) {
    const full: Entry = {
      ...entry,
      timestamp: new Date().toISOString(),
    }
    try {
      const dir = logDir()
      await fs.mkdir(dir, { recursive: true })
      const file = logFile()
      const line = JSON.stringify(full) + "\n"

      // Check file size and rotate if needed
      try {
        const stat = await fs.stat(file)
        if (stat.size > MAX_FILE_SIZE) {
          await rotate(file)
        }
      } catch {
        // File doesn't exist yet, that's fine
      }

      await fs.appendFile(file, line, "utf-8")
    } catch (e) {
      log.error("failed to write guard log", { error: e })
    }
  }

  async function rotate(file: string) {
    try {
      const content = await fs.readFile(file, "utf-8")
      const lines = content.split("\n").filter(Boolean)
      // Keep the last 50% of entries
      const keep = lines.slice(Math.floor(lines.length / 2))
      await fs.writeFile(file, keep.join("\n") + "\n", "utf-8")
    } catch (e) {
      log.error("failed to rotate guard log", { error: e })
    }
  }

  export async function query(options?: {
    guard?: Entry["guard"]
    decision?: Decision
    limit?: number
    since?: string // ISO date string
  }): Promise<Entry[]> {
    try {
      const content = await fs.readFile(logFile(), "utf-8")
      let entries: Entry[] = content
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as Entry
          } catch {
            return null
          }
        })
        .filter((e): e is Entry => e !== null)

      if (options?.guard) {
        entries = entries.filter((e) => e.guard === options.guard)
      }
      if (options?.decision) {
        entries = entries.filter((e) => e.decision === options.decision)
      }
      if (options?.since) {
        entries = entries.filter((e) => e.timestamp >= options.since!)
      }

      // Return most recent first
      entries.reverse()

      if (options?.limit) {
        entries = entries.slice(0, options.limit)
      }

      return entries
    } catch {
      return []
    }
  }

  export async function summary(): Promise<{
    total: number
    byGuard: Record<string, number>
    byDecision: Record<string, number>
    recentBlocks: Entry[]
  }> {
    const all = await query()
    const byGuard: Record<string, number> = {}
    const byDecision: Record<string, number> = {}

    for (const entry of all) {
      byGuard[entry.guard] = (byGuard[entry.guard] || 0) + 1
      byDecision[entry.decision] = (byDecision[entry.decision] || 0) + 1
    }

    const recentBlocks = all.filter((e) => e.decision === "block").slice(0, 10)

    return { total: all.length, byGuard, byDecision, recentBlocks }
  }
}
