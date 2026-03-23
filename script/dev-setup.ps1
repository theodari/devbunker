#Requires -Version 5.1
<#
.SYNOPSIS
    DevBunker developer setup (from source).

.DESCRIPTION
    Checks prerequisites, installs dependencies, and creates a `devbunker`
    command that runs from the local checkout.

.LINK
    https://github.com/theodari/DevBunker
#>

$ErrorActionPreference = "Stop"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Info  { param([string]$Msg) Write-Host "info  " -ForegroundColor Cyan -NoNewline; Write-Host $Msg }
function Write-Ok    { param([string]$Msg) Write-Host "ok    " -ForegroundColor Green -NoNewline; Write-Host $Msg }
function Write-Warn  { param([string]$Msg) Write-Host "warn  " -ForegroundColor Yellow -NoNewline; Write-Host $Msg }
function Write-Err   { param([string]$Msg) Write-Host "error " -ForegroundColor Red -NoNewline; Write-Host $Msg }

function Exit-WithError {
    param([string]$Msg)
    Write-Err $Msg
    exit 1
}

# ---------------------------------------------------------------------------
# Resolve project root
# ---------------------------------------------------------------------------
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path

Write-Info "Project root: $ProjectRoot"

# ---------------------------------------------------------------------------
# Check prerequisites
# ---------------------------------------------------------------------------
Write-Info "Checking prerequisites ..."

$Missing = @()

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    $Missing += "bun  - https://bun.sh"
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    $Missing += "git  - https://git-scm.com"
}

if ($Missing.Count -gt 0) {
    Exit-WithError ("Missing required tools:`n" + ($Missing | ForEach-Object { "       - $_" } | Out-String))
}

$BunVersion = & bun --version 2>&1
Write-Ok "bun $BunVersion"

$GitVersion = & git --version 2>&1
Write-Ok "$GitVersion"

# Optional: ollama
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Write-Ok "ollama found"
} else {
    Write-Warn "ollama not found - you'll need a local LLM backend to use DevBunker"
    Write-Host "       Install from: https://ollama.com"
}

# ---------------------------------------------------------------------------
# Install dependencies
# ---------------------------------------------------------------------------
Write-Info "Installing dependencies ..."
Push-Location $ProjectRoot
try {
    & bun install
    if ($LASTEXITCODE -ne 0) { Exit-WithError "bun install failed." }
} finally {
    Pop-Location
}

Write-Ok "Dependencies installed"

# ---------------------------------------------------------------------------
# Create wrapper (.bat + .ps1)
# ---------------------------------------------------------------------------
$InstallDir = Join-Path $env:USERPROFILE ".devbunker\bin"
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# .bat wrapper (works in cmd and PowerShell)
$BatWrapper = Join-Path $InstallDir "devbunker.bat"
$BatContent = "@echo off`nbun run --cwd `"$ProjectRoot\packages\opencode`" dev %*`n"
[System.IO.File]::WriteAllText($BatWrapper, $BatContent)

# .ps1 wrapper (native PowerShell)
$Ps1Wrapper = Join-Path $InstallDir "devbunker.ps1"
$Ps1Content = @"
# DevBunker dev wrapper
& bun run --cwd "$ProjectRoot\packages\opencode" dev @args
"@
[System.IO.File]::WriteAllText($Ps1Wrapper, $Ps1Content)

Write-Ok "Created wrappers in $InstallDir"

# ---------------------------------------------------------------------------
# PATH handling
# ---------------------------------------------------------------------------
$UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")

if ($UserPath -split ";" | Where-Object { $_ -eq $InstallDir }) {
    Write-Ok "$InstallDir already in PATH"
} else {
    try {
        [Environment]::SetEnvironmentVariable("PATH", "$InstallDir;$UserPath", "User")
        $env:PATH = "$InstallDir;$env:PATH"
        Write-Info "Added $InstallDir to user PATH"
    } catch {
        Write-Warn "Could not auto-add to PATH. Add this directory manually:"
        Write-Host ""
        Write-Host "  $InstallDir"
        Write-Host ""
    }
}

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Dev setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:"
Write-Host ""
Write-Host "    1. Open a new terminal (PATH has been updated)"
Write-Host "    2. Start a local model:  ollama run qwen2.5-coder:14b"
Write-Host "    3. Run DevBunker:        devbunker"
Write-Host ""
Write-Host "  Documentation: https://github.com/theodari/DevBunker"
Write-Host ""
