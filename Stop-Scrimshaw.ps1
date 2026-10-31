#requires -Version 5.1
<#
  Stops every running Scrimshaw server without knowing its PID.
  Each server writes logs\scrimshaw-server-<pid>.json on start (pid, port, url, start time; no token). This script
  reads those files, deletes the ones whose process is gone, and asks each live server to exit through the Fleet
  shutdown endpoint (POST /__fleethacker/shutdown with X-FleetHacker-Shutdown: 1). It never calls Stop-Process:
  a server that does not answer is reported, not killed.

    Stop-Scrimshaw.ps1
#>
param([string]$LogDir = '')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
if (-not $LogDir) { $LogDir = Join-Path $PSScriptRoot 'logs' }
$files = @()
if (Test-Path -LiteralPath $LogDir) { $files = @(Get-ChildItem -LiteralPath $LogDir -Filter 'scrimshaw-server-*.json') }
if ($files.Count -eq 0) { Write-Host 'No running Scrimshaw server found.'; exit 0 }
$stopped = 0
$failed = 0
foreach ($f in $files) {
    try { $rt = [IO.File]::ReadAllText($f.FullName) | ConvertFrom-Json } catch { Remove-Item -LiteralPath $f.FullName -Force; continue }
    $alive = [bool](Get-Process -Id ([int]$rt.pid) -ErrorAction SilentlyContinue)
    if (-not $alive) { Remove-Item -LiteralPath $f.FullName -Force; Write-Host "Removed stale record for pid $($rt.pid)."; continue }
    $base = ([string]$rt.url).TrimEnd('/')
    if ($base -notmatch '^http://(127\.0\.0\.1|localhost):\d+$') { Write-Host "Skipping pid $($rt.pid): unexpected address in $($f.Name)." -ForegroundColor Yellow; $failed++; continue }
    try {
        $id = Invoke-RestMethod -UseBasicParsing -Uri "$base/__fleethacker/id" -TimeoutSec 5
        if ($id.tool -ne 'scrimshaw' -or [int]$id.pid -ne [int]$rt.pid) { Write-Host "Port $($rt.port) is not this Scrimshaw (pid $($rt.pid)); leaving it alone." -ForegroundColor Yellow; $failed++; continue }
        [void](Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$base/__fleethacker/shutdown" -Headers @{ 'X-FleetHacker-Shutdown' = '1' } -TimeoutSec 5)
        $deadline = (Get-Date).AddSeconds(5)
        while ((Get-Process -Id ([int]$rt.pid) -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
        if (Get-Process -Id ([int]$rt.pid) -ErrorAction SilentlyContinue) { Write-Host "Asked pid $($rt.pid) to stop; it is still closing." -ForegroundColor Yellow; $failed++ }
        else { Write-Host "Stopped Scrimshaw on $base (pid $($rt.pid))."; $stopped++ }
    } catch {
        Write-Host "Could not stop pid $($rt.pid) on $base`: $($_.Exception.Message). Close its window instead." -ForegroundColor Yellow
        $failed++
    }
}
if ($failed -gt 0) { exit 1 }
exit 0
