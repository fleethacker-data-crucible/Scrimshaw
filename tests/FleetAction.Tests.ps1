#requires -Version 5.1
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

BeforeAll {
    $script:root = Split-Path $PSScriptRoot -Parent
    if (-not $script:root) { $script:root = (Resolve-Path '.').Path }
    Import-Module (Join-Path $script:root 'vendor/FleetAction/FleetAction.psm1') -Force
    Import-Module (Join-Path $script:root 'actions/Scrimshaw.Actions.psm1') -Force
    Initialize-ScrimshawActions -Root $script:root
    function script:Read-Json([string]$Text) { return ($Text | ConvertFrom-Json) }
    function script:Invoke-Scrim([string[]]$Argv) { return (Invoke-FleetActionCli -Argv $Argv) }
}

Describe 'discovery' {
    It 'lists every action from commands --json and help --json' {
        $commands = Invoke-Scrim @('commands', '--json')
        $help = Invoke-Scrim @('help', '--json')
        $commands.Exit | Should -Be 0
        $help.Exit | Should -Be 0
        $commands.Stdout | Should -Be $help.Stdout
        $doc = Read-Json $commands.Stdout
        $ids = @($doc.commands | ForEach-Object { $_.id })
        $registered = @(Get-FleetAction | ForEach-Object { $_.Id })
        $ids.Count | Should -Be $registered.Count
        foreach ($id in $registered) { $ids | Should -Contain $id }
        foreach ($id in $ids) { $id | Should -Match '^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$' }
        $flagNames = @($doc.globalFlags | ForEach-Object { $_.name })
        $flagNames | Should -Contain 'confirmed'
        $flagNames | Should -Contain 'dry-run'
        $flagNames | Should -Contain 'json'
    }
}

Describe 'scrimshaw.course.new' {
    It 'writes a course and refuses to replace it without --yes' {
        $out = Join-Path $TestDrive 'new.scrim'
        $made = Invoke-Scrim @('course', 'new', '--title', 'Bridge watch', '--out', $out, '--json')
        $made.Exit | Should -Be 0
        $doc = Read-Json $made.Stdout
        $doc.ok | Should -BeTrue
        $doc.data.title | Should -Be 'Bridge watch'
        Test-Path -LiteralPath $out | Should -BeTrue
        $bytes = [IO.File]::ReadAllBytes($out)
        if ($bytes.Length -ge 3) {
            $bom = ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
            $bom | Should -BeFalse
        }
        $again = Invoke-Scrim @('course', 'new', '--title', 'Other', '--out', $out, '--json')
        $again.Exit | Should -Be 1
        (Read-Json $again.Stdout).error.code | Should -Be 'exists'
        $dry = Invoke-Scrim @('course', 'new', '--title', 'Dry', '--out', (Join-Path $TestDrive 'dry.scrim'), '--dry-run', '--json')
        (Read-Json $dry.Stdout).data.written | Should -BeFalse
        Test-Path -LiteralPath (Join-Path $TestDrive 'dry.scrim') | Should -BeFalse
    }
}

Describe 'scrimshaw.course.info' {
    It 'counts slides in a course file' {
        $out = Join-Path $TestDrive 'info.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Counted', '--out', $out) | Out-Null
        $info = Invoke-Scrim @('course', 'info', '--file', $out, '--json')
        $info.Exit | Should -Be 0
        $doc = Read-Json $info.Stdout
        $doc.data.title | Should -Be 'Counted'
        $doc.data.slides | Should -Be 1
        $doc.data.scenes | Should -Be 1
        $missing = Invoke-Scrim @('course', 'info', '--file', (Join-Path $TestDrive 'missing.scrim'), '--json')
        $missing.Exit | Should -Be 1
        (Read-Json $missing.Stdout).error.code | Should -Be 'not-found'
    }
}

Describe 'scrimshaw.course.validate' {
    It 'exits 2 when a trigger points at a missing slide' {
        $out = Join-Path $TestDrive 'bad.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Checked', '--out', $out) | Out-Null
        $good = Invoke-Scrim @('course', 'validate', '--file', $out, '--json')
        $good.Exit | Should -Be 0
        (Read-Json $good.Stdout).data.valid | Should -BeTrue
        $course = Read-Json ([IO.File]::ReadAllText($out))
        $obj = $course.course.scenes[0].slides[0].layers[0].objects[0]
        $obj | Add-Member -NotePropertyName triggers -NotePropertyValue @(
            [pscustomobject]@{
                id = 't1'; enabled = $true; join = 'and'; conditions = @()
                event = [pscustomobject]@{ type = 'click' }
                action = [pscustomobject]@{ type = 'jump-slide'; slideId = 'gone' }
            }
        ) -Force
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText($out, (ConvertTo-FleetJson $course), $utf8)
        $bad = Invoke-Scrim @('course', 'validate', '--file', $out, '--json')
        $bad.Exit | Should -Be 2
        $doc = Read-Json $bad.Stdout
        $doc.ok | Should -BeFalse
        $doc.data.valid | Should -BeFalse
        @($doc.data.problems).Count | Should -BeGreaterThan 0
    }
}

Describe 'scrimshaw.course.save' {
    It 'copies a course to a new file' {
        $src = Join-Path $TestDrive 'src.scrim'
        $dst = Join-Path $TestDrive 'copy.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Saved', '--out', $src) | Out-Null
        $saved = Invoke-Scrim @('course', 'save', '--file', $src, '--out', $dst, '--json')
        $saved.Exit | Should -Be 0
        (Read-Json ([IO.File]::ReadAllText($dst))).course.title | Should -Be 'Saved'
    }
}

Describe 'scrimshaw.course.settings' {
    It 'requires --confirmed and then updates the title' {
        $src = Join-Path $TestDrive 'set.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Old', '--out', $src) | Out-Null
        $blocked = Invoke-Scrim @('course', 'settings', '--file', $src, '--title', 'New', '--out', $src, '--json')
        $blocked.Exit | Should -Be 1
        (Read-Json $blocked.Stdout).error.code | Should -Be 'confirm'
        (Read-Json ([IO.File]::ReadAllText($src))).course.title | Should -Be 'Old'
        $dry = Invoke-Scrim @('course', 'settings', '--file', $src, '--title', 'New', '--out', $src, '--dry-run', '--json')
        $dry.Exit | Should -Be 0
        (Read-Json $dry.Stdout).data.written | Should -BeFalse
        (Read-Json ([IO.File]::ReadAllText($src))).course.title | Should -Be 'Old'
        $ok = Invoke-Scrim @('course', 'settings', '--file', $src, '--title', 'New', '--passPercent', '70', '--navigation', 'restricted', '--out', $src, '--yes', '--confirmed', '--json')
        $ok.Exit | Should -Be 0
        $course = (Read-Json ([IO.File]::ReadAllText($src))).course
        $course.title | Should -Be 'New'
        $course.quiz.passPercent | Should -Be 70
        $course.player.navigation | Should -Be 'restricted'
    }
}

Describe 'scrimshaw.course.replace' {
    It 'replaces text only when confirmed' {
        $src = Join-Path $TestDrive 'rep.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Hello course', '--out', $src) | Out-Null
        $blocked = Invoke-Scrim @('course', 'replace', '--file', $src, '--find', 'Hello', '--replacement', 'Welcome', '--out', $src, '--json')
        (Read-Json $blocked.Stdout).error.code | Should -Be 'confirm'
        $done = Invoke-Scrim @('course', 'replace', '--file', $src, '--find', 'Hello', '--replacement', 'Welcome', '--out', $src, '--yes', '--confirmed', '--json')
        $done.Exit | Should -Be 0
        (Read-Json $done.Stdout).data.replaced | Should -BeGreaterThan 0
        (Read-Json ([IO.File]::ReadAllText($src))).course.title | Should -Be 'Welcome course'
    }
}

Describe 'scrimshaw.course.export-texts' {
    It 'writes a CSV with a key column' {
        $src = Join-Path $TestDrive 'text.scrim'
        $csv = Join-Path $TestDrive 'texts.csv'
        Invoke-Scrim @('course', 'new', '--title', 'Translate me', '--out', $src) | Out-Null
        $exported = Invoke-Scrim @('course', 'export-texts', '--file', $src, '--out', $csv, '--json')
        $exported.Exit | Should -Be 0
        $text = [IO.File]::ReadAllText($csv)
        $text | Should -Match 'course:title'
        $text | Should -Match 'Translate me'
    }
}

Describe 'scrimshaw.course.import-texts' {
    It 'applies a translation CSV when confirmed' {
        $src = Join-Path $TestDrive 'imp.scrim'
        $csv = Join-Path $TestDrive 'tr.csv'
        Invoke-Scrim @('course', 'new', '--title', 'Original', '--out', $src) | Out-Null
        Invoke-Scrim @('course', 'export-texts', '--file', $src, '--out', $csv) | Out-Null
        $raw = [IO.File]::ReadAllText($csv)
        $lines = $raw -split "`r`n"
        $rewritten = New-Object System.Collections.Generic.List[string]
        foreach ($line in $lines) {
            if ($line -match '^course:title,') { [void]$rewritten.Add('course:title,,,Original,Harbour watch') }
            elseif ($line) { [void]$rewritten.Add($line) }
        }
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText($csv, ($rewritten -join "`r`n"), $utf8)
        $blocked = Invoke-Scrim @('course', 'import-texts', '--file', $src, '--csvFile', $csv, '--out', $src, '--json')
        (Read-Json $blocked.Stdout).error.code | Should -Be 'confirm'
        $done = Invoke-Scrim @('course', 'import-texts', '--file', $src, '--csvFile', $csv, '--out', $src, '--yes', '--confirmed', '--json')
        $done.Exit | Should -Be 0
        (Read-Json $done.Stdout).data.applied | Should -BeGreaterThan 0
        (Read-Json ([IO.File]::ReadAllText($src))).course.title | Should -Be 'Harbour watch'
    }
}

Describe 'scrimshaw.course.publish' {
    It 'builds HTML and a SCORM zip from the shell' {
        $src = Join-Path $TestDrive 'pub.scrim'
        $shell = Join-Path $TestDrive 'shell.html'
        $html = Join-Path $TestDrive 'course.html'
        $zip = Join-Path $TestDrive 'course.zip'
        Invoke-Scrim @('course', 'new', '--title', 'Published', '--out', $src) | Out-Null
        $page = "<!doctype html><html><head><meta http-equiv=`"Content-Security-Policy`" content=`"connect-src 'self' http://127.0.0.1:8776 http://localhost:8776`"><title>Scrimshaw</title></head><body></body></html>"
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText($shell, $page, $utf8)
        $built = Invoke-Scrim @('course', 'publish', '--file', $src, '--format', 'html', '--shell', $shell, '--out', $html, '--json')
        $built.Exit | Should -Be 0
        $body = [IO.File]::ReadAllText($html)
        $body | Should -Match 'scrimshaw-course'
        $body | Should -Match 'Published'
        $body | Should -Match "connect-src 'none'"
        $packed = Invoke-Scrim @('course', 'publish', '--file', $src, '--format', 'scorm12', '--shell', $shell, '--out', $zip, '--json')
        $packed.Exit | Should -Be 0
        $magic = [IO.File]::ReadAllBytes($zip)
        $magic[0] | Should -Be 0x50
        $magic[1] | Should -Be 0x4B
        $bad = Invoke-Scrim @('course', 'publish', '--file', $src, '--format', 'pdf', '--out', $html, '--json')
        $bad.Exit | Should -Be 64
    }
}

Describe 'scrimshaw.media.import' {
    It 'adds Capstan video and a SnapShackle PNG when confirmed' {
        $src = Join-Path $TestDrive 'media.scrim'
        Invoke-Scrim @('course', 'new', '--title', 'Chain', '--out', $src) | Out-Null
        $media = @(
            (Join-Path $script:root 'examples/fixtures/capstan-bridge.mp4'),
            (Join-Path $script:root 'examples/fixtures/capstan-bridge.vtt'),
            (Join-Path $script:root 'examples/fixtures/snapshackle-quarterdeck.png'),
            (Join-Path $script:root 'examples/fixtures/snapshackle-quarterdeck.png.meta.json'),
            (Join-Path $script:root 'examples/fixtures/talkforge-bridge.wav')
        )
        $argv = @('media', 'import', '--file', $src, '--out', $src, '--json')
        foreach ($path in $media) { $argv += @('--media', $path) }
        $blocked = Invoke-Scrim $argv
        (Read-Json $blocked.Stdout).error.code | Should -Be 'confirm'
        @((Read-Json ([IO.File]::ReadAllText($src))).course.scenes).Count | Should -Be 1
        $argv += '--confirmed'
        $argv += '--yes'
        $done = Invoke-Scrim $argv
        $done.Exit | Should -Be 0
        $doc = Read-Json $done.Stdout
        $doc.data.slides | Should -Be 3
        $course = (Read-Json ([IO.File]::ReadAllText($src))).course
        @($course.scenes).Count | Should -Be 2
        @($course.scenes[1].slides).Count | Should -Be 3
    }
}

Describe 'scrimshaw.session.stop' {
    It 'does not call the server unless confirmed' {
        $blocked = Invoke-Scrim @('session', 'stop', '--port', '9', '--json')
        (Read-Json $blocked.Stdout).error.code | Should -Be 'confirm'
        $dry = Invoke-Scrim @('session', 'stop', '--port', '9', '--dry-run', '--json')
        $dry.Exit | Should -Be 0
        (Read-Json $dry.Stdout).data.stopping | Should -BeFalse
    }
}

Describe 'jobs' {
    It 'runs a JSON job and rejects any other extension' {
        $dir = Join-Path $TestDrive 'job'
        New-Item -ItemType Directory -Path $dir | Out-Null
        $out = Join-Path $dir 'bridge.scrim'
        $html = Join-Path $dir 'bridge.html'
        $shell = Join-Path $dir 'shell.html'
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText($shell, "<!doctype html><html><head><title>Scrimshaw</title></head><body></body></html>", $utf8)
        $job = [ordered]@{
            version = 1
            actions = @(
                [ordered]@{ id = 'scrimshaw.course.new'; args = [ordered]@{ title = 'Bridge watch'; out = $out; yes = $true } }
                [ordered]@{ id = 'scrimshaw.media.import'; args = [ordered]@{
                    file = $out; out = $out; yes = $true; confirmed = $true
                    media = @(
                        (Join-Path $script:root 'examples/fixtures/capstan-bridge.mp4'),
                        (Join-Path $script:root 'examples/fixtures/capstan-bridge.vtt'),
                        (Join-Path $script:root 'examples/fixtures/snapshackle-quarterdeck.png'),
                        (Join-Path $script:root 'examples/fixtures/snapshackle-quarterdeck.png.meta.json')
                    )
                } }
                [ordered]@{ id = 'scrimshaw.course.publish'; args = [ordered]@{ file = $out; format = 'html'; shell = $shell; out = $html; yes = $true } }
            )
        }
        $jobPath = Join-Path $dir 'chain.job.json'
        [IO.File]::WriteAllText($jobPath, (ConvertTo-FleetJson $job), $utf8)
        $ran = Invoke-FleetJob -Path $jobPath
        $ran.Ok | Should -BeTrue
        $ran.Data.count | Should -Be 3
        Test-Path -LiteralPath $html | Should -BeTrue
        ([IO.File]::ReadAllText($html)) | Should -Match 'Bridge watch'
        $yaml = Join-Path $dir 'chain.job.yml'
        [IO.File]::WriteAllText($yaml, 'actions: []', $utf8)
        $refused = Invoke-FleetJob -Path $yaml
        $refused.Ok | Should -BeFalse
        $refused.Code | Should -Be 'usage'
    }
}

Describe 'loopback API' {
    It 'serves actions on 127.0.0.1 and keeps the token out of the log helper' {
        $clean = Protect-FleetLog 'Authorization: Bearer super-secret-token token=abc123'
        $clean | Should -Not -Match 'super-secret-token'
        $clean | Should -Not -Match 'abc123'
        $port = 0
        foreach ($candidate in 18780..18799) {
            try {
                $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $candidate)
                $probe.Start(); $probe.Stop(); $port = $candidate; break
            } catch {}
        }
        $port | Should -BeGreaterThan 0
        $job = Start-Job -ArgumentList $script:root, $port -ScriptBlock {
            param($Repo, $Listen)
            Import-Module (Join-Path $Repo 'vendor/FleetAction/FleetAction.psm1') -Force
            Import-Module (Join-Path $Repo 'actions/Scrimshaw.Actions.psm1') -Force
            Initialize-ScrimshawActions -Root $Repo
            Start-FleetActionListener -Port $Listen
        }
        try {
            $ready = $false
            $session = $null
            foreach ($try in 1..40) {
                try {
                    $session = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/session" -TimeoutSec 2
                    if ($session.StatusCode -eq 200) { $ready = $true; break }
                } catch { Start-Sleep -Milliseconds 150 }
            }
            $ready | Should -BeTrue
            $doc = $session.Content | ConvertFrom-Json
            $tokenProp = $doc.PSObject.Properties['token']
            $null -eq $tokenProp | Should -BeFalse
            ([string]$tokenProp.Value).Length | Should -BeGreaterThan 16
            $denied = $null
            try {
                Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$port/api/actions/scrimshaw/course/new" -ContentType 'application/json' -Body '{"title":"X","inline":true}' -TimeoutSec 5
            } catch { $denied = $_.Exception.Response }
            $denied | Should -Not -BeNullOrEmpty
            $made = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://127.0.0.1:$port/api/actions/scrimshaw/course/new" -Headers @{ 'X-Fleet-Action-Token' = [string]$tokenProp.Value } -ContentType 'application/json' -Body '{"title":"From the API","inline":true}' -TimeoutSec 10
            $made.StatusCode | Should -Be 200
            (Read-Json $made.Content).data.title | Should -Be 'From the API'
            $made.Content | Should -Not -Match ([regex]::Escape([string]$tokenProp.Value))
        } finally {
            Stop-Job $job -ErrorAction SilentlyContinue
            Remove-Job $job -Force -ErrorAction SilentlyContinue
        }
    }
}

Describe 'GUI parity' {
    It 'maps every data-action to a registered action, and help --json lists them all' {
        $registered = @(Get-FleetAction | ForEach-Object { $_.Id })
        $found = New-Object System.Collections.Generic.List[string]
        $rx = [regex]'data-action="(scrimshaw\.[a-z0-9-]+\.[a-z0-9-]+)"|action:\s*''(scrimshaw\.[a-z0-9-]+\.[a-z0-9-]+)'''
        Get-ChildItem -Path (Join-Path $script:root 'src') -Recurse -Include *.ts,*.tsx | ForEach-Object {
            $text = [IO.File]::ReadAllText($_.FullName)
            foreach ($match in $rx.Matches($text)) {
                $id = $match.Groups[1].Value
                if (-not $id) { $id = $match.Groups[2].Value }
                if ($id) { [void]$found.Add($id) }
            }
        }
        $found.Count | Should -BeGreaterThan 5
        foreach ($id in $found) { $registered | Should -Contain $id }
        $help = Read-Json (Invoke-Scrim @('help', '--json')).Stdout
        $listed = @($help.commands | ForEach-Object { $_.id })
        foreach ($id in $registered) { $listed | Should -Contain $id }
        $joined = (Get-ChildItem -Path (Join-Path $script:root 'src') -Recurse -Include *.ts,*.tsx,*.html | ForEach-Object { [IO.File]::ReadAllText($_.FullName) }) -join "`n"
        $joined | Should -Not -Match 'data-token='
        $joined | Should -Not -Match 'X-Fleet-Action-Token='
    }
}
