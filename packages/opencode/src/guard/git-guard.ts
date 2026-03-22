import { Log } from "../util/log"
import { Config } from "../config/config"
import { GuardLog } from "./guard-log"

export namespace GitGuard {
  const log = Log.create({ service: "guard:git" })

  export type CheckResult = {
    allowed: boolean
    reason?: string
  }

  /**
   * Check if a git command is allowed based on DevBunker config.
   * Focuses on remote operations (push, remote add/set-url).
   */
  export async function check(command: string): Promise<CheckResult> {
    const trimmed = command.trim()

    // Only care about git commands
    if (!trimmed.startsWith("git ")) {
      return { allowed: true }
    }

    const config = await Config.get()
    const gitConfig = (config as any).git ?? {}
    const allowedRemotes: string[] = gitConfig.allowedRemotes ?? []
    const blockForce = gitConfig.blockForce !== false // default true
    const secretScan = gitConfig.secretScan !== false // default true

    // Check for force push
    if (blockForce && isForceOp(trimmed)) {
      const reason = "Force push is blocked in DevBunker (git.blockForce=true)"
      log.warn("BLOCK", { command: trimmed, reason })
      GuardLog.write({ guard: "git", decision: "block", target: trimmed, reason })
      return { allowed: false, reason }
    }

    // Check for git config --global
    if (/git\s+config\s+--global/.test(trimmed)) {
      const reason = "Modifying global git config is blocked in DevBunker"
      log.warn("BLOCK", { command: trimmed, reason })
      GuardLog.write({ guard: "git", decision: "block", target: trimmed, reason })
      return { allowed: false, reason }
    }

    // Check push against remote whitelist
    if (/git\s+push\b/.test(trimmed)) {
      return checkPush(trimmed, allowedRemotes)
    }

    // Check remote add/set-url
    if (/git\s+remote\s+(add|set-url)\b/.test(trimmed)) {
      return checkRemoteModification(trimmed, allowedRemotes)
    }

    return { allowed: true }
  }

  function isForceOp(command: string): boolean {
    return /git\s+push\s+.*(?:--force\b|-f\b)/.test(command)
      || /git\s+push\s+-[a-zA-Z]*f/.test(command)
  }

  function checkPush(command: string, allowedRemotes: string[]): CheckResult {
    // If no whitelist configured, all pushes require confirmation but are allowed
    if (allowedRemotes.length === 0) {
      log.info("ALLOW", { command, reason: "no remote whitelist configured" })
      return { allowed: true }
    }

    // Extract remote name from push command
    // git push origin main → "origin"
    const match = command.match(/git\s+push\s+(\S+)/)
    const remoteName = match ? match[1] : "origin"

    // Check if remote matches whitelist patterns
    if (matchesWhitelist(remoteName, allowedRemotes)) {
      log.info("ALLOW", { command, remote: remoteName })
      return { allowed: true }
    }

    const reason = `Remote '${remoteName}' is not in the allowed remotes list. Allowed: ${allowedRemotes.join(", ")}`
    log.warn("BLOCK", { command, remote: remoteName, reason })
    GuardLog.write({ guard: "git", decision: "block", target: command, reason })
    return { allowed: false, reason }
  }

  function checkRemoteModification(command: string, allowedRemotes: string[]): CheckResult {
    if (allowedRemotes.length === 0) {
      return { allowed: true }
    }

    // Extract URL from remote add/set-url
    const urlMatch = command.match(/git\s+remote\s+(?:add|set-url)\s+\S+\s+(\S+)/)
    const url = urlMatch ? urlMatch[1] : null

    if (!url) {
      return { allowed: true }
    }

    if (matchesWhitelist(url, allowedRemotes)) {
      log.info("ALLOW", { command, url })
      return { allowed: true }
    }

    const reason = `Remote URL '${url}' is not in the allowed remotes list`
    log.warn("BLOCK", { command, url, reason })
    GuardLog.write({ guard: "git", decision: "block", target: command, reason })
    return { allowed: false, reason }
  }

  /**
   * Match a remote name or URL against whitelist patterns.
   * Supports glob-like patterns with * wildcard.
   */
  function matchesWhitelist(value: string, patterns: string[]): boolean {
    for (const pattern of patterns) {
      if (pattern === "*") return true
      if (pattern === value) return true

      // Convert glob to regex
      const regex = new RegExp(
        "^" + pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$"
      )
      if (regex.test(value)) return true
    }
    return false
  }

  /**
   * Assert that a git command is allowed. Throws if blocked.
   */
  export async function assert(command: string): Promise<void> {
    const result = await check(command)
    if (!result.allowed) {
      throw new Error(`[DevBunker Guard] ${result.reason}`)
    }
  }
}
