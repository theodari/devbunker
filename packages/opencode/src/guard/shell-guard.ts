import { Log } from "../util/log"

export namespace ShellGuard {
  const log = Log.create({ service: "guard:shell" })

  export type Decision = "allow" | "confirm" | "block"
  export type CheckResult = {
    decision: Decision
    reason?: string
    command: string
  }

  /** Commands always allowed (exact binary name match) */
  const WHITELIST = new Set([
    // Build
    "make", "cmake", "cargo", "go", "npm", "npx", "bun", "bunx",
    "dotnet", "qmake", "msbuild", "gradle", "mvn", "tsc", "esbuild",
    "vite", "webpack", "rollup", "turbo",
    // Test / TDD
    "jest", "vitest", "pytest", "mocha", "tap",
    // Package management
    "pip", "pip3", "pipx", "poetry", "uv", "pnpm", "yarn",
    "rustup", "cargo-add",
    // Linting / Formatting
    "eslint", "prettier", "biome", "black", "ruff", "rustfmt",
    "clang-format", "gofmt", "goimports", "pylint", "mypy",
    // Navigation (read-only)
    "ls", "dir", "find", "cat", "head", "tail", "wc", "tree",
    "pwd", "which", "file", "stat", "du", "df", "env", "echo",
    "printf", "date", "whoami", "hostname", "uname", "realpath",
    "basename", "dirname", "sort", "uniq", "diff", "comm", "tr",
    "cut", "paste", "tee", "xargs", "seq", "yes", "true", "false",
    "test", "[",
    // Text processing
    "grep", "rg", "ag", "awk", "sed", "jq", "yq",
    // Git (local operations) — remote ops handled by GitGuard
    "git",
    // Docker (basic)
    "docker", "docker-compose", "podman",
    // Node/Python/Rust execution
    "node", "python", "python3", "ruby", "perl", "lua",
    "deno", "tsx",
    // Misc dev tools
    "openssl", "base64", "md5sum", "sha256sum", "xxd",
    "tar", "zip", "unzip", "gzip", "gunzip", "bzip2",
    "touch", "mkdir", "cp", "mv", "ln", "chmod",
    "less", "more", "bat",
  ])

  /** Commands requiring user confirmation */
  const CONFIRMLIST = new Set([
    "rm", "rmdir",
    "curl", "wget",
    "sudo", "su", "doas",
    "apt", "apt-get", "yum", "dnf", "pacman", "brew",
    "systemctl", "service",
    "kill", "killall", "pkill",
    "reboot", "shutdown", "halt",
  ])

  /** Commands always blocked */
  const BLOCKLIST = new Set([
    "ssh", "scp", "sftp", "rsync",
    "nc", "netcat", "ncat",
    "telnet", "ftp",
    "nmap", "masscan",
    "dd",
    "mkfs", "fdisk", "parted",
    "iptables", "ip6tables", "nft",
    "useradd", "userdel", "usermod", "passwd",
    "crontab",
  ])

  /** Patterns in command text that indicate bypass attempts */
  const BYPASS_PATTERNS = [
    /\|\s*(?:sh|bash|zsh|cmd|powershell)\b/,
    /\beval\s+["']/,
    /\bexec\s+["']/,
    /\bbash\s+-c\s+["']/,
    /\bsh\s+-c\s+["']/,
    /\bpython[3]?\s+-c\s+["'].*(?:os\.system|subprocess|socket)/,
    /\bnode\s+-e\s+["'].*(?:child_process|exec|spawn)/,
    /\bbase64\s+.*\|\s*(?:sh|bash)/,
  ]

  /** Git subcommands that are remote operations (handled by GitGuard) */
  const GIT_REMOTE_OPS = new Set([
    "push", "fetch", "pull", "clone",
    "remote",
  ])

  /** Git subcommands/flags that are destructive */
  const GIT_DESTRUCTIVE = [
    /push\s+.*--force/,
    /push\s+.*-f\b/,
    /reset\s+--hard/,
    /clean\s+-f/,
    /checkout\s+--\s/,
  ]

  /**
   * Check a command and return the guard decision.
   */
  export function check(command: string): CheckResult {
    const trimmed = command.trim()
    if (!trimmed) {
      return { decision: "allow", command: trimmed }
    }

    // Check for bypass patterns first
    for (const pattern of BYPASS_PATTERNS) {
      if (pattern.test(trimmed)) {
        const reason = `Shell bypass detected: ${pattern.source}`
        log.warn("BLOCK", { command: trimmed, reason })
        return { decision: "block", reason, command: trimmed }
      }
    }

    // Extract the primary binary from the command
    const binary = extractBinary(trimmed)
    if (!binary) {
      return { decision: "confirm", reason: "Could not parse command", command: trimmed }
    }

    // Check blocked list
    if (BLOCKLIST.has(binary)) {
      const reason = `Command '${binary}' is blocked in DevBunker`
      log.warn("BLOCK", { command: trimmed, binary, reason })
      return { decision: "block", reason, command: trimmed }
    }

    // Special handling for git
    if (binary === "git") {
      return checkGitCommand(trimmed)
    }

    // Special handling for rm -rf
    if (binary === "rm" && /\s-[a-zA-Z]*r[a-zA-Z]*f|\s-[a-zA-Z]*f[a-zA-Z]*r/.test(trimmed)) {
      return {
        decision: "confirm",
        reason: "Recursive force delete (rm -rf)",
        command: trimmed,
      }
    }

    // Check confirm list
    if (CONFIRMLIST.has(binary)) {
      const reason = `Command '${binary}' requires confirmation`
      log.info("CONFIRM", { command: trimmed, binary })
      return { decision: "confirm", reason, command: trimmed }
    }

    // Check whitelist
    if (WHITELIST.has(binary)) {
      log.info("ALLOW", { command: trimmed, binary })
      return { decision: "allow", command: trimmed }
    }

    // Unknown command — require confirmation
    log.info("CONFIRM", { command: trimmed, binary, reason: "unknown command" })
    return {
      decision: "confirm",
      reason: `Unknown command '${binary}' — requires confirmation`,
      command: trimmed,
    }
  }

  function checkGitCommand(command: string): CheckResult {
    // Check for destructive git operations
    for (const pattern of GIT_DESTRUCTIVE) {
      if (pattern.test(command)) {
        const reason = `Destructive git operation blocked: ${command}`
        log.warn("BLOCK", { command, reason })
        return { decision: "block", reason, command }
      }
    }

    // Extract git subcommand
    const subMatch = command.match(/git\s+(\w+)/)
    const subcommand = subMatch ? subMatch[1] : null

    if (subcommand && GIT_REMOTE_OPS.has(subcommand)) {
      // Remote operations require confirmation (GitGuard handles whitelist)
      return {
        decision: "confirm",
        reason: `Git remote operation: git ${subcommand}`,
        command,
      }
    }

    // Local git operations are allowed
    log.info("ALLOW", { command, binary: "git" })
    return { decision: "allow", command }
  }

  /**
   * Extract the primary binary name from a command string.
   * Handles pipes (takes first command), env prefixes, paths.
   */
  function extractBinary(command: string): string | null {
    // Take first command in a pipe chain
    const firstCmd = command.split(/\|/)[0].trim()

    // Skip env variable assignments (FOO=bar command)
    const withoutEnv = firstCmd.replace(/^(\w+=\S+\s+)+/, "")

    // Extract the binary name
    const parts = withoutEnv.trim().split(/\s+/)
    if (parts.length === 0) return null

    let binary = parts[0]

    // Handle path prefixes (/usr/bin/foo → foo)
    binary = binary.split("/").pop() || binary
    binary = binary.split("\\").pop() || binary

    return binary.toLowerCase()
  }

  /**
   * Assert that a command is allowed. Throws if blocked.
   * Returns "confirm" if user confirmation is needed.
   */
  export function assert(command: string): Decision {
    const result = check(command)
    if (result.decision === "block") {
      throw new Error(`[DevBunker Guard] ${result.reason}`)
    }
    return result.decision
  }
}
