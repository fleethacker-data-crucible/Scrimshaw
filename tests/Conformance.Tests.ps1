#requires -Version 5.1
# Checks this app against the FleetAction 1.0.1 public contract.
# The baseline reusable workflow is not called from this repo yet.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
BeforeAll {
    $script:root = Split-Path $PSScriptRoot -Parent
    if (-not $script:root) { $script:root = (Resolve-Path '.').Path }
    Import-Module (Join-Path $script:root 'vendor/FleetAction/FleetAction.psd1') -Force
    Import-Module (Join-Path $script:root 'actions/Scrimshaw.Actions.psm1') -Force
    Initialize-ScrimshawActions -Root $script:root
}

Describe 'FleetAction 1.0.1 conformance' {
    It 'keeps help --json as an alias of commands --json' {
        $a = Invoke-FleetCli -Arguments @('scrimshaw', 'commands', '--json')
        $b = Invoke-FleetCli -Arguments @('scrimshaw', 'help', '--json')
        $a.ExitCode | Should -Be 0
        $a.Json | Should -Be $b.Json
        $doc = $a.Json | ConvertFrom-Json
        $doc.v | Should -Be 1
        @($doc.result.actions).Count | Should -Be 11
    }

    It 'uses -Confirmed via --yes and does not run a destructive handler without it' {
        $out = Join-Path $TestDrive 'course.scrim'
        Invoke-FleetCli -Arguments @('scrimshaw', 'course', 'new', '--title', 'Keep', '--dest', $out, '--json') | Out-Null
        $before = [IO.File]::ReadAllText($out)
        $blocked = Invoke-FleetCli -Arguments @('scrimshaw', 'course', 'settings', '--course', $out, '--title', 'Changed', '--dest', $out, '--replace', 'true', '--json')
        $blocked.ExitCode | Should -Be 4
        ($blocked.Json | ConvertFrom-Json).error.code | Should -Be 'E_CONFIRM'
        [IO.File]::ReadAllText($out) | Should -Be $before
    }

    It 'does not call the handler on --dry-run' {
        $path = Join-Path $TestDrive 'nope.scrim'
        $dry = Invoke-FleetCli -Arguments @('scrimshaw', 'course', 'new', '--title', 'Nope', '--dest', $path, '--dry-run', '--json')
        ($dry.Json | ConvertFrom-Json).result.dryRun | Should -BeTrue
        Test-Path -LiteralPath $path | Should -BeFalse
    }

    It 'accepts only a JSON job file' {
        $bad = Join-Path $TestDrive 'job.yml'
        [IO.File]::WriteAllText($bad, "version: 1`nsteps: []`n")
        $result = Invoke-FleetCli -Arguments @('scrimshaw', 'job', 'run', '--file', $bad, '--json')
        $result.ExitCode | Should -Be 2
        ($result.Json | ConvertFrom-Json).error.code | Should -Be 'E_ARGS'
    }

    It 'records the v1.0.1 pin' {
        $lock = Get-Content -LiteralPath (Join-Path $script:root 'vendor/FleetAction/LOCK.json') -Raw | ConvertFrom-Json
        $lock.version | Should -Be 'v1.0.1'
        $lock.sourceCommit | Should -Be '07f147613c03fa571ed916d64d7e8929937d00f6'
        $lock.zipSha256 | Should -Be '8154C70544CFF424BB1BCEF3BF194EDC17C29A58AB0F37A29E751BEFD4B657C1'
    }
}
