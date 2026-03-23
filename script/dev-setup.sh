#!/bin/bash
set -euo pipefail

# DevBunker — developer setup (from source)
# Creates a `devbunker` command that runs from the local checkout.

# ---------------------------------------------------------------------------
# Colors & helpers
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  BOLD="\033[1m" GREEN="\033[32m" YELLOW="\033[33m" RED="\033[31m" CYAN="\033[36m" RESET="\033[0m"
else
  BOLD="" GREEN="" YELLOW="" RED="" CYAN="" RESET=""
fi

info()  { echo -e "${CYAN}${BOLD}info${RESET}  $*"; }
warn()  { echo -e "${YELLOW}${BOLD}warn${RESET}  $*"; }
ok()    { echo -e "${GREEN}${BOLD}ok${RESET}    $*"; }
die()   { echo -e "${RED}${BOLD}error${RESET} $*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Resolve project root (where this script lives: <root>/script/)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

info "Project root: ${BOLD}${PROJECT_ROOT}${RESET}"

# ---------------------------------------------------------------------------
# Check prerequisites
# ---------------------------------------------------------------------------
info "Checking prerequisites ..."

MISSING=()

if ! command -v bun &>/dev/null; then
  MISSING+=("bun  — https://bun.sh")
fi

if ! command -v git &>/dev/null; then
  MISSING+=("git  — https://git-scm.com")
fi

if (( ${#MISSING[@]} > 0 )); then
  die "Missing required tools:\n$(printf '       - %s\n' "${MISSING[@]}")"
fi

ok "bun $(bun --version)"
ok "git $(git --version | awk '{print $3}')"

# Optional: ollama
if command -v ollama &>/dev/null; then
  ok "ollama found"
else
  warn "ollama not found — you'll need a local LLM backend to use DevBunker"
  echo -e "       Install from: ${BOLD}https://ollama.com${RESET}"
fi

# ---------------------------------------------------------------------------
# Install dependencies
# ---------------------------------------------------------------------------
info "Installing dependencies ..."
cd "$PROJECT_ROOT"
bun install

ok "Dependencies installed"

# ---------------------------------------------------------------------------
# Create wrapper script
# ---------------------------------------------------------------------------
INSTALL_DIR="${HOME}/.devbunker/bin"
mkdir -p "$INSTALL_DIR"
WRAPPER="${INSTALL_DIR}/devbunker"

cat > "$WRAPPER" << EOF
#!/bin/bash
exec bun run --cwd "${PROJECT_ROOT}/packages/opencode" dev "\$@"
EOF
chmod +x "$WRAPPER"

ok "Created wrapper: ${BOLD}${WRAPPER}${RESET}"

# ---------------------------------------------------------------------------
# PATH handling
# ---------------------------------------------------------------------------
if echo "$PATH" | tr ':' '\n' | grep -qF "$INSTALL_DIR"; then
  ok "${INSTALL_DIR} already in PATH"
else
  shell_name="$(basename "${SHELL:-/bin/bash}")"
  case "$shell_name" in
    zsh)  rc_file="$HOME/.zshrc" ;;
    fish)
      rc_file="$HOME/.config/fish/config.fish"
      mkdir -p "$(dirname "$rc_file")"
      if ! grep -qF "$INSTALL_DIR" "$rc_file" 2>/dev/null; then
        echo "set -gx PATH ${INSTALL_DIR} \$PATH" >> "$rc_file"
        info "Added to PATH in ${rc_file}"
      fi
      ;;
    *)    rc_file="$HOME/.bashrc" ;;
  esac

  if [[ "$shell_name" != "fish" ]]; then
    if ! grep -qF "$INSTALL_DIR" "$rc_file" 2>/dev/null; then
      echo "" >> "$rc_file"
      echo "# DevBunker (dev)" >> "$rc_file"
      echo "export PATH=\"${INSTALL_DIR}:\$PATH\"" >> "$rc_file"
      info "Added to PATH in ${rc_file}"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo -e "${GREEN}${BOLD}Dev setup complete!${RESET}"
echo ""
echo "  Next steps:"
echo ""
echo "    1. Open a new terminal (or run: source ~/.bashrc)"
echo "    2. Start a local model:  ollama run qwen2.5-coder:14b"
echo "    3. Run DevBunker:        devbunker"
echo ""
