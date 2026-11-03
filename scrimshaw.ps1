#requires -Version 5.1
<#
  Scrimshaw action CLI (FleetAction 1.0.1).

    scrimshaw.ps1 commands --json
    scrimshaw.ps1 help --json
    scrimshaw.ps1 course info --course course.scrim --json
    scrimshaw.ps1 job run --file examples/training-to-course.job.json
    scrimshaw.ps1 api --port 8775

  --confirmed is the destructive-confirm flag. It is passed to FleetAction as --yes,
  which sets -Confirmed. --dry-run does not call the handler. --replace true overwrites dest.
#>
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false } catch {}

$root = $PSScriptRoot
Import-Module (Join-Path $root 'vendor/FleetAction/FleetAction.psd1') -Force
Import-Module (Join-Path $root 'actions/Scrimshaw.Actions.psm1') -Force
Initialize-ScrimshawActions -Root $root

$argv = @()
if ($args.Count -gt 0) { $argv = @($args) }

if ($argv.Count -ge 1 -and [string]$argv[0] -eq 'api') {
    $port = 8775
    for ($i = 1; $i -lt $argv.Count; $i++) {
        if ([string]$argv[$i] -eq '--port') {
            $i++
            if ($i -ge $argv.Count) { [Console]::Error.WriteLine('scrimshaw: --port needs a number.'); exit 2 }
            $parsed = 0
            if (-not [int]::TryParse([string]$argv[$i], [ref]$parsed)) { [Console]::Error.WriteLine('scrimshaw: --port must be an integer.'); exit 2 }
            $port = $parsed
        } else { [Console]::Error.WriteLine("scrimshaw: unexpected '$($argv[$i])'."); exit 2 }
    }
    Start-FleetServer -App scrimshaw -Port $port
    exit 0
}

$mapped = New-Object System.Collections.Generic.List[string]
[void]$mapped.Add('scrimshaw')
$seenYes = $false
foreach ($token in $argv) {
    if ([string]$token -eq '--confirmed') {
        if (-not $seenYes) { [void]$mapped.Add('--yes'); $seenYes = $true }
    } else {
        if ([string]$token -eq '--yes') { $seenYes = $true }
        [void]$mapped.Add([string]$token)
    }
}
$result = Invoke-FleetCli -Arguments $mapped.ToArray()
if ($result.EmitJson) {
    [Console]::Out.Write($result.Json)
} elseif ([int]$result.ExitCode -eq 0) {
    if ($result.Text) { [Console]::Out.Write($result.Text + "`n") }
} else {
    [Console]::Error.WriteLine([string]$result.Text)
}
exit ([int]$result.ExitCode)
