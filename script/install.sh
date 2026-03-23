#!/bin/bash
set -euo pipefail

# DevBunker installer — air-gapped local AI coding assistant
# https://github.com/theodari/DevBunker
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/theodari/DevBunker/dev/script/install.sh | bash
#   DEVBUNKER_INSTALL_DIR=/custom/path bash install.sh
#   CPU_ONLY=1 bash install.sh

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
INSTALL_DIR="${DEVBUNKER_INSTALL_DIR:-$HOME/.devbunker}"
CPU_ONLY="${CPU_ONLY:-0}"
SKIP_MODEL="${SKIP_MODEL:-0}"
REPO="theodari/DevBunker"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  B="\033[1m" G="\033[32m" Y="\033[33m" R="\033[31m" C="\033[36m" D="\033[90m" X="\033[0m"
else
  B="" G="" Y="" R="" C="" D="" X=""
fi

step()  { echo -e "\n${C}>> $*${X}"; }
ok()    { echo -e "   ${G}[OK]${X} $*"; }
warn()  { echo -e "   ${Y}[!]${X}  $*"; }
err()   { echo -e "   ${R}[X]${X}  $*" >&2; }
die()   { err "$@"; exit 1; }

# ---------------------------------------------------------------------------
# Detect platform
# ---------------------------------------------------------------------------
detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "darwin" ;;
    *)       die "Unsupported OS: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  echo "x64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)             die "Unsupported arch: $(uname -m)" ;;
  esac
}

has_cmd() { command -v "$1" &>/dev/null; }

download() {
  local url="$1" dest="$2" desc="$3"
  echo -ne "   Downloading $desc..."
  if has_cmd curl; then
    curl -fSL --retry 3 -C - -o "$dest" "$url" 2>/dev/null
  elif has_cmd wget; then
    wget -q -c -O "$dest" "$url"
  else
    die "Neither curl nor wget found."
  fi
  local size
  size=$(du -h "$dest" 2>/dev/null | cut -f1)
  echo -e " ${G}${size}${X}"
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo ""
echo -e "  ${C}============================================${X}"
echo -e "  ${C}     DevBunker Installer${X}"
echo -e "  ${D}     Air-gapped local AI coding assistant${X}"
echo -e "  ${C}============================================${X}"

OS="$(detect_os)"
ARCH="$(detect_arch)"
echo -e "  ${D}Platform: ${OS}-${ARCH}${X}"

# ---------------------------------------------------------------------------
# 1. Directories
# ---------------------------------------------------------------------------
step "Creating directories"
mkdir -p "$INSTALL_DIR"/{bin,llama-cuda,llama,models}
ok "Install dir: $INSTALL_DIR"

# ---------------------------------------------------------------------------
# 2. Detect GPU
# ---------------------------------------------------------------------------
step "Detecting GPU"
USE_CUDA=0
NVIDIA_GPU=""

if [[ "$CPU_ONLY" == "1" ]]; then
  warn "CPU-only mode (CPU_ONLY=1)"
elif has_cmd nvidia-smi; then
  NVIDIA_GPU="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || true)"
  if [[ -n "$NVIDIA_GPU" ]]; then
    ok "NVIDIA: $NVIDIA_GPU"
    USE_CUDA=1
  fi
else
  warn "No NVIDIA GPU — will use CPU (CUDA/Vulkan not available on this platform yet)"
fi

# ---------------------------------------------------------------------------
# 3. Download llama-server
# ---------------------------------------------------------------------------
step "Installing llama-server"

# Get latest release
LLAMA_RELEASE="$(curl -fsSL https://api.github.com/repos/ggml-org/llama.cpp/releases/latest 2>/dev/null | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/' || echo "b8373")"
ok "llama.cpp release: $LLAMA_RELEASE"

LLAMA_BASE="https://github.com/ggml-org/llama.cpp/releases/download/$LLAMA_RELEASE"

if [[ "$OS" == "linux" && "$ARCH" == "x64" ]]; then
  # CUDA build (Linux x64 only)
  if [[ "$USE_CUDA" == "1" ]] && [[ ! -f "$INSTALL_DIR/llama-cuda/llama-server" ]]; then
    TMP=$(mktemp)
    download "$LLAMA_BASE/llama-$LLAMA_RELEASE-bin-ubuntu-x64.zip" "$TMP" "llama-server (Linux)"
    unzip -o -q "$TMP" -d "$INSTALL_DIR/llama-cuda"
    rm -f "$TMP"
    chmod +x "$INSTALL_DIR/llama-cuda/llama-server" 2>/dev/null || true
    ok "llama-server installed"
  elif [[ -f "$INSTALL_DIR/llama-cuda/llama-server" ]]; then
    ok "llama-server already installed"
  else
    # CPU-only fallback
    TMP=$(mktemp)
    download "$LLAMA_BASE/llama-$LLAMA_RELEASE-bin-ubuntu-x64.zip" "$TMP" "llama-server (CPU)"
    unzip -o -q "$TMP" -d "$INSTALL_DIR/llama"
    rm -f "$TMP"
    chmod +x "$INSTALL_DIR/llama/llama-server" 2>/dev/null || true
    ok "llama-server (CPU) installed"
  fi
elif [[ "$OS" == "darwin" ]]; then
  # macOS — use Metal (Apple Silicon) or CPU
  if [[ ! -f "$INSTALL_DIR/llama/llama-server" ]]; then
    TMP=$(mktemp)
    download "$LLAMA_BASE/llama-$LLAMA_RELEASE-bin-macos-${ARCH}.zip" "$TMP" "llama-server (macOS)"
    unzip -o -q "$TMP" -d "$INSTALL_DIR/llama"
    rm -f "$TMP"
    chmod +x "$INSTALL_DIR/llama/llama-server" 2>/dev/null || true
    ok "llama-server (Metal) installed"
  else
    ok "llama-server already installed"
  fi
else
  warn "No pre-built llama-server for ${OS}-${ARCH}. Build from source: https://github.com/ggml-org/llama.cpp"
fi

# ---------------------------------------------------------------------------
# 4. Download model
# ---------------------------------------------------------------------------
if [[ "$SKIP_MODEL" != "1" ]]; then
  step "Downloading AI model"

  MODEL_FILE="$INSTALL_DIR/models/qwen2.5-coder-14b-instruct-q4_k_m.gguf"

  if [[ -f "$MODEL_FILE" ]]; then
    SIZE=$(du -h "$MODEL_FILE" | cut -f1)
    ok "Model already downloaded ($SIZE)"
  else
    echo -e "   ${D}Model: Qwen2.5-Coder-14B-Instruct (Q4_K_M, ~9 GB)${X}"
    echo -e "   ${D}Source: huggingface.co/bartowski${X}"
    echo -e "   ${D}One-time download, resumable if interrupted.${X}"
    echo ""

    MODEL_URL="https://huggingface.co/bartowski/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf"

    if has_cmd curl; then
      curl -L --retry 3 -C - -o "$MODEL_FILE" "$MODEL_URL"
    else
      download "$MODEL_URL" "$MODEL_FILE" "Qwen2.5-Coder-14B"
    fi

    if [[ -f "$MODEL_FILE" ]]; then
      SIZE=$(du -h "$MODEL_FILE" | cut -f1)
      ok "Model downloaded ($SIZE)"
    else
      err "Download failed. Run installer again to resume."
    fi
  fi
else
  warn "Skipping model download (SKIP_MODEL=1)"
fi

# ---------------------------------------------------------------------------
# 5. Install DevBunker binary
# ---------------------------------------------------------------------------
step "Installing DevBunker"

EXE="$INSTALL_DIR/bin/devbunker"

if [[ -f "$EXE" ]]; then
  ok "DevBunker already installed"
else
  ARCHIVE="devbunker-${OS}-${ARCH}.tar.gz"
  DL_URL="https://github.com/$REPO/releases/latest/download/$ARCHIVE"
  TMP=$(mktemp -d)

  if download "$DL_URL" "$TMP/$ARCHIVE" "DevBunker" 2>/dev/null; then
    tar -xzf "$TMP/$ARCHIVE" -C "$TMP" 2>/dev/null || true
    BIN=$(find "$TMP" -name "devbunker" -o -name "opencode" | head -1)
    if [[ -n "$BIN" ]]; then
      cp "$BIN" "$EXE"
      chmod +x "$EXE"
      ok "DevBunker installed: $EXE"
    else
      warn "Binary not found in archive"
    fi
    rm -rf "$TMP"
  else
    warn "No release found. Build manually:"
    echo -e "     ${D}cd packages/opencode && bun run build -- --single${X}"
    echo -e "     ${D}cp dist/devbunker-${OS}-${ARCH}/bin/opencode $EXE${X}"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Create config
# ---------------------------------------------------------------------------
step "Creating default config"

CONFIG_DIR="$HOME/.config/devbunker"
CONFIG_FILE="$CONFIG_DIR/config.json"
LEGACY="$HOME/.config/opencode/config.json"

if [[ -f "$CONFIG_FILE" ]] || [[ -f "$LEGACY" ]]; then
  ok "Config already exists"
else
  mkdir -p "$CONFIG_DIR"
  cat > "$CONFIG_FILE" << 'CONF'
{
  "model": "llama/qwen2.5-coder-14b-instruct-q4_k_m",
  "provider": {
    "llama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama.cpp (Local)",
      "options": {
        "baseURL": "http://localhost:8081/v1"
      },
      "models": {
        "qwen2.5-coder-14b-instruct-q4_k_m": {
          "name": "Qwen 2.5 Coder 14B",
          "reasoning": false,
          "temperature": true,
          "tool_call": true
        }
      }
    }
  }
}
CONF
  ok "Config created: $CONFIG_FILE"
fi

# ---------------------------------------------------------------------------
# 7. Update PATH
# ---------------------------------------------------------------------------
step "Updating PATH"

BIN_DIR="$INSTALL_DIR/bin"

if echo "$PATH" | tr ':' '\n' | grep -qF "$BIN_DIR"; then
  ok "PATH already configured"
else
  SHELL_NAME="$(basename "${SHELL:-/bin/bash}")"
  case "$SHELL_NAME" in
    zsh)  RC="$HOME/.zshrc" ;;
    fish)
      RC="$HOME/.config/fish/config.fish"
      mkdir -p "$(dirname "$RC")"
      echo "set -gx PATH $BIN_DIR \$PATH" >> "$RC"
      ok "Added to PATH in $RC"
      ;;
    *)    RC="$HOME/.bashrc" ;;
  esac

  if [[ "$SHELL_NAME" != "fish" ]]; then
    echo "" >> "$RC"
    echo "# DevBunker" >> "$RC"
    echo "export PATH=\"$BIN_DIR:\$PATH\"" >> "$RC"
    ok "Added to PATH in $RC"
  fi
fi

# ---------------------------------------------------------------------------
# 8. Check tools
# ---------------------------------------------------------------------------
step "Checking tools"

if has_cmd clang-format; then
  ok "clang-format found"
else
  warn "clang-format not found (optional)"
  if [[ "$OS" == "darwin" ]]; then
    echo -e "     ${D}Install: brew install clang-format${X}"
  else
    echo -e "     ${D}Install: sudo apt install clang-format${X}"
  fi
fi

if has_cmd git; then
  ok "git found"
else
  err "git not found — DevBunker requires git"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
echo -e "  ${G}============================================${X}"
echo -e "  ${G}     DevBunker installed!${X}"
echo -e "  ${G}============================================${X}"
echo ""
echo -e "  Binary:   $EXE"
echo -e "  Config:   $CONFIG_FILE"
echo -e "  Models:   $INSTALL_DIR/models/"
if [[ -n "$NVIDIA_GPU" ]]; then
  echo -e "  GPU:      $NVIDIA_GPU (CUDA)"
elif [[ "$OS" == "darwin" ]]; then
  echo -e "  GPU:      Apple Metal"
else
  echo -e "  GPU:      CPU"
fi
echo ""
echo -e "  ${C}Usage:${X}"
echo "    1. Open a new terminal (or: source ~/.bashrc)"
echo "    2. cd into any project"
echo "    3. devbunker"
echo ""
echo -e "  ${D}The AI model starts automatically on first launch.${X}"
echo ""
