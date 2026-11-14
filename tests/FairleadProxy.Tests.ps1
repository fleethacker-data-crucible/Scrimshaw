#requires -Version 5.1
# Rules for the Fairlead proxy. No real Fairlead, no real credential, and the synthetic key is never printed.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
. (Join-Path (Split-Path $PSScriptRoot -Parent) (Join-Path 'actions' 'FairleadProxy.ps1'))

function Assert-That([bool]$Cond, [string]$Message) {
    if (-not $Cond) { throw $Message }
}

function Save-Var([string]$Name) {
    return @{ Name = $Name; Present = [Environment]::GetEnvironmentVariable($Name) -ne $null -or (Test-Path "Env:$Name"); Value = [Environment]::GetEnvironmentVariable($Name) }
}

function Restore-Var($Saved) {
    if ($Saved.Present -and $null -ne $Saved.Value) { [Environment]::SetEnvironmentVariable($Saved.Name, [string]$Saved.Value) }
    else { [Environment]::SetEnvironmentVariable($Saved.Name, $null) }
}

$exe = Join-Path (Join-Path ([System.IO.Path]::GetTempPath()) 'scrimshaw-fairlead') 'Start-Fairlead.ps1'
$id = @{ tool = 'fairlead'; pid = 42; path = $exe }
Assert-That (Test-ScrimshawFairleadIdentity -Id $id -ListenerPid 42 -ExecutablePath $exe -CommandLine '') 'An exact executable path should match.'
Assert-That (-not (Test-ScrimshawFairleadIdentity -Id $id -ListenerPid 42 -ExecutablePath ($exe + '.evil') -CommandLine '')) 'A longer path must not match.'
Assert-That (-not (Test-ScrimshawFairleadIdentity -Id @{ tool = 'scrimshaw'; pid = 42; path = $exe } -ListenerPid 42 -ExecutablePath $exe -CommandLine '')) 'A different tool must not match.'
Assert-That (-not (Test-ScrimshawFairleadIdentity -Id $id -ListenerPid 41 -ExecutablePath $exe -CommandLine '')) 'A different pid must not match.'
Assert-That (-not (Test-ScrimshawFairleadIdentity -Id @{ tool = 'fairlead'; pid = 42; path = 'scripts/Start-Fairlead.ps1' } -ListenerPid 42 -ExecutablePath $exe -CommandLine '')) 'A relative path must not match.'
$quoted = 'powershell.exe -NoProfile -File "' + $exe + '" --no-browser'
Assert-That (Test-ScrimshawFairleadIdentity -Id @{ tool = 'fairlead'; pid = 7; path = $exe } -ListenerPid 7 -ExecutablePath 'not-the-script' -CommandLine $quoted) 'The -File script should match.'
Assert-That ((Get-ScrimshawFileArgument 'powershell -File scripts/Start-Fairlead.ps1') -eq $null) 'A relative -File argument must be ignored.'

$starts = 0
$foreign = Confirm-ScrimshawFairlead -BaseUrl 'http://127.0.0.1:8776' -GetId { @{ tool = 'other'; pid = 1; path = $exe } } -GetOwner { @{ Pid = 1; Executable = $exe; CommandLine = '' } } -Start { $script:starts++; @{ Ok = $true; Reason = '' } }
Assert-That ($starts -eq 0) 'A foreign program on the port must not be started over.'
Assert-That (-not $foreign.Ok) 'A foreign program must not be treated as Fairlead.'
Assert-That ($foreign.Reason -eq 'identity') 'A foreign program should be reported as an identity failure.'

$script:seenId = 0
$script:starts = 0
$ready = Confirm-ScrimshawFairlead -BaseUrl 'http://127.0.0.1:8776/' -GetId {
    if ($script:seenId -eq 0) { $script:seenId++; return $null }
    return @{ tool = 'fairlead'; pid = 5; path = $exe }
} -GetOwner { @{ Pid = 5; Executable = $exe; CommandLine = '' } } -Start { $script:starts++; @{ Ok = $true; Reason = '' } }
Assert-That ($script:starts -eq 1) 'Fairlead should be started once when nothing is listening.'
Assert-That ($ready.Ok) 'Fairlead should be accepted after it starts and proves its identity.'

$script:starts = 0
$stopped = Confirm-ScrimshawFairlead -BaseUrl 'http://127.0.0.1:8776' -NoStart -GetId { $null } -Start { $script:starts++; @{ Ok = $true; Reason = '' } }
Assert-That ($script:starts -eq 0 -and $stopped.Reason -eq 'stopped') 'The re-check must not start Fairlead.'

$utf16 = [Text.Encoding]::Unicode.GetBytes('fl-from-cred')
Assert-That ((Read-ScrimshawCredentialText $utf16) -eq 'fl-from-cred') 'A UTF-16 credential did not decode.'
$utf8 = [Text.Encoding]::UTF8.GetBytes('fl-from-utf8')
Assert-That ((Read-ScrimshawCredentialText $utf8) -eq 'fl-from-utf8') 'A UTF-8 credential did not decode.'
Assert-That ((Read-ScrimshawCredentialText ([Text.Encoding]::Unicode.GetBytes('not a key'))) -eq $null) 'A credential with spaces must be refused.'

$tokenDir = Join-Path ([System.IO.Path]::GetTempPath()) ('scrimshaw-token-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $tokenDir | Out-Null
$tokenFile = Join-Path $tokenDir 'local-token'
[System.IO.File]::WriteAllText($tokenFile, "fl-from-file`r`nsecond line`r`n")
try {
    Assert-That ((Get-ScrimshawFairleadToken -ReadCredential { '' } -TokenPath $tokenFile) -eq 'fl-from-file') 'The local token file was not read.'
    Assert-That ((Get-ScrimshawFairleadToken -ReadCredential { 'fl-from-cred' } -TokenPath $tokenFile) -eq 'fl-from-cred') 'The Fairlead/Scrimshaw credential should win over the file.'
    $savedOff = Save-Var 'FAIRLEAD_LOCAL_TOKEN'
    $savedFile = Save-Var 'FAIRLEAD_LOCAL_TOKEN_FILE'
    try {
        [Environment]::SetEnvironmentVariable('FAIRLEAD_LOCAL_TOKEN_FILE', $tokenFile)
        [Environment]::SetEnvironmentVariable('FAIRLEAD_LOCAL_TOKEN', 'off')
        Assert-That ((Get-ScrimshawFairleadToken -ReadCredential { '' }) -eq $null) 'FAIRLEAD_LOCAL_TOKEN=off should skip the file.'
        Assert-That ((Get-ScrimshawFairleadToken -ReadCredential { 'fl-from-cred' }) -eq 'fl-from-cred') 'The off switch should not hide an installed credential.'
        [Environment]::SetEnvironmentVariable('FAIRLEAD_LOCAL_TOKEN', $null)
        Assert-That ((Get-ScrimshawFairleadToken -ReadCredential { '' }) -eq 'fl-from-file') 'FAIRLEAD_LOCAL_TOKEN_FILE should be read when the switch is not off.'
    } finally {
        Restore-Var $savedOff
        Restore-Var $savedFile
    }
} finally {
    Remove-Item -LiteralPath $tokenDir -Recurse -Force -ErrorAction SilentlyContinue
}

$savedAi = Save-Var 'SCRIMSHAW_AI_ENDPOINT_URL'
$savedLlm = Save-Var 'LLM_URL'
try {
    [Environment]::SetEnvironmentVariable('SCRIMSHAW_AI_ENDPOINT_URL', 'http://evil.example:8776')
    [Environment]::SetEnvironmentVariable('LLM_URL', 'http://127.0.0.1:9')
    Assert-That ((Resolve-ScrimshawFairleadUrl) -eq 'http://127.0.0.1:9') 'A loopback LLM_URL should be used when the app override is not loopback.'
    [Environment]::SetEnvironmentVariable('SCRIMSHAW_AI_ENDPOINT_URL', 'http://127.0.0.1:8776/')
    Assert-That ((Resolve-ScrimshawFairleadUrl) -eq 'http://127.0.0.1:8776') 'The app override should win and drop a trailing slash.'
    [Environment]::SetEnvironmentVariable('SCRIMSHAW_AI_ENDPOINT_URL', 'http://user:pw@127.0.0.1:8776')
    Assert-That ((Resolve-ScrimshawFairleadUrl) -eq 'http://127.0.0.1:9') 'A URL with a user must not be used.'
    Assert-That (-not (Test-ScrimshawLoopbackHttpUrl 'https://127.0.0.1:8776')) 'https must not be used.'
    Assert-That (-not (Test-ScrimshawLoopbackHttpUrl 'http://127.0.0.1:8776/v1')) 'A path must not be used.'
} finally {
    Restore-Var $savedAi
    Restore-Var $savedLlm
}

$evilBody = '{"model":"auto","temperature":0.4,"messages":[{"role":"user","content":"say \"hi\" next"}],"url":"http://evil.example/steal"}'
$built = Build-ScrimshawChatBody ([Text.Encoding]::UTF8.GetBytes($evilBody))
Assert-That ($built.Ok) 'A normal chat body should be accepted.'
$rebuilt = [Text.Encoding]::UTF8.GetString($built.Bytes)
Assert-That (-not $rebuilt.Contains('evil.example')) 'A caller-supplied address must be dropped.'
Assert-That ($rebuilt.Contains('"stream":false')) 'The forwarded body must not stream.'
$parsed = $rebuilt | ConvertFrom-Json
Assert-That ([string](Get-ScrimshawProp $parsed 'model') -eq 'auto') 'The model should be kept.'
Assert-That (@(Get-ScrimshawProp $parsed 'messages').Count -eq 1) 'One message should stay an array.'
Assert-That (-not (Build-ScrimshawChatBody ([Text.Encoding]::UTF8.GetBytes('[]'))).Ok) 'A non-object body must be refused.'
Assert-That (-not (Build-ScrimshawChatBody ([byte[]]@())).Ok) 'An empty body must be refused.'

$script:sent = 0
$script:read = 0
$chatBody = [Text.Encoding]::UTF8.GetBytes('{"model":"smart","messages":[{"role":"system","content":"rules"},{"role":"user","content":"hello there"}]}')
$blocked = Invoke-ScrimshawFairleadProxy -Body $chatBody -PrivacyLocal $true -Deps @{
    ResolveUrl = { 'http://127.0.0.1:8776' }
    EnsureReady = { param($Url, [bool]$NoStart) @{ Ok = $false; Reason = 'port-taken' } }
    ReadToken = { $script:read++; 'fl-test-synthetic' }
    Send = { $script:sent++; @{ Status = 200; ContentType = 'application/json'; Bytes = [Text.Encoding]::UTF8.GetBytes('{}') } }
}
Assert-That ($script:sent -eq 0 -and $script:read -eq 0) 'A failed identity check must not read or send the key.'
Assert-That ($blocked.Status -eq 503) 'A taken port should be 503.'
Assert-That ([Text.Encoding]::UTF8.GetString($blocked.Bytes).Contains('not Fairlead')) 'The taken-port message should say the key was not sent.'

$script:sent = 0
$script:read = 0
$late = Invoke-ScrimshawFairleadProxy -Body $chatBody -PrivacyLocal $true -Deps @{
    ResolveUrl = { 'http://127.0.0.1:8776' }
    EnsureReady = { param($Url, [bool]$NoStart) if ($NoStart) { return @{ Ok = $false; Reason = 'stopped' } }; return @{ Ok = $true; Reason = '' } }
    ReadToken = { $script:read++; 'fl-test-synthetic' }
    Send = { $script:sent++; @{ Status = 200; ContentType = 'application/json'; Bytes = [Text.Encoding]::UTF8.GetBytes('{}') } }
}
Assert-That ($script:sent -eq 0 -and $script:read -eq 0) 'The key must not be read when the second identity check fails.'
Assert-That ($late.Status -eq 503) 'A Fairlead that disappears should be 503.'

$echo = Invoke-ScrimshawFairleadProxy -Body $chatBody -PrivacyLocal $true -Deps @{
    ResolveUrl = { 'http://evil.example' }
    EnsureReady = { param($Url, [bool]$NoStart) @{ Ok = $true; Reason = '' } }
    ReadToken = { 'fl-test-synthetic' }
    Send = { throw 'send should not run' }
}
Assert-That ($echo.Status -eq 400) 'A non-loopback address must be refused before the key is used.'

$leaked = Invoke-ScrimshawFairleadProxy -Body $chatBody -PrivacyLocal $false -Deps @{
    ResolveUrl = { 'http://127.0.0.1:8776' }
    EnsureReady = { param($Url, [bool]$NoStart) @{ Ok = $true; Reason = '' } }
    ReadToken = { 'fl-test-synthetic' }
    Send = { param($Url, $Token, $Bytes, [bool]$Privacy) @{ Status = 200; ContentType = 'application/json'; Bytes = [Text.Encoding]::UTF8.GetBytes('{"echo":"' + $Token + '"}') } }
}
Assert-That ($leaked.Status -eq 200) 'A normal reply should pass through.'
Assert-That (-not ([Text.Encoding]::UTF8.GetString($leaked.Bytes).Contains('fl-test-synthetic'))) 'The reply must not contain the key.'

$root = Join-Path ([System.IO.Path]::GetTempPath()) ('scrimshaw-fleetport-' + [guid]::NewGuid().ToString('n'))
$moduleDir = Join-Path (Join-Path (Join-Path $root 'edge-ops') 'tools') 'fleet-port'
New-Item -ItemType Directory -Path $moduleDir -Force | Out-Null
$modulePath = Join-Path $moduleDir 'FleetPort.psm1'
@'
function Start-FleetService {
    param($Name, $WaitSeconds, $CallerRoot)
    if ($Name -ne 'fairlead') { return @{ State = 'unavailable'; Reason = 'bad-call' } }
    return @{ State = 'running'; Reason = '' }
}
Export-ModuleMember -Function Start-FleetService
'@ | Set-Content -LiteralPath $modulePath -Encoding ASCII
try {
    $found = Find-ScrimshawFleetPortModule -CallerRoot $root
    Assert-That ($found -and ((Resolve-Path -LiteralPath $found).Path -eq (Resolve-Path -LiteralPath $modulePath).Path)) 'FleetPort should be found beside the app.'
    $savedModule = Save-Var 'FLEETPORT_MODULE'
    try {
        [Environment]::SetEnvironmentVariable('FLEETPORT_MODULE', $modulePath)
        $started = Start-ScrimshawFairleadService -CallerRoot $root
        Assert-That ($started.Ok) 'Start-FleetService running should be accepted.'
        $savedProfile = Save-Var 'USERPROFILE'
        $elsewhere = Join-Path ([System.IO.Path]::GetTempPath()) ('scrimshaw-nofleet-' + [guid]::NewGuid().ToString('n'))
        New-Item -ItemType Directory -Path $elsewhere | Out-Null
        try {
            [Environment]::SetEnvironmentVariable('USERPROFILE', $elsewhere)
            [Environment]::SetEnvironmentVariable('FLEETPORT_MODULE', (Join-Path $elsewhere 'missing.psm1'))
            $missing = Start-ScrimshawFairleadService -CallerRoot $elsewhere
            Assert-That ((-not $missing.Ok) -and $missing.Reason -eq 'no-fleetport') 'A missing FleetPort should be reported and not started another way.'
        } finally {
            Restore-Var $savedProfile
            Remove-Item -LiteralPath $elsewhere -Recurse -Force -ErrorAction SilentlyContinue
        }
    } finally {
        Restore-Var $savedModule
        Remove-Module FleetPort -ErrorAction SilentlyContinue
    }
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
}

$dir = Join-Path ([System.IO.Path]::GetTempPath()) ('scrimshaw-proxy-' + [guid]::NewGuid().ToString('n'))
New-Item -ItemType Directory -Path $dir | Out-Null
$portFile = Join-Path $dir 'port.txt'
$seenFile = Join-Path $dir 'seen.txt'
$job = Start-Job -ScriptBlock {
    param($PortFile, $SeenFile)
    $ErrorActionPreference = 'Stop'
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try {
        $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
        [System.IO.File]::WriteAllText($PortFile, "$port")
        $client = $listener.AcceptTcpClient()
        try {
            $client.ReceiveTimeout = 8000
            $stream = $client.GetStream()
            $one = New-Object byte[] 1
            $sb = New-Object System.Text.StringBuilder
            while ($sb.Length -lt 16384) {
                $n = $stream.Read($one, 0, 1)
                if ($n -le 0) { break }
                [void]$sb.Append([char]$one[0])
                if ($sb.Length -ge 4 -and $sb.ToString($sb.Length - 4, 4) -eq "`r`n`r`n") { break }
            }
            $head = $sb.ToString()
            $len = 0
            foreach ($line in ($head -split "`r`n")) {
                if ($line -match '(?i)^content-length:\s*(\d+)\s*$') { $len = [int]$Matches[1] }
            }
            $left = $len
            while ($left -gt 0) {
                $chunk = New-Object byte[] ([Math]::Min(4096, $left))
                $n = $stream.Read($chunk, 0, $chunk.Length)
                if ($n -le 0) { break }
                $left -= $n
            }
            [System.IO.File]::WriteAllText($SeenFile, $head)
            $payload = '{"choices":[{"message":{"role":"assistant","content":"draft"}}]}'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($payload)
            $respHead = "HTTP/1.1 200 OK`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`n`r`n"
            $hb = [System.Text.Encoding]::ASCII.GetBytes($respHead)
            $stream.Write($hb, 0, $hb.Length)
            $stream.Write($bytes, 0, $bytes.Length)
            $stream.Flush()
        } finally { $client.Close() }
    } finally { $listener.Stop() }
} -ArgumentList $portFile, $seenFile
try {
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Path -LiteralPath $portFile) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }
    Assert-That (Test-Path -LiteralPath $portFile) 'The test listener did not start.'
    $port = [int]([System.IO.File]::ReadAllText($portFile).Trim())
    $live = 'http://127.0.0.1:' + $port
    $wire = Invoke-ScrimshawFairleadProxy -Body $chatBody -PrivacyLocal $true -Deps @{
        ResolveUrl = { $live }.GetNewClosure()
        EnsureReady = { param($Url, [bool]$NoStart) @{ Ok = $true; Reason = '' } }
        ReadToken = { 'fl-test-synthetic' }
        Send = { param($Url, $Token, $Bytes, [bool]$Privacy) Send-ScrimshawFairleadChat -BaseUrl $Url -Token $Token -Bytes $Bytes -PrivacyLocal $Privacy }
    }
    Assert-That ($wire.Status -eq 200) 'The live forward should return the listener status.'
    Assert-That (-not ([Text.Encoding]::UTF8.GetString($wire.Bytes).Contains('fl-test-synthetic'))) 'The live reply must not contain the key.'
    $deadline = (Get-Date).AddSeconds(10)
    while (-not (Test-Path -LiteralPath $seenFile) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 50 }
    Assert-That (Test-Path -LiteralPath $seenFile) 'The listener did not record the request.'
    $seen = [System.IO.File]::ReadAllText($seenFile)
    Assert-That ($seen -match 'X-Fairlead-Label:\s*Scrimshaw') 'The label must be Scrimshaw.'
    Assert-That ($seen -match 'X-Fairlead-Privacy:\s*local') 'Local-only must be forwarded.'
    $auth = [regex]::Match($seen, 'Authorization:\s*Bearer\s+(\S+)')
    Assert-That ($auth.Success -and $auth.Groups[1].Value -eq 'fl-test-synthetic') 'The server must send the local token.'
    Assert-That ($seen -notmatch '(?i)^Host:\s*evil') 'The request must not be addressed somewhere else.'
} finally {
    Stop-Job $job -ErrorAction SilentlyContinue
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $dir -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host 'Fairlead proxy tests passed'
