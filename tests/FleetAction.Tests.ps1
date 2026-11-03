#requires -Version 5.1
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
BeforeAll {
    $script:root = Split-Path $PSScriptRoot -Parent
    if (-not $script:root) { $script:root = (Resolve-Path '.').Path }
    Import-Module (Join-Path $script:root 'vendor/FleetAction/FleetAction.psd1') -Force
    Import-Module (Join-Path $script:root 'actions/Scrimshaw.Actions.psm1') -Force
    Initialize-ScrimshawActions -Root $script:root
    function script:Invoke-Scrim([string[]]$Argv) {
        $mapped = New-Object System.Collections.Generic.List[string]
        [void]$mapped.Add('scrimshaw')
        $seen = $false
        foreach ($token in @($Argv)) {
            if ([string]$token -eq '--confirmed') {
                if (-not $seen) { [void]$mapped.Add('--yes'); $seen = $true }
            } else {
                if ([string]$token -eq '--yes') { $seen = $true }
                [void]$mapped.Add([string]$token)
            }
        }
        return (Invoke-FleetCli -Arguments $mapped.ToArray())
    }
    function script:Read-Result($Cli) {
        return ($Cli.Json | ConvertFrom-Json)
    }
}

Describe 'discovery' {
    It 'lists every action from commands --json and help --json' {
        $commands = Invoke-Scrim @('commands', '--json')
        $help = Invoke-Scrim @('help', '--json')
        $commands.ExitCode | Should -Be 0
        $commands.Json | Should -Be $help.Json
        $doc = Read-Result $commands
        $doc.v | Should -Be 1
        $doc.ok | Should -BeTrue
        $ids = @($doc.result.actions | ForEach-Object { $_.id })
        $ids.Count | Should -Be 11
        $ids | Should -Contain 'scrimshaw.course.new'
        $ids | Should -Contain 'scrimshaw.session.stop'
        foreach ($id in $ids) { $id | Should -Match '^scrimshaw\.[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$' }
    }
}

Describe 'scrimshaw.course.new' {
    It 'writes a course and refuses to replace it without --replace true' {
        $out = Join-Path $TestDrive 'new.scrim'
        $made = Invoke-Scrim @('course', 'new', '--title', 'Bridge watch', '--dest', $out, '--json')
        $made.ExitCode | Should -Be 0
        (Read-Result $made).result.title | Should -Be 'Bridge watch'
        $again = Invoke-Scrim @('course', 'new', '--title', 'Other', '--dest', $out, '--json')
        $again.ExitCode | Should -Be 2
        (Read-Result $again).error.code | Should -Be 'E_ARGS'
        $dry = Invoke-Scrim @('course', 'new', '--title', 'Dry', '--dest', (Join-Path $TestDrive 'dry.scrim'), '--dry-run', '--json')
        $dry.ExitCode | Should -Be 0
        (Read-Result $dry).result.dryRun | Should -BeTrue
        Test-Path -LiteralPath (Join-Path $TestDrive 'dry.scrim') | Should -BeFalse
    }
}

Describe 'scrimshaw.course.info' {
    It 'counts slides' {
        $out = Join-Path $TestDrive 'info.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Counted', '--dest', $out, '--json') | Out-Null
        $info = Invoke-Scrim @('course', 'info', '--course', $out, '--json')
        $info.ExitCode | Should -Be 0
        (Read-Result $info).result.slides | Should -Be 1
        $missing = Invoke-Scrim @('course', 'info', '--course', (Join-Path $TestDrive 'missing.scrim'), '--json')
        $missing.ExitCode | Should -Be 3
        (Read-Result $missing).error.code | Should -Be 'E_NOT_FOUND'
    }
}

Describe 'scrimshaw.course.validate' {
    It 'reports a trigger that points at a missing slide' {
        $out = Join-Path $TestDrive 'bad.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Checked', '--dest', $out, '--json') | Out-Null
        $good = Invoke-Scrim @('course', 'validate', '--course', $out, '--json')
        (Read-Result $good).result.valid | Should -BeTrue
        $course = (Get-Content -LiteralPath $out -Raw | ConvertFrom-Json)
        $obj = $course.course.scenes[0].slides[0].layers[0].objects[0]
        $obj | Add-Member -NotePropertyName triggers -NotePropertyValue @(
            [pscustomobject]@{
                id = 't1'; enabled = $true; join = 'and'; conditions = @()
                event = [pscustomobject]@{ type = 'click' }
                action = [pscustomobject]@{ type = 'jump-slide'; slideId = 'gone' }
            }
        ) -Force
        $module = Get-Module FleetAction
        $script = $module.NewBoundScriptBlock({ param($Item) ConvertTo-FleetJson -Value $Item })
        $json = [string]$script.Invoke($course)
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText($out, $json.Trim(), $utf8)
        $bad = Invoke-Scrim @('course', 'validate', '--course', $out, '--json')
        $bad.ExitCode | Should -Be 0
        $doc = Read-Result $bad
        $doc.result.valid | Should -BeFalse
        @($doc.result.problems).Count | Should -BeGreaterThan 0
    }
}

Describe 'scrimshaw.course.settings' {
    It 'requires --confirmed and then updates the title' {
        $src = Join-Path $TestDrive 'set.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Old', '--dest', $src, '--json') | Out-Null
        $blocked = Invoke-Scrim @('course', 'settings', '--course', $src, '--title', 'New', '--dest', $src, '--replace', 'true', '--json')
        $blocked.ExitCode | Should -Be 4
        (Read-Result $blocked).error.code | Should -Be 'E_CONFIRM'
        $dry = Invoke-Scrim @('course', 'settings', '--course', $src, '--title', 'New', '--dest', $src, '--replace', 'true', '--dry-run', '--json')
        $dry.ExitCode | Should -Be 0
        (Read-Result $dry).result.confirmationRequired | Should -BeTrue
        ((Get-Content -LiteralPath $src -Raw | ConvertFrom-Json).course.title) | Should -Be 'Old'
        $ok = Invoke-Scrim @('course', 'settings', '--course', $src, '--title', 'New', '--passPercent', '70', '--navigation', 'restricted', '--dest', $src, '--replace', 'true', '--confirmed', '--json')
        $ok.ExitCode | Should -Be 0
        $course = (Get-Content -LiteralPath $src -Raw | ConvertFrom-Json).course
        $course.title | Should -Be 'New'
        $course.player.navigation | Should -Be 'restricted'
    }
}

Describe 'scrimshaw.course.replace' {
    It 'replaces text only when confirmed' {
        $src = Join-Path $TestDrive 'rep.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Hello course', '--dest', $src, '--json') | Out-Null
        $blocked = Invoke-Scrim @('course', 'replace', '--course', $src, '--find', 'Hello', '--replacement', 'Welcome', '--dest', $src, '--replace', 'true', '--json')
        (Read-Result $blocked).error.code | Should -Be 'E_CONFIRM'
        $done = Invoke-Scrim @('course', 'replace', '--course', $src, '--find', 'Hello', '--replacement', 'Welcome', '--dest', $src, '--replace', 'true', '--confirmed', '--json')
        $done.ExitCode | Should -Be 0
        (Read-Result $done).result.replaced | Should -BeGreaterThan 0
        ((Get-Content -LiteralPath $src -Raw | ConvertFrom-Json).course.title) | Should -Be 'Welcome course'
    }
}

Describe 'scrimshaw.course.export-texts and import-texts' {
    It 'round-trips a translation when confirmed' {
        $src = Join-Path $TestDrive 'text.scrim'
        $csv = Join-Path $TestDrive 'texts.csv'
        Invoke-Scrim @('course', 'new', '--title', 'Original', '--dest', $src, '--json') | Out-Null
        $exported = Invoke-Scrim @('course', 'export-texts', '--course', $src, '--dest', $csv, '--json')
        $exported.ExitCode | Should -Be 0
        $raw = [IO.File]::ReadAllText($csv)
        $lines = $raw -split "`r`n"
        $rewritten = New-Object System.Collections.Generic.List[string]
        foreach ($line in $lines) {
            if ($line -match '^course:title,') { [void]$rewritten.Add('course:title,,,Original,Harbour watch') }
            elseif ($line) { [void]$rewritten.Add($line) }
        }
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText($csv, ($rewritten -join "`r`n"), $utf8)
        $blocked = Invoke-Scrim @('course', 'import-texts', '--course', $src, '--csvFile', $csv, '--dest', $src, '--replace', 'true', '--json')
        (Read-Result $blocked).error.code | Should -Be 'E_CONFIRM'
        $done = Invoke-Scrim @('course', 'import-texts', '--course', $src, '--csvFile', $csv, '--dest', $src, '--replace', 'true', '--confirmed', '--json')
        $done.ExitCode | Should -Be 0
        ((Get-Content -LiteralPath $src -Raw | ConvertFrom-Json).course.title) | Should -Be 'Harbour watch'
    }
}

Describe 'scrimshaw.course.publish' {
    It 'builds HTML and a zip' {
        $src = Join-Path $TestDrive 'pub.scrim'
        $shell = Join-Path $TestDrive 'shell.html'
        $html = Join-Path $TestDrive 'course.html'
        $zip = Join-Path $TestDrive 'course.zip'
        Invoke-Scrim @('course', 'new', '--title', 'Published', '--dest', $src, '--json') | Out-Null
        $page = "<!doctype html><html><head><meta http-equiv=`"Content-Security-Policy`" content=`"connect-src 'self' http://127.0.0.1:8776 http://localhost:8776`"><title>Scrimshaw</title></head><body></body></html>"
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText($shell, $page, $utf8)
        $built = Invoke-Scrim @('course', 'publish', '--course', $src, '--format', 'html', '--shell', $shell, '--dest', $html, '--json')
        $built.ExitCode | Should -Be 0
        ([IO.File]::ReadAllText($html)) | Should -Match 'Published'
        $packed = Invoke-Scrim @('course', 'publish', '--course', $src, '--format', 'scorm12', '--shell', $shell, '--dest', $zip, '--json')
        $packed.ExitCode | Should -Be 0
        $magic = [IO.File]::ReadAllBytes($zip)
        $magic[0] | Should -Be 0x50
        $magic[1] | Should -Be 0x4B
    }
}

Describe 'scrimshaw.media.import' {
    It 'adds Capstan video and a SnapShackle PNG when confirmed' {
        $src = Join-Path $TestDrive 'media.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Chain', '--dest', $src, '--json') | Out-Null
        $media = @(
            (Join-Path $script:root 'examples/fixtures/capstan-bridge.mp4'),
            (Join-Path $script:root 'examples/fixtures/capstan-bridge.vtt'),
            (Join-Path $script:root 'examples/fixtures/snapshackle-quarterdeck.png'),
            (Join-Path $script:root 'examples/fixtures/snapshackle-quarterdeck.png.meta.json')
        ) -join '|'
        $blocked = Invoke-Scrim @('media', 'import', '--course', $src, '--dest', $src, '--replace', 'true', '--media', $media, '--json')
        (Read-Result $blocked).error.code | Should -Be 'E_CONFIRM'
        $done = Invoke-Scrim @('media', 'import', '--course', $src, '--dest', $src, '--replace', 'true', '--media', $media, '--confirmed', '--json')
        $done.ExitCode | Should -Be 0
        (Read-Result $done).result.slides | Should -Be 2
    }
}

Describe 'scrimshaw.course.save and session.stop' {
    It 'copies a course and refuses to stop without confirmation' {
        $src = Join-Path $TestDrive 'src.scrim'
        $dst = Join-Path $TestDrive 'copy.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Saved', '--dest', $src, '--json') | Out-Null
        $saved = Invoke-Scrim @('course', 'save', '--course', $src, '--dest', $dst, '--json')
        $saved.ExitCode | Should -Be 0
        ((Get-Content -LiteralPath $dst -Raw | ConvertFrom-Json).course.title) | Should -Be 'Saved'
        $stop = Invoke-Scrim @('session', 'stop', '--port', '9', '--json')
        $stop.ExitCode | Should -Be 4
        (Read-Result $stop).error.code | Should -Be 'E_CONFIRM'
    }
}

Describe 'jobs' {
    It 'runs a version 1 JSON job and rejects other extensions' {
        $dir = Join-Path $TestDrive 'job'
        New-Item -ItemType Directory -Path $dir | Out-Null
        $out = Join-Path $dir 'bridge.scrim'
        $html = Join-Path $dir 'bridge.html'
        $shell = Join-Path $dir 'shell.html'
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText($shell, '<!doctype html><html><head><title>Scrimshaw</title></head><body></body></html>', $utf8)
        $media = @(
            (Join-Path $script:root 'examples/fixtures/capstan-bridge.mp4'),
            (Join-Path $script:root 'examples/fixtures/capstan-bridge.vtt'),
            (Join-Path $script:root 'examples/fixtures/snapshackle-quarterdeck.png'),
            (Join-Path $script:root 'examples/fixtures/snapshackle-quarterdeck.png.meta.json')
        ) -join '|'
        $job = [ordered]@{
            version = 1
            steps = @(
                [ordered]@{ id = 'make'; app = 'scrimshaw'; noun = 'course'; verb = 'new'; args = [ordered]@{ title = 'Bridge watch'; dest = $out; replace = $true } }
                [ordered]@{ id = 'media'; app = 'scrimshaw'; noun = 'media'; verb = 'import'; confirmed = $true; args = [ordered]@{ course = $out; dest = $out; replace = $true; media = $media } }
                [ordered]@{ id = 'publish'; app = 'scrimshaw'; noun = 'course'; verb = 'publish'; args = [ordered]@{ course = $out; format = 'html'; shell = $shell; dest = $html; replace = $true } }
            )
        }
        $module = Get-Module FleetAction
        $script = $module.NewBoundScriptBlock({ param($Item) ConvertTo-FleetJson -Value $Item })
        $jobPath = Join-Path $dir 'chain.job.json'
        [IO.File]::WriteAllText($jobPath, ([string]$script.Invoke($job)).Trim(), $utf8)
        $ran = Invoke-Scrim @('job', 'run', '--file', $jobPath, '--json')
        $ran.ExitCode | Should -Be 0
        ([IO.File]::ReadAllText($html)) | Should -Match 'Bridge watch'
        $yaml = Join-Path $dir 'chain.job.yml'
        [IO.File]::WriteAllText($yaml, 'steps: []', $utf8)
        $refused = Invoke-Scrim @('job', 'run', '--file', $yaml, '--json')
        $refused.ExitCode | Should -Be 2
        (Read-Result $refused).error.code | Should -Be 'E_ARGS'
    }
}
