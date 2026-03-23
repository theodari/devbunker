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
VRAM_MB=0

if [[ "$CPU_ONLY" == "1" ]]; then
  warn "CPU-only mode (CPU_ONLY=1)"
elif has_cmd nvidia-smi; then
  NVIDIA_GPU="$(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || true)"
  VRAM_MB="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -1 | tr -d ' ' || echo 0)"
  if [[ -n "$NVIDIA_GPU" ]]; then
    ok "NVIDIA: $NVIDIA_GPU"
    ok "VRAM: ${VRAM_MB} MB"
    USE_CUDA=1
  fi
elif [[ "$OS" == "darwin" ]]; then
  # macOS Metal — estimate from system memory (Metal shares unified memory)
  VRAM_MB=$(( $(sysctl -n hw.memsize 2>/dev/null || echo 0) / 1048576 / 2 ))
  ok "Apple Metal (estimated ${VRAM_MB} MB shared)"
else
  warn "No NVIDIA GPU — will use CPU"
fi

# Select best model for available VRAM
# Catalog: min_vram|name|file|size|url
MODEL_32B="Qwen2.5-Coder-32B-Instruct|Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf|18 GB|https://huggingface.co/bartowski/Qwen2.5-Coder-32B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf"
MODEL_14B="Qwen2.5-Coder-14B-Instruct|Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf|9 GB|https://huggingface.co/bartowski/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf"
MODEL_7B="Qwen2.5-Coder-7B-Instruct|Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf|4.4 GB|https://huggingface.co/bartowski/Qwen2.5-Coder-7B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-7B-Instruct-Q4_K_M.gguf"

if [[ "$VRAM_MB" -ge 16000 ]]; then
  SELECTED_MODEL="$MODEL_32B"
elif [[ "$VRAM_MB" -ge 4000 ]]; then
  SELECTED_MODEL="$MODEL_14B"
else
  SELECTED_MODEL="$MODEL_7B"
fi

MODEL_NAME="$(echo "$SELECTED_MODEL" | cut -d'|' -f1)"
MODEL_FILE="$(echo "$SELECTED_MODEL" | cut -d'|' -f2)"
MODEL_SIZE="$(echo "$SELECTED_MODEL" | cut -d'|' -f3)"
MODEL_URL="$(echo "$SELECTED_MODEL" | cut -d'|' -f4)"

ok "Best model: $MODEL_NAME (Q4_K_M, ~$MODEL_SIZE)"

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
  if [[ "$USE_CUDA" == "1" ]] && ! find "$INSTALL_DIR/llama-cuda" -name "llama-server" -type f 2>/dev/null | grep -q .; then
    TMP=$(mktemp)
    download "$LLAMA_BASE/llama-$LLAMA_RELEASE-bin-ubuntu-x64.zip" "$TMP" "llama-server (Linux)"
    unzip -o -q "$TMP" -d "$INSTALL_DIR/llama-cuda"
    rm -f "$TMP"
    find "$INSTALL_DIR/llama-cuda" -name "llama-server" -type f -exec chmod +x {} \; 2>/dev/null || true
    ok "llama-server installed"
  elif find "$INSTALL_DIR/llama-cuda" -name "llama-server" -type f 2>/dev/null | grep -q .; then
    ok "llama-server already installed"
  else
    # CPU-only fallback
    TMP=$(mktemp)
    download "$LLAMA_BASE/llama-$LLAMA_RELEASE-bin-ubuntu-x64.zip" "$TMP" "llama-server (CPU)"
    unzip -o -q "$TMP" -d "$INSTALL_DIR/llama"
    rm -f "$TMP"
    find "$INSTALL_DIR/llama" -name "llama-server" -type f -exec chmod +x {} \; 2>/dev/null || true
    ok "llama-server (CPU) installed"
  fi
elif [[ "$OS" == "darwin" ]]; then
  # macOS — use Metal (Apple Silicon) or CPU
  if ! find "$INSTALL_DIR/llama" -name "llama-server" -type f 2>/dev/null | grep -q .; then
    TMP=$(mktemp)
    download "$LLAMA_BASE/llama-$LLAMA_RELEASE-bin-macos-${ARCH}.zip" "$TMP" "llama-server (macOS)"
    unzip -o -q "$TMP" -d "$INSTALL_DIR/llama"
    rm -f "$TMP"
    find "$INSTALL_DIR/llama" -name "llama-server" -type f -exec chmod +x {} \; 2>/dev/null || true
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

  MODEL_PATH="$INSTALL_DIR/models/$MODEL_FILE"

  if [[ -f "$MODEL_PATH" ]]; then
    SIZE=$(du -h "$MODEL_PATH" | cut -f1)
    ok "Model already downloaded: $MODEL_NAME ($SIZE)"
  else
    echo -e "   ${D}Model: $MODEL_NAME (Q4_K_M, ~$MODEL_SIZE)${X}"
    echo -e "   ${D}Source: huggingface.co/bartowski${X}"
    echo -e "   ${D}One-time download, resumable if interrupted.${X}"
    echo ""

    if has_cmd curl; then
      curl -L --retry 3 -C - -o "$MODEL_PATH" "$MODEL_URL"
    else
      download "$MODEL_URL" "$MODEL_PATH" "$MODEL_NAME"
    fi

    if [[ -f "$MODEL_PATH" ]]; then
      SIZE=$(du -h "$MODEL_PATH" | cut -f1)
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
    BIN=$(find "$TMP" -name "devbunker" -type f | head -1)
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
    echo -e "     ${D}cp dist/devbunker-${OS}-${ARCH}/bin/devbunker $EXE${X}"
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
  MODEL_ID="$(echo "$MODEL_FILE" | sed 's/\.gguf$//' | tr '[:upper:]' '[:lower:]')"
  cat > "$CONFIG_FILE" << CONF
{
  "model": "llama/$MODEL_ID",
  "provider": {
    "llama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "llama.cpp (Local)",
      "options": {
        "baseURL": "http://localhost:8081/v1"
      },
      "models": {
        "$MODEL_ID": {
          "name": "$MODEL_NAME",
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
