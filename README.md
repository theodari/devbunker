<p align="center">
  <strong>DEV BUNKER</strong><br>
  <em>The air-gapped AI coding agent with TDD-first methodology</em>
</p>

<p align="center">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
  <img alt="Local LLM" src="https://img.shields.io/badge/LLM-local%20only-green?style=flat-square" />
  <img alt="Based on OpenCode" src="https://img.shields.io/badge/based%20on-OpenCode-purple?style=flat-square" />
</p>

---

DevBunker is a fork of [OpenCode](https://github.com/anomalyco/opencode) that guarantees **all AI inference stays local** (Ollama, LM Studio, vLLM, llama.cpp) while integrating the **BMAD methodology** with a **TDD-first workflow** where tests are generated from specifications before any implementation.

## Why DevBunker?

- **Confidential environments** — defense, healthcare, finance, or any context where code must never reach a cloud AI
- **TDD done right** — tests are written by a QA agent that *cannot see the implementation*, eliminating the "tests that validate what was coded" bias
- **Structured methodology** — 7 specialized agents (Analyst, Architect, QA, Dev, PO, PM, SM) with strict file isolation
- **Security guards** — filesystem scope, shell whitelist, git remote control, secret scanning

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- A local LLM backend: [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai), or any OpenAI-compatible server

### Installation

```bash
git clone https://github.com/theodari/DevBunker.git
cd DevBunker
bun install
bun run --cwd packages/opencode dev
```

### Configuration

Create an `opencode.json` in your project root:

```json
{
  "provider": {
    "ollama": {
      "name": "Ollama",
      "api": "openai-compatible",
      "baseURL": "http://localhost:11434/v1",
      "models": {
        "qwen2.5-coder:14b": { "name": "Qwen 2.5 Coder 14B" },
        "deepseek-coder-v2:16b": { "name": "DeepSeek Coder V2 16B" }
      }
    }
  }
}
```

## BMAD Agents

DevBunker includes 7 built-in agents for structured development:

| Agent | Key | Role | File Access |
|-------|-----|------|-------------|
| **Analyst** | `bmad-analyst` | Elicits requirements, writes specs & stories | Read all, write `docs/specs/`, `docs/stories/` |
| **Architect** | `bmad-architect` | Designs architecture from specs | Read all, write `docs/` |
| **QA** | `bmad-qa` | Writes tests from specs (TDD-first) | Read all **except `src/`, `lib/`**, write `tests/` |
| **Dev** | `bmad-dev` | Implements code to pass tests | Read all, write all **except `tests/`** |
| **PO** | `bmad-po` | Validates stories vs acceptance criteria | Read only + test runners |
| **PM** | `bmad-pm` | Plans sprints, tracks progress | Read all, write `docs/` |
| **SM** | `bmad-sm` | Facilitates process, retrospectives | Read all, write `docs/` |

Switch agents with `Tab` in the TUI.

## TDD-First Workflow

The core innovation: **structural separation** between test writing and implementation.

```
1. /create-story    →  Analyst writes specs + acceptance criteria
2. /architect       →  Architect designs the technical architecture
3. /generate-tests  →  QA writes tests from specs (CANNOT see src/)
4. /qa-gate         →  Verify RED phase (all tests fail)
5. /implement       →  Dev writes code (CANNOT modify tests/)
6. /qa-gate         →  Verify GREEN phase (all tests pass)
7. /validate-story  →  PO validates against acceptance criteria
```

### Why this matters

When the same agent writes both code and tests, it tends to write tests that validate *what it coded*, not *what was specified*. DevBunker solves this by making the separation **structural and enforced** — the QA agent literally cannot access implementation files.

## Slash Commands

| Command | Agent | Description |
|---------|-------|-------------|
| `/bmad-init` | — | Initialize project structure (`docs/`, `tests/` dirs) |
| `/create-story` | Analyst | Create a user story from a requirement |
| `/architect` | Architect | Design technical architecture |
| `/generate-tests` | QA | Generate tests from specs (no code access) |
| `/implement` | Dev | Implement code to pass failing tests |
| `/qa-gate` | QA | Check TDD phase (RED/GREEN/MIXED) |
| `/validate-story` | PO | Validate story against acceptance criteria |
| `/trace-requirements` | — | Build traceability matrix |

## Security Guards

All guards are active by default and log to `.devbunker/logs/guard.jsonl`.

| Guard | Protection |
|-------|-----------|
| **Filesystem Scope** | Blocks access outside workspace, sensitive files (`.ssh/`, `.gnupg/`, `.aws/`), private keys |
| **Shell Guard** | Command whitelist (~80 allowed), blocklist (~15 blocked: `ssh`, `nc`, `telnet`), bypass detection |
| **Git Guard** | Remote whitelist, blocks `--force` push, blocks `git config --global` |
| **Secret Scan** | 20+ patterns (AWS, GitHub, Stripe, JWT...), scans diffs before `git push` |

### Configuration

Guards can be configured in `opencode.json`:

```json
{
  "git": {
    "allowedRemotes": ["github.com/myorg/*"],
    "blockForce": true
  }
}
```

## RAM-Aware Model Selection

DevBunker detects available system RAM and filters models that are too large to run. In the model selector, oversized models are grayed out with an estimate of required RAM.

## Project Structure

```
docs/
├── specs/           Functional specifications
├── stories/         User stories + acceptance criteria
├── architecture/    Technical architecture docs
├── test-plans/      Test plans
├── sprints/         Sprint planning
└── retros/          Retrospectives

tests/
├── unit/            Unit tests (written by QA agent)
├── integration/     Integration tests
└── acceptance/      Acceptance tests

src/                 Implementation (written by Dev agent)
```

## Documentation

- [Technical Specifications](docs/SPECS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security Model](docs/SECURITY.md)
- [BMAD + TDD Methodology](docs/BMAD-TDD.md)
- [Roadmap](docs/ROADMAP.md)

## Credits

Based on [OpenCode](https://github.com/anomalyco/opencode) by [Anomaly](https://github.com/anomalyco) (MIT License).

## License

MIT — See [LICENSE](LICENSE)
