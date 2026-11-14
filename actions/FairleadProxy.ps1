#requires -Version 5.1
<#
  Forwards one Scrimshaw draft to Fairlead on this computer (issue 31, turnkey connections).

  The browser posts the chat body to Start.ps1. This script attaches the key and calls Fairlead.
  The key is the Windows credential Fairlead/Scrimshaw when that exists, otherwise the first line
  of %LOCALAPPDATA%\Fairlead\local-token (FAIRLEAD_LOCAL_TOKEN=off skips the file;
  FAIRLEAD_LOCAL_TOKEN_FILE moves it). The key is never written, logged, or returned to the page.

  Before the key is sent, GET /__fleethacker/id must name fairlead, and its pid and path must be
  the process listening on that loopback port (the executable, or the -File script). If nothing is
  listening, Start-FleetService from FleetPort starts Fairlead. A foreign program is not started
  over and is not given the key.

  SCRIMSHAW_AI_ENDPOINT_URL, then LLM_URL, may replace http://127.0.0.1:8776 when the value is
  loopback http with no user, query, or path.
#>
Set-StrictMode -Version 2.0

function Get-ScrimshawProp($Obj, [string]$Name) {
    if ($null -eq $Obj) { return $null }
    if ($Obj -is [System.Collections.IDictionary]) {
        if (-not $Obj.Contains($Name)) { return $null }
        return $Obj[$Name]
    }
    $prop = $Obj.PSObject.Properties[$Name]
    if (-not $prop) { return $null }
    return $prop.Value
}

function Test-ScrimshawPrintableToken([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    $t = $Text.Trim()
    if ($t.Length -lt 8 -or $t.Length -gt 512) { return $false }
    return $t -match '^[\x21-\x7E]+$'
}

function Read-ScrimshawCredentialText([byte[]]$Blob) {
    if (-not $Blob -or $Blob.Length -eq 0) { return $null }
    if ($Blob.Length % 2 -eq 0) {
        $wide = [Text.Encoding]::Unicode.GetString($Blob).Trim()
        if (Test-ScrimshawPrintableToken $wide) { return $wide }
    }
    $narrow = [Text.Encoding]::UTF8.GetString($Blob).Trim()
    if (Test-ScrimshawPrintableToken $narrow) { return $narrow }
    return $null
}

function Read-ScrimshawWindowsCredential([string]$Target) {
    if (-not $Target) { return $null }
    if ($env:OS -ne 'Windows_NT') { return $null }
    $ptr = [IntPtr]::Zero
    $blob = $null
    try {
        if (-not ('ScrimshawCredNative' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ScrimshawCredNative {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);
    public static byte[] Read(string target) {
        IntPtr ptr;
        if (!CredRead(target, 1, 0, out ptr) || ptr == IntPtr.Zero) return null;
        try {
            CREDENTIAL cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
            if (cred.CredentialBlob == IntPtr.Zero || cred.CredentialBlobSize <= 0 || cred.CredentialBlobSize > 4096) return null;
            byte[] blob = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, blob, 0, blob.Length);
            return blob;
        } finally { CredFree(ptr); }
    }
}
'@ -ErrorAction Stop
        }
        $blob = [ScrimshawCredNative]::Read($Target)
        if (-not $blob) { return $null }
        return (Read-ScrimshawCredentialText $blob)
    } catch {
        return $null
    } finally {
        if ($blob) { [Array]::Clear($blob, 0, $blob.Length) }
    }
}

function Get-ScrimshawLocalTokenPath {
    if ($env:FAIRLEAD_LOCAL_TOKEN -eq 'off') { return $null }
    if ($env:FAIRLEAD_LOCAL_TOKEN_FILE) { return $env:FAIRLEAD_LOCAL_TOKEN_FILE }
    if (-not $env:LOCALAPPDATA) { return $null }
    return (Join-Path (Join-Path $env:LOCALAPPDATA 'Fairlead') 'local-token')
}

function Read-ScrimshawLocalTokenFile([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $null }
    $reader = $null
    try {
        $reader = New-Object System.IO.StreamReader($Path, [Text.Encoding]::UTF8, $true)
        $line = $reader.ReadLine()
    } catch {
        return $null
    } finally {
        if ($reader) { $reader.Dispose() }
    }
    if (-not (Test-ScrimshawPrintableToken $line)) { return $null }
    return $line.Trim()
}

function Get-ScrimshawFairleadToken {
    param([scriptblock]$ReadCredential, [string]$TokenPath)
    $cred = $null
    if ($ReadCredential) { $cred = [string](& $ReadCredential 'Fairlead/Scrimshaw') }
    else { $cred = Read-ScrimshawWindowsCredential 'Fairlead/Scrimshaw' }
    if (Test-ScrimshawPrintableToken $cred) { return $cred.Trim() }
    $path = $TokenPath
    if (-not $path) { $path = Get-ScrimshawLocalTokenPath }
    if (-not $path) { return $null }
    return (Read-ScrimshawLocalTokenFile $path)
}

function Test-ScrimshawLoopbackHttpUrl([string]$Raw) {
    if ([string]::IsNullOrWhiteSpace($Raw)) { return $false }
    try { $u = [Uri]$Raw.Trim() } catch { return $false }
    if ($u.Scheme -ne 'http') { return $false }
    if ($u.UserInfo -or $u.Query -or $u.Fragment) { return $false }
    $path = $u.AbsolutePath
    if ($path -and $path -ne '/') { return $false }
    $hostName = $u.Host
    return ($hostName -eq '127.0.0.1' -or $hostName -eq 'localhost' -or $hostName -eq '::1')
}

function Resolve-ScrimshawFairleadUrl {
    foreach ($name in @('SCRIMSHAW_AI_ENDPOINT_URL', 'LLM_URL')) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($value -and (Test-ScrimshawLoopbackHttpUrl $value)) { return $value.Trim().TrimEnd('/') }
    }
    return 'http://127.0.0.1:8776'
}

function Get-ScrimshawFileArgument([string]$CommandLine) {
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $null }
    $m = [regex]::Match($CommandLine, '(?i)(?:^|\s)-File\s+(?:"([^"]+)"|(\S+))')
    if (-not $m.Success) { return $null }
    $path = ''
    if ($m.Groups[1].Success -and $m.Groups[1].Value) { $path = $m.Groups[1].Value }
    elseif ($m.Groups[2].Success) { $path = $m.Groups[2].Value }
    if (-not $path -or -not [System.IO.Path]::IsPathRooted($path)) { return $null }
    return $path
}

function Test-ScrimshawPathEqual([string]$A, [string]$B) {
    if (-not $A -or -not $B) { return $false }
    return [string]::Equals($A.Trim(), $B.Trim(), [StringComparison]::OrdinalIgnoreCase)
}

function Test-ScrimshawFairleadIdentity {
    param($Id, [int]$ListenerPid, [string]$ExecutablePath, [string]$CommandLine)
    if (-not $Id) { return $false }
    if ([string](Get-ScrimshawProp $Id 'tool') -ne 'fairlead') { return $false }
    $procId = 0
    if (-not [int]::TryParse([string](Get-ScrimshawProp $Id 'pid'), [ref]$procId)) { return $false }
    if ($procId -le 0 -or $procId -ne $ListenerPid) { return $false }
    $path = [string](Get-ScrimshawProp $Id 'path')
    if (-not $path -or -not [System.IO.Path]::IsPathRooted($path)) { return $false }
    if (Test-ScrimshawPathEqual $path $ExecutablePath) { return $true }
    $file = Get-ScrimshawFileArgument $CommandLine
    if ($file -and (Test-ScrimshawPathEqual $path $file)) { return $true }
    return $false
}

function Get-ScrimshawFairleadId([string]$BaseUrl) {
    if (-not (Test-ScrimshawLoopbackHttpUrl $BaseUrl)) { return $null }
    $resp = $null
    try {
        $req = New-ScrimshawFairleadRequest ($BaseUrl.TrimEnd('/') + '/__fleethacker/id')
        $req.Method = 'GET'
        $req.Timeout = 3000
        $resp = $req.GetResponse()
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        try { $json = $reader.ReadToEnd() } finally { $reader.Dispose() }
        if (-not $json) { return $null }
        return ($json | ConvertFrom-Json)
    } catch {
        return $null
    } finally {
        if ($resp) { $resp.Dispose() }
    }
}

function Get-ScrimshawPortOwner([int]$Port) {
    if ($Port -le 0) { return $null }
    $ownerPid = 0
    try {
        $conns = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
        foreach ($c in $conns) {
            $addr = [string]$c.LocalAddress
            if ($addr -eq '127.0.0.1' -or $addr -eq '::1') { $ownerPid = [int]$c.OwningProcess; break }
        }
    } catch { }
    if ($ownerPid -le 0) {
        try {
            $lines = @(& netstat.exe -ano -p tcp 2>$null)
            foreach ($line in $lines) {
                if ($line -match '^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$') {
                    if ([int]$Matches[2] -ne $Port) { continue }
                    $addr = $Matches[1]
                    if ($addr -eq '127.0.0.1' -or $addr -eq '[::1]') { $ownerPid = [int]$Matches[3]; break }
                }
            }
        } catch { }
    }
    if ($ownerPid -le 0) { return $null }
    $exe = ''
    $cmd = ''
    try {
        $proc = Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId=" + $ownerPid) -ErrorAction Stop
        $exe = [string]$proc.ExecutablePath
        $cmd = [string]$proc.CommandLine
    } catch {
        try {
            $proc = Get-WmiObject -Class Win32_Process -Filter ("ProcessId=" + $ownerPid) -ErrorAction Stop
            $exe = [string]$proc.ExecutablePath
            $cmd = [string]$proc.CommandLine
        } catch { }
    }
    return @{ Pid = $ownerPid; Executable = $exe; CommandLine = $cmd }
}

function Find-ScrimshawFleetPortModule {
    param([string]$CallerRoot)
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($env:FLEETPORT_MODULE) { [void]$candidates.Add($env:FLEETPORT_MODULE) }
    $roots = New-Object System.Collections.Generic.List[string]
    if ($CallerRoot) { [void]$roots.Add($CallerRoot) }
    if ($PSScriptRoot) { [void]$roots.Add($PSScriptRoot) }
    foreach ($root in $roots) {
        $dir = $root
        for ($i = 0; $i -lt 4 -and $dir; $i++) {
            [void]$candidates.Add((Join-Path (Join-Path (Join-Path (Join-Path $dir 'edge-ops') 'tools') 'fleet-port') 'FleetPort.psm1'))
            [void]$candidates.Add((Join-Path (Join-Path (Join-Path $dir 'tools') 'fleet-port') 'FleetPort.psm1'))
            $parent = Split-Path -Path $dir -Parent
            if (-not $parent -or $parent -eq $dir) { break }
            $dir = $parent
        }
    }
    if ($env:USERPROFILE) {
        $projects = Join-Path $env:USERPROFILE 'Projects'
        [void]$candidates.Add((Join-Path (Join-Path (Join-Path (Join-Path $projects 'edge-ops') 'tools') 'fleet-port') 'FleetPort.psm1'))
    }
    foreach ($c in $candidates) {
        if (-not $c) { continue }
        $leaf = $c.TrimEnd([System.IO.Path]::DirectorySeparatorChar)
        if ((Test-Path -LiteralPath $leaf -PathType Leaf)) { return (Resolve-Path -LiteralPath $leaf).Path }
    }
    return $null
}

function Start-ScrimshawFairleadService {
    param([string]$CallerRoot)
    $module = Find-ScrimshawFleetPortModule -CallerRoot $CallerRoot
    if (-not $module) { return @{ Ok = $false; Reason = 'no-fleetport' } }
    try {
        Import-Module -Name $module -Force -ErrorAction Stop
        if (-not (Get-Command Start-FleetService -ErrorAction SilentlyContinue)) {
            return @{ Ok = $false; Reason = 'no-fleetport' }
        }
        $started = Start-FleetService -Name fairlead -WaitSeconds 40 -CallerRoot $CallerRoot
        $state = [string](Get-ScrimshawProp $started 'State')
        if ($state -eq 'running') { return @{ Ok = $true; Reason = '' } }
        $reason = [string](Get-ScrimshawProp $started 'Reason')
        if (-not $reason) { $reason = 'start-failed' }
        return @{ Ok = $false; Reason = $reason }
    } catch {
        return @{ Ok = $false; Reason = 'start-failed' }
    }
}

function Confirm-ScrimshawFairlead {
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [string]$CallerRoot,
        [switch]$NoStart,
        $GetId,
        $GetOwner,
        $Start
    )
    if (-not (Test-ScrimshawLoopbackHttpUrl $BaseUrl)) { return @{ Ok = $false; Reason = 'identity' } }
    if (-not $GetId) { $GetId = { param($Url) Get-ScrimshawFairleadId $Url } }
    if (-not $GetOwner) { $GetOwner = { param($Port) Get-ScrimshawPortOwner $Port } }
    $id = & $GetId $BaseUrl
    if (-not $id) {
        if ($NoStart) { return @{ Ok = $false; Reason = 'stopped' } }
        if (-not $Start) { $Start = { param($Root) Start-ScrimshawFairleadService -CallerRoot $Root } }
        $started = & $Start $CallerRoot
        if (-not (Get-ScrimshawProp $started 'Ok')) {
            $reason = [string](Get-ScrimshawProp $started 'Reason')
            if (-not $reason) { $reason = 'start-failed' }
            return @{ Ok = $false; Reason = $reason }
        }
        $id = & $GetId $BaseUrl
    }
    $uri = [Uri]$BaseUrl
    $owner = & $GetOwner $uri.Port
    $listenerPid = 0
    $exe = ''
    $cmd = ''
    if ($owner) {
        [void][int]::TryParse([string](Get-ScrimshawProp $owner 'Pid'), [ref]$listenerPid)
        $exe = [string](Get-ScrimshawProp $owner 'Executable')
        $cmd = [string](Get-ScrimshawProp $owner 'CommandLine')
    }
    $match = Test-ScrimshawFairleadIdentity -Id $id -ListenerPid $listenerPid -ExecutablePath $exe -CommandLine $cmd
    if (-not $match) { return @{ Ok = $false; Reason = 'identity' } }
    return @{ Ok = $true; Reason = '' }
}

function ConvertTo-ScrimshawJsonString([string]$Value) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    if ($null -ne $Value) {
        foreach ($ch in $Value.ToCharArray()) {
            $code = [int]$ch
            if ($ch -eq '"') { [void]$sb.Append('\"') }
            elseif ($ch -eq '\') { [void]$sb.Append('\\') }
            elseif ($ch -eq "`n") { [void]$sb.Append('\n') }
            elseif ($ch -eq "`r") { [void]$sb.Append('\r') }
            elseif ($ch -eq "`t") { [void]$sb.Append('\t') }
            elseif ($code -lt 32) {
                [void]$sb.Append('\u')
                [void]$sb.Append($code.ToString('x4'))
            } else { [void]$sb.Append($ch) }
        }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function Build-ScrimshawChatBody([byte[]]$Body) {
    if (-not $Body -or $Body.Length -eq 0 -or $Body.Length -gt 65536) {
        return @{ Ok = $false; Error = 'The draft was empty or too large.' }
    }
    $text = ''
    try { $text = [Text.Encoding]::UTF8.GetString($Body) } catch {
        return @{ Ok = $false; Error = 'The draft was not a chat request.' }
    }
    try { $obj = $text | ConvertFrom-Json } catch {
        return @{ Ok = $false; Error = 'The draft was not a chat request.' }
    }
    $model = [string](Get-ScrimshawProp $obj 'model')
    if ($model -notmatch '^[\w./:-]{1,80}$') { return @{ Ok = $false; Error = 'The draft was not a chat request.' } }
    $rawMessages = Get-ScrimshawProp $obj 'messages'
    $messages = @($rawMessages)
    if ($messages.Count -lt 1 -or $messages.Count -gt 8) { return @{ Ok = $false; Error = 'The draft was not a chat request.' } }
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($message in $messages) {
        if (-not $message) { return @{ Ok = $false; Error = 'The draft was not a chat request.' } }
        $role = [string](Get-ScrimshawProp $message 'role')
        $content = [string](Get-ScrimshawProp $message 'content')
        if ($role -ne 'system' -and $role -ne 'user' -and $role -ne 'assistant') {
            return @{ Ok = $false; Error = 'The draft was not a chat request.' }
        }
        if ([string]::IsNullOrWhiteSpace($content) -or $content.Length -gt 8000) {
            return @{ Ok = $false; Error = 'The draft was not a chat request.' }
        }
        [void]$parts.Add(('{"role":' + (ConvertTo-ScrimshawJsonString $role) + ',"content":' + (ConvertTo-ScrimshawJsonString $content) + '}'))
    }
    $temp = 0.4
    $given = Get-ScrimshawProp $obj 'temperature'
    if ($null -ne $given -and "$given" -ne '') {
        $parsed = 0.0
        if (-not [double]::TryParse([string]$given, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$parsed)) {
            return @{ Ok = $false; Error = 'The draft was not a chat request.' }
        }
        if ($parsed -lt 0 -or $parsed -gt 2) { return @{ Ok = $false; Error = 'The draft was not a chat request.' } }
        $temp = $parsed
    }
    $tempText = $temp.ToString('0.####', [Globalization.CultureInfo]::InvariantCulture)
    $json = '{"model":' + (ConvertTo-ScrimshawJsonString $model) + ',"stream":false,"temperature":' + $tempText + ',"messages":[' + ($parts -join ',') + ']}'
    return @{ Ok = $true; Error = ''; Bytes = [Text.Encoding]::UTF8.GetBytes($json) }
}

function New-ScrimshawProxyResult {
    param(
        [Parameter(Mandatory)][int]$Status,
        [string]$ErrorMessage,
        [byte[]]$Bytes,
        [string]$ContentType = 'application/json; charset=utf-8'
    )
    if (-not $Bytes) {
        if (-not $ErrorMessage) { $ErrorMessage = 'Fairlead did not answer.' }
        $json = '{"error":' + (ConvertTo-ScrimshawJsonString $ErrorMessage) + '}'
        $Bytes = [Text.Encoding]::UTF8.GetBytes($json)
    }
    if (-not $ContentType) { $ContentType = 'application/json; charset=utf-8' }
    return @{ Status = $Status; ContentType = $ContentType; Bytes = $Bytes }
}

function Get-ScrimshawStatusReason([int]$Status) {
    switch ($Status) {
        200 { return 'OK' }
        400 { return 'Bad Request' }
        401 { return 'Unauthorized' }
        403 { return 'Forbidden' }
        404 { return 'Not Found' }
        405 { return 'Method Not Allowed' }
        502 { return 'Bad Gateway' }
        503 { return 'Service Unavailable' }
        default { return 'Error' }
    }
}

function Get-ScrimshawReadyMessage([string]$Reason) {
    switch ($Reason) {
        'no-fleetport' { return 'Fairlead is not running, and FleetPort is not on this computer, so Scrimshaw could not start it.' }
        'not-found' { return 'Fairlead is not running, and its folder was not found beside Scrimshaw.' }
        'port-taken' { return 'Fairlead''s port is in use by something that is not Fairlead, so the key was not sent.' }
        'timeout' { return 'Fairlead was started but did not answer in time.' }
        'identity' { return 'The program on Fairlead''s port did not prove it was Fairlead, so the key was not sent.' }
        'stopped' { return 'Fairlead is not running.' }
        'exited' { return 'Fairlead started and then exited.' }
        default { return 'Fairlead is not running, and Scrimshaw could not start it.' }
    }
}

function New-ScrimshawFairleadRequest([string]$Url) {
    # An empty proxy means the key is never sent through a system proxy. No redirect either.
    try { [System.Net.ServicePointManager]::Expect100Continue = $false } catch { }
    $req = [System.Net.HttpWebRequest][System.Net.WebRequest]::Create($Url)
    $req.Proxy = New-Object System.Net.WebProxy
    $req.AllowAutoRedirect = $false
    $req.KeepAlive = $false
    try { $req.ServicePoint.Expect100Continue = $false } catch { }
    return $req
}

function Send-ScrimshawFairleadChat {
    param(
        [Parameter(Mandatory)][string]$BaseUrl,
        [Parameter(Mandatory)][string]$Token,
        [Parameter(Mandatory)][byte[]]$Bytes,
        [bool]$PrivacyLocal
    )
    if (-not (Test-ScrimshawLoopbackHttpUrl $BaseUrl)) { throw 'The router address must be on this computer.' }
    $req = New-ScrimshawFairleadRequest ($BaseUrl.TrimEnd('/') + '/v1/chat/completions')
    $req.Method = 'POST'
    $req.Timeout = 120000
    $req.ReadWriteTimeout = 120000
    $req.ContentType = 'application/json'
    $req.Accept = 'application/json'
    $req.Headers.Add('X-Fairlead-Label', 'Scrimshaw')
    if ($PrivacyLocal) { $req.Headers.Add('X-Fairlead-Privacy', 'local') }
    # The key is a header only. It is not written to the body, a file, or a message.
    $req.Headers.Add('Authorization', 'Bearer ' + $Token)
    $req.ContentLength = $Bytes.Length
    $out = $req.GetRequestStream()
    try { $out.Write($Bytes, 0, $Bytes.Length) } finally { $out.Dispose() }
    $resp = $null
    try {
        try { $resp = $req.GetResponse() } catch [System.Net.WebException] {
            $resp = $_.Exception.Response
            if (-not $resp) { throw }
        }
        $status = [int]$resp.StatusCode
        if ($status -ge 300 -and $status -lt 400) {
            return (New-ScrimshawProxyResult -Status 502 -ErrorMessage 'Fairlead sent a redirect, which was not followed.')
        }
        $stream = $resp.GetResponseStream()
        $mem = New-Object System.IO.MemoryStream
        $buf = New-Object byte[] 8192
        $total = 0
        try {
            while ($true) {
                $n = $stream.Read($buf, 0, $buf.Length)
                if ($n -le 0) { break }
                $total += $n
                if ($total -gt 1048576) {
                    return (New-ScrimshawProxyResult -Status 502 -ErrorMessage 'Fairlead sent a reply that was too large.')
                }
                $mem.Write($buf, 0, $n)
            }
        } finally { $stream.Dispose() }
        $ctype = [string]$resp.ContentType
        if ($ctype -notmatch '(?i)json|text/plain') { $ctype = 'application/json; charset=utf-8' }
        return @{ Status = $status; ContentType = $ctype; Bytes = $mem.ToArray() }
    } finally {
        if ($resp) { $resp.Dispose() }
        try { $req.Abort() } catch { }
    }
}

function ConvertTo-ScrimshawByteArray($Value) {
    # A byte array that has passed through a script block can come back as a list of numbers.
    if ($null -eq $Value) { return $null }
    if ($Value -is [byte[]]) { return $Value }
    if ($Value -is [string]) { return $null }
    if ($Value -isnot [System.Collections.IEnumerable]) { return $null }
    $list = New-Object System.Collections.Generic.List[byte]
    foreach ($item in $Value) { [void]$list.Add([byte]$item) }
    return $list.ToArray()
}

function ConvertTo-ScrimshawProxyReply($Sent, [string]$Token) {
    if (-not $Sent) { return (New-ScrimshawProxyResult -Status 502 -ErrorMessage 'Fairlead did not answer.') }
    $status = 0
    [void][int]::TryParse([string](Get-ScrimshawProp $Sent 'Status'), [ref]$status)
    if ($status -le 0) { return (New-ScrimshawProxyResult -Status 502 -ErrorMessage 'Fairlead did not answer.') }
    if ($status -ge 300 -and $status -lt 400) {
        return (New-ScrimshawProxyResult -Status 502 -ErrorMessage 'Fairlead sent a redirect, which was not followed.')
    }
    $bytes = ConvertTo-ScrimshawByteArray (Get-ScrimshawProp $Sent 'Bytes')
    if ($null -eq $bytes) {
        if ($status -ge 400) { return (New-ScrimshawProxyResult -Status $status -ErrorMessage 'Fairlead refused the draft.') }
        return (New-ScrimshawProxyResult -Status 502 -ErrorMessage 'Fairlead did not answer.')
    }
    if ($bytes.Length -gt 1048576) {
        return (New-ScrimshawProxyResult -Status 502 -ErrorMessage 'Fairlead sent a reply that was too large.')
    }
    if ($Token -and $bytes.Length -gt 0) {
        $raw = [Text.Encoding]::UTF8.GetString($bytes)
        if ($raw.IndexOf($Token, [StringComparison]::Ordinal) -ge 0) {
            $raw = $raw.Replace($Token, '')
            $bytes = [Text.Encoding]::UTF8.GetBytes($raw)
        }
    }
    $ctype = [string](Get-ScrimshawProp $Sent 'ContentType')
    if (-not $ctype) { $ctype = 'application/json; charset=utf-8' }
    return @{ Status = $status; ContentType = $ctype; Bytes = $bytes }
}

function Get-ScrimshawFairleadDeps {
    param([string]$CallerRoot)
    $root = $CallerRoot
    return @{
        ResolveUrl = { Resolve-ScrimshawFairleadUrl }
        EnsureReady = {
            param($Url, [bool]$NoStart)
            if ($NoStart) { return (Confirm-ScrimshawFairlead -BaseUrl $Url -NoStart) }
            return (Confirm-ScrimshawFairlead -BaseUrl $Url -CallerRoot $root)
        }.GetNewClosure()
        ReadToken = { Get-ScrimshawFairleadToken }
        Send = { param($Url, $Token, $Bytes, [bool]$Privacy) Send-ScrimshawFairleadChat -BaseUrl $Url -Token $Token -Bytes $Bytes -PrivacyLocal $Privacy }
    }
}

function Invoke-ScrimshawFairleadProxy {
    param(
        [AllowEmptyCollection()][byte[]]$Body,
        [bool]$PrivacyLocal,
        [string]$CallerRoot,
        $Deps
    )
    if (-not $Deps) { $Deps = Get-ScrimshawFairleadDeps -CallerRoot $CallerRoot }
    $built = Build-ScrimshawChatBody -Body $Body
    if (-not (Get-ScrimshawProp $built 'Ok')) {
        return (New-ScrimshawProxyResult -Status 400 -ErrorMessage ([string](Get-ScrimshawProp $built 'Error')))
    }
    $url = [string](& $Deps.ResolveUrl)
    if (-not (Test-ScrimshawLoopbackHttpUrl $url)) {
        return (New-ScrimshawProxyResult -Status 400 -ErrorMessage 'The router address must be on this computer.')
    }
    $ready = & $Deps.EnsureReady $url $false
    if (-not (Get-ScrimshawProp $ready 'Ok')) {
        return (New-ScrimshawProxyResult -Status 503 -ErrorMessage (Get-ScrimshawReadyMessage ([string](Get-ScrimshawProp $ready 'Reason'))))
    }
    $again = & $Deps.EnsureReady $url $true
    if (-not (Get-ScrimshawProp $again 'Ok')) {
        return (New-ScrimshawProxyResult -Status 503 -ErrorMessage (Get-ScrimshawReadyMessage ([string](Get-ScrimshawProp $again 'Reason'))))
    }
    $token = [string](& $Deps.ReadToken)
    if (-not (Test-ScrimshawPrintableToken $token)) {
        return (New-ScrimshawProxyResult -Status 503 -ErrorMessage 'No Fairlead key is available on this account.')
    }
    try {
        $sent = & $Deps.Send $url $token ([byte[]](Get-ScrimshawProp $built 'Bytes')) $PrivacyLocal
    } catch {
        $token = $null
        return (New-ScrimshawProxyResult -Status 502 -ErrorMessage 'Fairlead did not answer.')
    }
    $reply = ConvertTo-ScrimshawProxyReply -Sent $sent -Token $token
    $token = $null
    return $reply
}
