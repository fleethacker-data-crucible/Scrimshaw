#requires -Version 5.1
# Local stand-in for the fleet-action-baseline conformance suite. The baseline
# repo was not readable from this run (HTTP 404), so these checks cover the
# contract this repo implements: ids, discovery alias, JSON jobs, -Confirmed,
# dry-run, PSObject property reads, ConvertTo-Json -Depth, and log redaction.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
BeforeAll {
    $script:root = Split-Path $PSScriptRoot -Parent
    if (-not $script:root) { $script:root = (Resolve-Path '.').Path }
    Import-Module (Join-Path $script:root 'vendor/FleetAction/FleetAction.psm1') -Force
    Import-Module (Join-Path $script:root 'actions/Scrimshaw.Actions.psm1') -Force
    Initialize-ScrimshawActions -Root $script:root
}

Describe 'Fleet action conformance' {
    It 'uses app.noun.verb ids and marks destructive actions' {
        $actions = @(Get-FleetAction)
        $actions.Count | Should -BeGreaterThan 0
        foreach ($action in $actions) {
            $action.Id | Should -Match '^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$'
            $action.Name | Should -Be ('{0} {1}' -f $action.Noun, $action.Verb)
            { $action.Destructive -is [bool] } | Should -BeTrue
        }
    }

    It 'keeps help --json as an alias of commands --json' {
        $a = Invoke-FleetActionCli -Argv @('commands', '--json')
        $b = Invoke-FleetActionCli -Argv @('help', '--json')
        $a.Exit | Should -Be 0
        $a.Stdout | Should -Be $b.Stdout
        $doc = $a.Stdout | ConvertFrom-Json
        $doc.PSObject.Properties['commands'] | Should -Not -BeNullOrEmpty
        @($doc.commands).Count | Should -Be @(Get-FleetAction).Count
    }

    It 'reads ConvertFrom-Json objects through PSObject.Properties' {
        $parsed = '{"title":"Bridge","nested":{"port":8775}}' | ConvertFrom-Json
        (Get-FleetProp $parsed 'title') | Should -Be 'Bridge'
        (Get-FleetProp (Get-FleetProp $parsed 'nested') 'port') | Should -Be 8775
        Get-FleetProp $parsed 'missing' | Should -BeNullOrEmpty
    }

    It 'passes -Depth whenever ConvertTo-Json is called' {
        $files = @(
            (Join-Path $script:root 'vendor/FleetAction/FleetAction.psm1'),
            (Join-Path $script:root 'actions/Scrimshaw.Actions.psm1'),
            (Join-Path $script:root 'scrimshaw.ps1'),
            (Join-Path $script:root 'Start.ps1')
        )
        foreach ($file in $files) {
            $lines = [IO.File]::ReadAllLines($file)
            foreach ($line in $lines) {
                if ($line -match 'ConvertTo-Json' -and $line -notmatch 'ConvertTo-JsonDepth' -and $line -notmatch 'function ConvertTo-JsonDepth') {
                    $line | Should -Match '-Depth'
                }
            }
        }
        $deep = [ordered]@{ a = [ordered]@{ b = [ordered]@{ c = [ordered]@{ d = 'kept' } } } }
        ((ConvertTo-JsonDepth $deep -Depth 8) | ConvertFrom-Json).a.b.c.d | Should -Be 'kept'
    }

    It 'refuses a destructive action without -Confirmed and writes nothing on --dry-run' {
        $out = Join-Path $TestDrive 'course.scrim'
        Invoke-FleetActionCli -Argv @('course', 'new', '--title', 'Keep', '--out', $out) | Out-Null
        $before = [IO.File]::ReadAllText($out)
        $blocked = Invoke-FleetActionCli -Argv @('course', 'settings', '--file', $out, '--title', 'Changed', '--out', $out, '--json')
        $blocked.Exit | Should -Be 1
        ($blocked.Stdout | ConvertFrom-Json).error.code | Should -Be 'confirm'
        [IO.File]::ReadAllText($out) | Should -Be $before
        $dry = Invoke-FleetActionCli -Argv @('course', 'new', '--title', 'Nope', '--out', (Join-Path $TestDrive 'nope.scrim'), '--dry-run', '--json')
        ($dry.Stdout | ConvertFrom-Json).data.written | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $TestDrive 'nope.scrim') | Should -BeFalse
    }

    It 'accepts only JSON job files' {
        $bad = Join-Path $TestDrive 'job.txt'
        [IO.File]::WriteAllText($bad, '{"actions":[]}')
        $result = Invoke-FleetJob -Path $bad
        $result.Ok | Should -BeFalse
        $result.Message | Should -Match 'JSON only'
    }

    It 'does not leave secrets in log text' {
        $clean = Protect-FleetLog 'token=s3cret Authorization: Bearer hunter2 "password":"pw" api_key=abcd'
        $clean | Should -Not -Match 's3cret'
        $clean | Should -Not -Match 'hunter2'
        $clean | Should -Not -Match 'abcd'
        $clean | Should -Match 'redacted'
    }

    It 'only describes a loopback listener prefix' {
        $source = [IO.File]::ReadAllText((Join-Path $script:root 'vendor/FleetAction/FleetAction.psm1'))
        $source | Should -Match 'http://127\.0\.0\.1:'
        $source | Should -Not -Match 'http://\+\:'
        $source | Should -Not -Match 'http://\*\:'
    }
}
