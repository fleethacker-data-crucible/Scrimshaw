#requires -Version 5.1
# Turnkey Fairlead proxy (issue 31). No real credential, no real Fairlead, no key printed.
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

Describe 'Fairlead local-token proxy' {
    BeforeAll {
        $script:FairleadTestKey = 'fl-abcdefghijklmnopqrstuvwx'
        $script:FairleadOtherKey = 'fl-zzzzzzzzzzzzzzzzzzzzzzzz'
        $root = Split-Path $PSScriptRoot -Parent
        if (-not $root) { $root = (Resolve-Path '.').Path }
        . (Join-Path $root 'FairleadProxy.ps1')
    }
    BeforeEach { Reset-ScrimshawFairleadTestHooks }
    AfterEach { Reset-ScrimshawFairleadTestHooks }

    It 'reads a Fairlead local token and rejects anything that is not one' {
        Read-ScrimshawLocalTokenText ("$script:FairleadTestKey`nsecond line") | Should -Be $script:FairleadTestKey
        Read-ScrimshawLocalTokenText 'fl-short' | Should -BeNullOrEmpty
        Read-ScrimshawLocalTokenText ("$script:FairleadTestKey`r`nInjected: yes") | Should -Be $script:FairleadTestKey
        Read-ScrimshawLocalTokenText "$script:FairleadTestKey`r`nAuthorization: Bearer x" | Should -Be $script:FairleadTestKey
        Test-ScrimshawFairleadKeyText ($script:FairleadTestKey + "`r`nX-Evil: 1") | Should -BeFalse
        Test-ScrimshawFairleadKeyText 'not-a-key-1234567890' | Should -BeFalse
    }

    It 'prefers the Fairlead/Scrimshaw credential over the local-token file' {
        $script:ScrimshawFairleadKeyReader = { param($Target) $Target | Should -Be 'Fairlead/Scrimshaw'; return $script:FairleadTestKey }
        $script:ScrimshawLocalTokenReader = { return $script:FairleadOtherKey }
        $got = Resolve-ScrimshawFairleadKey
        $got.Source | Should -Be 'credential'
        $got.Key | Should -Be $script:FairleadTestKey
        $script:ScrimshawFairleadKeyReader = { return $null }
        (Resolve-ScrimshawFairleadKey).Source | Should -Be 'local-token'
        (Resolve-ScrimshawFairleadKey).Key | Should -Be $script:FairleadOtherKey
    }

    It 'accepts only a fairlead id whose pid owns the port and whose path is that process' {
        $id = [pscustomobject]@{ tool = 'fairlead'; pid = 40; path = 'C:\Fairlead\Fairlead.exe' }
        $proc = @{ CommandLine = ''; ExecutablePath = 'C:\Fairlead\Fairlead.exe' }
        (Test-ScrimshawFairleadIdentity -Id $id -Owners @(40) -Process $proc).Ok | Should -BeTrue
        $scriptId = [pscustomobject]@{ tool = 'fairlead'; pid = 40; path = 'C:\Fairlead\scripts\Start-Fairlead.ps1' }
        $scriptProc = @{ CommandLine = 'powershell.exe -NoProfile -File C:\Fairlead\scripts\Start-Fairlead.ps1 --no-browser'; ExecutablePath = 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' }
        (Test-ScrimshawFairleadIdentity -Id $scriptId -Owners @(40) -Process $scriptProc).Ok | Should -BeTrue
        (Test-ScrimshawFairleadIdentity -Id ([pscustomobject]@{ tool = 'other'; pid = 40; path = 'C:\Fairlead\Fairlead.exe' }) -Owners @(40) -Process $proc).Problem | Should -Be 'tool'
        (Test-ScrimshawFairleadIdentity -Id $id -Owners @(7) -Process $proc).Problem | Should -Be 'owner'
        (Test-ScrimshawFairleadIdentity -Id ([pscustomobject]@{ tool = 'fairlead'; pid = 4; path = 'C:\Fairlead\Fairlead.exe' }) -Owners @(4) -Process $proc).Problem | Should -Be 'pid'
        (Test-ScrimshawFairleadIdentity -Id $id -Owners @(40) -Process @{ CommandLine = 'C:\Fairlead\Fairlead.exe --extra'; ExecutablePath = 'C:\Other\Fairlead.exe' }).Problem | Should -Be 'path'
        (Test-ScrimshawFairleadIdentity -Id $null -Owners @() -Process $null).Problem | Should -Be 'none'
    }

    It 'does not treat a path that merely contains the real path as a match' {
        $id = [pscustomobject]@{ tool = 'fairlead'; pid = 40; path = 'C:\Fairlead\Fairlead.exe' }
        $proc = @{ CommandLine = ''; ExecutablePath = 'C:\Fairlead\Fairlead.exe.evil' }
        (Test-ScrimshawFairleadIdentity -Id $id -Owners @(40) -Process $proc).Ok | Should -BeFalse
    }

    It 'forwards a draft with the server key and drops a key the page tried to send' {
        $script:ScrimshawHookBase = 'http://127.0.0.1:8776'
        $script:ScrimshawHookProbe = { return [pscustomobject]@{ tool = 'fairlead'; pid = 40; path = 'C:\Fairlead\Fairlead.exe' } }
        $script:ScrimshawHookOwners = { return @(40) }
        $script:ScrimshawHookProcess = { return @{ CommandLine = ''; ExecutablePath = 'C:\Fairlead\Fairlead.exe' } }
        $script:ScrimshawHookKey = { return @{ Key = $script:FairleadTestKey; Source = 'local-token' } }
        $seen = @{ Url = ''; Key = ''; Privacy = $false }
        $script:ScrimshawHookForward = {
            param($Url, $Key, $Privacy, $BodyBytes, $ContentType)
            $seen.Url = $Url; $seen.Key = $Key; $seen.Privacy = [bool]$Privacy
            return @{ Status = 200; Reason = 'OK'; Type = 'application/json'; Body = [Text.Encoding]::UTF8.GetBytes('{"choices":[{"message":{"content":"ok"}}]}') }
        }
        $hdr = @{ 'content-type' = 'application/json'; 'authorization' = 'Bearer page-typed'; 'x-fairlead-privacy' = 'local' }
        $body = [Text.Encoding]::UTF8.GetBytes('{"model":"auto","messages":[]}')
        $r = Invoke-ScrimshawFairleadRoute -Method 'POST' -Route '/api/fairlead/v1/chat/completions' -Headers $hdr -Body $body
        $r.Status | Should -Be 200
        $seen.Url | Should -Be 'http://127.0.0.1:8776/v1/chat/completions'
        $seen.Key | Should -Be $script:FairleadTestKey
        $seen.Privacy | Should -BeTrue
        $seen.Key | Should -Not -Be 'page-typed'
    }

    It 'does not send the key when the port is not Fairlead, and does not start over a taken port' {
        $script:ScrimshawHookProbe = { return [pscustomobject]@{ tool = 'talkforge'; pid = 9; path = 'C:\TalkForge\talkforge.exe' } }
        $script:ScrimshawHookOwners = { return @(9) }
        $script:ScrimshawHookProcess = { return @{ CommandLine = ''; ExecutablePath = 'C:\TalkForge\talkforge.exe' } }
        $script:started = $false
        $script:ScrimshawHookStart = { $script:started = $true; return @{ State = 'running'; Reason = '' } }
        $script:ScrimshawHookForward = { throw 'must not forward' }
        $script:ScrimshawHookKey = { return @{ Key = $script:FairleadTestKey; Source = 'credential' } }
        $hdr = @{ 'content-type' = 'application/json' }
        $body = [Text.Encoding]::UTF8.GetBytes('{"model":"auto"}')
        $r = Invoke-ScrimshawFairleadRoute -Method 'POST' -Route '/api/fairlead/v1/chat/completions' -Headers $hdr -Body $body
        $r.Status | Should -Be 503
        [Text.Encoding]::UTF8.GetString($r.Body) | Should -Not -Match 'fl-'
        $script:started | Should -BeFalse
    }

    It 'starts Fairlead when nothing is listening, then forwards only after the id check passes' {
        $script:calls = 0
        $script:ScrimshawHookProbe = {
            $script:calls++
            if ($script:calls -lt 2) { return $null }
            return [pscustomobject]@{ tool = 'fairlead'; pid = 41; path = 'C:\Fairlead\Fairlead.exe' }
        }
        $script:ScrimshawHookOwners = { return @(41) }
        $script:ScrimshawHookProcess = { return @{ CommandLine = ''; ExecutablePath = 'C:\Fairlead\Fairlead.exe' } }
        $script:ScrimshawHookStart = { return @{ State = 'starting'; Reason = 'starting' } }
        $script:ScrimshawHookKey = { return @{ Key = $script:FairleadTestKey; Source = 'local-token' } }
        $script:forwarded = $false
        $script:ScrimshawHookForward = { $script:forwarded = $true; return @{ Status = 200; Reason = 'OK'; Type = 'application/json'; Body = [Text.Encoding]::UTF8.GetBytes('{}') } }
        $r = Invoke-ScrimshawFairleadRoute -Method 'POST' -Route '/api/fairlead/v1/chat/completions' -Headers @{ 'content-type' = 'application/json' } -Body ([Text.Encoding]::UTF8.GetBytes('{"model":"auto"}'))
        $r.Status | Should -Be 200
        $script:forwarded | Should -BeTrue
        $script:calls | Should -BeGreaterOrEqual 2
    }

    It 'reports status without the key and without starting Fairlead' {
        $script:ScrimshawHookProbe = { return $null }
        $script:ScrimshawHookOwners = { return @() }
        $script:started = $false
        $script:ScrimshawHookStart = { $script:started = $true; return @{ State = 'running'; Reason = '' } }
        $script:ScrimshawLocalTokenReader = { return $script:FairleadTestKey }
        $r = Invoke-ScrimshawFairleadRoute -Method 'GET' -Route '/api/fairlead/status' -Headers @{} -Body ([byte[]]@())
        $r.Status | Should -Be 200
        $text = [Text.Encoding]::UTF8.GetString($r.Body)
        $text | Should -Not -Match 'fl-'
        ($text | ConvertFrom-Json).key | Should -Be 'local-token'
        ($text | ConvertFrom-Json).fairlead | Should -Be 'stopped'
        $script:started | Should -BeFalse
    }

    It 'forwards speech as JSON and a recording as multipart, and keeps the key off the page' {
        $script:ScrimshawHookBase = 'http://127.0.0.1:8776'
        $script:ScrimshawHookProbe = { return [pscustomobject]@{ tool = 'fairlead'; pid = 40; path = 'C:\Fairlead\Fairlead.exe' } }
        $script:ScrimshawHookOwners = { return @(40) }
        $script:ScrimshawHookProcess = { return @{ CommandLine = ''; ExecutablePath = 'C:\Fairlead\Fairlead.exe' } }
        $script:ScrimshawHookKey = { return @{ Key = $script:FairleadTestKey; Source = 'local-token' } }
        $seen = @{ Url = ''; Type = '' }
        $script:ScrimshawHookForward = {
            param($Url, $Key, $Privacy, $BodyBytes, $ContentType)
            if ($Key -ne $script:FairleadTestKey) { throw 'wrong key' }
            $seen.Url = $Url; $seen.Type = $ContentType
            $wav = [Text.Encoding]::ASCII.GetBytes('RIFF')
            return @{ Status = 200; Reason = 'OK'; Type = 'audio/wav'; Body = $wav }
        }
        $speech = [Text.Encoding]::UTF8.GetBytes('{"input":"Hello","voice":"en_US-libritts-high","response_format":"wav"}')
        $r = Invoke-ScrimshawFairleadRoute -Method 'POST' -Route '/api/fairlead/v1/audio/speech' -Headers @{ 'content-type' = 'application/json'; 'x-fairlead-privacy' = 'local' } -Body $speech
        $r.Status | Should -Be 200
        $r.Type | Should -Be 'audio/wav'
        $seen.Url | Should -Be 'http://127.0.0.1:8776/v1/audio/speech'
        $seen.Type | Should -Be 'application/json'
        $script:ScrimshawHookForward = {
            param($Url, $Key, $Privacy, $BodyBytes, $ContentType)
            $seen.Url = $Url; $seen.Type = $ContentType
            return @{ Status = 200; Reason = 'OK'; Type = 'application/json'; Body = [Text.Encoding]::UTF8.GetBytes('{"text":"Hello from the recording"}') }
        }
        $form = [Text.Encoding]::UTF8.GetBytes("--bound`r`nContent-Disposition: form-data; name=`"file`"`r`n`r`naudio`r`n--bound--`r`n")
        $t = Invoke-ScrimshawFairleadRoute -Method 'POST' -Route '/api/fairlead/v1/audio/transcriptions' -Headers @{ 'content-type' = 'multipart/form-data; boundary=bound' } -Body $form
        $t.Status | Should -Be 200
        $seen.Url | Should -Be 'http://127.0.0.1:8776/v1/audio/transcriptions'
        $seen.Type | Should -Be 'multipart/form-data; boundary=bound'
        [Text.Encoding]::UTF8.GetString($t.Body) | Should -Not -Match 'fl-'
        $bad = Invoke-ScrimshawFairleadRoute -Method 'POST' -Route '/api/fairlead/v1/audio/transcriptions' -Headers @{ 'content-type' = "multipart/form-data; boundary=bound`r`nX-Evil: 1" } -Body $form
        $bad.Status | Should -Be 400
    }

    It 'ignores a router address that is not on this computer' {
        $env:SCRIMSHAW_AI_ENDPOINT_URL = 'http://evil.example:8776'
        try { Get-ScrimshawFairleadBase | Should -Be 'http://127.0.0.1:8776' }
        finally { Remove-Item Env:SCRIMSHAW_AI_ENDPOINT_URL -ErrorAction SilentlyContinue }
        $env:SCRIMSHAW_AI_ENDPOINT_URL = 'http://127.0.0.1:9'
        try { Get-ScrimshawFairleadBase | Should -Be 'http://127.0.0.1:9' }
        finally { Remove-Item Env:SCRIMSHAW_AI_ENDPOINT_URL -ErrorAction SilentlyContinue }
    }
}
