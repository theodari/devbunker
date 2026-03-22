#Requires -Version 5.1
<#
.SYNOPSIS
    DevBunker installer — air-gapped local AI coding assistant

.DESCRIPTION
    Installs DevBunker with llama-server (CUDA/Vulkan) and a local LLM model.
    Run: irm https://raw.githubusercontent.com/theodari/DevBunker/dev/script/install.ps1 | iex

.LINK
    https://github.com/theodari/DevBunker
#>

param(
    [string]$InstallDir = "$env:USERPROFILE\.devbunker",
    [int]$GpuLayers = 18,
    [int]$CtxSize = 8192,
    [switch]$SkipModel,
    [switch]$CpuOnly
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   [!]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "   [X]  $msg" -ForegroundColor Red }

function Exit-WithError($msg) { Write-Err $msg; exit 1 }

function Test-Cmd($cmd) {
    try { Get-Command $cmd -ErrorAction Stop | Out-Null; return $true }
    catch { return $false }
}

function Get-NvidiaGpu {
    try {
        $out = & nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>$null
        if ($LASTEXITCODE -eq 0 -and $out) { return $out.Trim() }
    } catch {}
    return $null
}

function Download-WithResume($url, $dest, $desc) {
    Write-Host "   Downloading $desc..." -NoNewline
    $ProgressPreference = 'SilentlyContinue'
    if (Test-Cmd "curl.exe") {
        & curl.exe -L -o $dest --retry 3 -C - --progress-bar $url 2>&1 | Out-Null
    } else {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    }
    if (Test-Path $dest) {
        $size = [math]::Round((Get-Item $dest).Length / 1MB, 1)
        Write-Host " ${size} MB" -ForegroundColor Green
    } else {
        Write-Host " FAILED" -ForegroundColor Red
        throw "Download failed: $desc"
    }
}

function Expand-To($zip, $dir) {
    if (Test-Cmd "tar") { & tar -xf $zip -C $dir 2>$null }
    else { Expand-Archive -Path $zip -DestinationPath $dir -Force }
}

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Cyan
Write-Host "       DevBunker Installer" -ForegroundColor Cyan
Write-Host "       Air-gapped local AI coding assistant" -ForegroundColor DarkCyan
Write-Host "  ============================================" -ForegroundColor Cyan

# Check 64-bit
if (-not [Environment]::Is64BitOperatingSystem) { Exit-WithError "64-bit Windows required." }

# ---------------------------------------------------------------------------
# 1. Directories
# ---------------------------------------------------------------------------
Write-Step "Creating install directories"
foreach ($d in @("bin", "llama-cuda", "llama", "models")) {
    New-Item -ItemType Directory -Path "$InstallDir\$d" -Force | Out-Null
}
Write-Ok "Install dir: $InstallDir"

# ---------------------------------------------------------------------------
# 2. Detect GPU
# ---------------------------------------------------------------------------
Write-Step "Detecting GPU"
$nvidia = Get-NvidiaGpu
$useCuda = $false

if ($CpuOnly) {
    Write-Warn "CPU-only mode (--CpuOnly)"
} elseif ($nvidia) {
    Write-Ok "NVIDIA: $nvidia"
    $useCuda = $true
} else {
    Write-Warn "No NVIDIA GPU — will use Vulkan or CPU fallback"
}

# ---------------------------------------------------------------------------
# 3. Download llama-server
# ---------------------------------------------------------------------------
Write-Step "Installing llama-server"

# Get latest release tag
try {
    $release = (Invoke-RestMethod "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest" -UseBasicParsing).tag_name
} catch {
    $release = "b8373"
    Write-Warn "Could not fetch latest release, using $release"
}
Write-Ok "llama.cpp release: $release"

$cudaDir = "$InstallDir\llama-cuda"
$vulkanDir = "$InstallDir\llama"

# CUDA build
if ($useCuda -and -not (Test-Path "$cudaDir\llama-server.exe")) {
    $tmp1 = "$env:TEMP\llama-cuda.zip"
    $tmp2 = "$env:TEMP\cudart.zip"
    Download-WithResume "https://github.com/ggml-org/llama.cpp/releases/download/$release/llama-$release-bin-win-cuda-12.4-x64.zip" $tmp1 "llama-server (CUDA)"
    Download-WithResume "https://github.com/ggml-org/llama.cpp/releases/download/$release/cudart-llama-bin-win-cuda-12.4-x64.zip" $tmp2 "CUDA runtime DLLs"
    Expand-To $tmp1 $cudaDir
    Expand-To $tmp2 $cudaDir
    Remove-Item $tmp1, $tmp2 -Force -ErrorAction SilentlyContinue
    Write-Ok "llama-server (CUDA) installed"
} elseif ($useCuda) {
    Write-Ok "llama-server (CUDA) already installed"
}

# Vulkan build (always install as fallback)
if (-not (Test-Path "$vulkanDir\llama-server.exe")) {
    $tmp = "$env:TEMP\llama-vulkan.zip"
    Download-WithResume "https://github.com/ggml-org/llama.cpp/releases/download/$release/llama-$release-bin-win-vulkan-x64.zip" $tmp "llama-server (Vulkan)"
    Expand-To $tmp $vulkanDir
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
    Write-Ok "llama-server (Vulkan) installed"
} else {
    Write-Ok "llama-server (Vulkan) already installed"
}

# ---------------------------------------------------------------------------
# 4. Download model
# ---------------------------------------------------------------------------
if (-not $SkipModel) {
    Write-Step "Downloading AI model"

    $modelFile = "$InstallDir\models\qwen2.5-coder-14b-instruct-q4_k_m.gguf"

    if (Test-Path $modelFile) {
        $gb = [math]::Round((Get-Item $modelFile).Length / 1GB, 2)
        Write-Ok "Model already downloaded (${gb} GB)"
    } else {
        Write-Host "   Model: Qwen2.5-Coder-14B-Instruct (Q4_K_M, ~9 GB)" -ForegroundColor DarkGray
        Write-Host "   Source: huggingface.co/bartowski" -ForegroundColor DarkGray
        Write-Host "   This is a one-time download. It can be resumed if interrupted." -ForegroundColor DarkGray
        Write-Host ""

        $url = "https://huggingface.co/bartowski/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf"

        if (Test-Cmd "curl.exe") {
            & curl.exe -L -o $modelFile --retry 3 -C - $url
        } else {
            Download-WithResume $url $modelFile "Qwen2.5-Coder-14B"
        }

        if (Test-Path $modelFile) {
            $gb = [math]::Round((Get-Item $modelFile).Length / 1GB, 2)
            Write-Ok "Model downloaded (${gb} GB)"
        } else {
            Write-Err "Download failed. Run installer again to resume."
        }
    }
} else {
    Write-Warn "Skipping model download (--SkipModel)"
}

# ---------------------------------------------------------------------------
# 5. Install DevBunker binary
# ---------------------------------------------------------------------------
Write-Step "Installing DevBunker binary"

$exe = "$InstallDir\bin\devbunker.exe"
$repo = "theodari/DevBunker"
$archive = "devbunker-windows-x64.zip"

if (Test-Path $exe) {
    Write-Ok "DevBunker binary already installed"
} else {
    # Try downloading from GitHub releases
    $dlUrl = "https://github.com/$repo/releases/latest/download/$archive"
    $tmpZip = "$env:TEMP\devbunker.zip"
    $tmpDir = "$env:TEMP\devbunker-extract"

    try {
        Download-WithResume $dlUrl $tmpZip "DevBunker"
        New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null
        Expand-To $tmpZip $tmpDir

        # Find binary (may be named opencode.exe in the archive)
        $bin = Get-ChildItem $tmpDir -Filter "*.exe" -Recurse | Select-Object -First 1
        if ($bin) {
            Copy-Item $bin.FullName $exe -Force
            Write-Ok "DevBunker installed: $exe"
        } else {
            Write-Warn "Binary not found in archive"
        }

        Remove-Item $tmpZip, $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
    } catch {
        Write-Warn "No release found. Build manually:"
        Write-Host "     cd packages/opencode && bun run build -- --single" -ForegroundColor DarkGray
        Write-Host "     cp dist\devbunker-windows-x64\bin\opencode.exe $exe" -ForegroundColor DarkGray
    }
}

# ---------------------------------------------------------------------------
# 6. Create config
# ---------------------------------------------------------------------------
Write-Step "Creating default config"

# Check both devbunker and legacy opencode config dirs
$configDir = "$env:USERPROFILE\.config\devbunker"
$configFile = "$configDir\config.json"
$legacyConfig = "$env:USERPROFILE\.config\opencode\config.json"

if ((Test-Path $configFile) -or (Test-Path $legacyConfig)) {
    Write-Ok "Config already exists"
} else {
    New-Item -ItemType Directory -Path $configDir -Force | Out-Null

    $json = @'
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
'@
    Set-Content $configFile $json -Encoding UTF8
    Write-Ok "Config created: $configFile"
}

# ---------------------------------------------------------------------------
# 7. Update PATH
# ---------------------------------------------------------------------------
Write-Step "Updating PATH"

$binDir = "$InstallDir\bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")

if ($userPath -like "*$binDir*") {
    Write-Ok "PATH already configured"
} else {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
    $env:PATH = "$binDir;$env:PATH"
    Write-Ok "Added $binDir to PATH"
}

# ---------------------------------------------------------------------------
# 8. Optional: clang-format
# ---------------------------------------------------------------------------
Write-Step "Checking tools"

if (Test-Cmd "clang-format") {
    Write-Ok "clang-format found"
} else {
    Write-Warn "clang-format not found (optional, for code formatting)"
    Write-Host "     Install with: winget install LLVM.LLVM" -ForegroundColor DarkGray
}

if (Test-Cmd "git") {
    Write-Ok "git found"
} else {
    Write-Err "git not found — DevBunker requires git"
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "       DevBunker installed!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Binary:   $exe" -ForegroundColor White
Write-Host "  Config:   $configFile" -ForegroundColor White
Write-Host "  Models:   $InstallDir\models\" -ForegroundColor White
if ($nvidia) {
    Write-Host "  GPU:      $nvidia (CUDA)" -ForegroundColor White
} else {
    Write-Host "  GPU:      Vulkan / CPU" -ForegroundColor White
}
Write-Host ""
Write-Host "  Usage:" -ForegroundColor Cyan
Write-Host "    1. Open a NEW terminal" -ForegroundColor White
Write-Host "    2. cd into any project" -ForegroundColor White
Write-Host "    3. devbunker" -ForegroundColor White
Write-Host ""
Write-Host "  The AI model starts automatically on first launch." -ForegroundColor DarkGray
Write-Host ""
