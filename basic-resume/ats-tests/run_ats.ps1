#!/usr/bin/env pwsh
param(
    [switch]$NoCompile
)

$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $uv) {
    Write-Error "uv not found on PATH. Install: https://docs.astral.sh/uv/getting-started/installation/"
    exit 2
}

$pyArgs = @("-m", "src")
if ($NoCompile) { $pyArgs += "--no-compile" }

Push-Location $here
try {
    & $uv run --quiet python @pyArgs
    exit $LASTEXITCODE
} finally {
    Pop-Location
}
