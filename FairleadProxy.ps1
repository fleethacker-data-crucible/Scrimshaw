#requires -Version 5.1
# Server-side Fairlead call for the turnkey-connections contract (issue 31).
# The page posts to this app. This script adds the key and forwards to Fairlead on loopback.
# The key is the Fairlead/Scrimshaw generic credential when that exists, otherwise the first
# line of %LOCALAPPDATA%\Fairlead\local-token. It is sent only after GET /__fleethacker/id
# names fairlead, the reported pid owns the port, and a reported path is that process.
# Nothing in here prints a key. Identity checks follow FleetPort's Test-FleetServiceIdentity
# (edge-ops tools/fleet-port/FleetPort.psm1). Fairlead is started with Start-FleetService.
Set-StrictMode -Version 2.0

$script:ScrimshawFairleadLabel = 'Scrimshaw'
$script:ScrimshawFairleadTarget = 'Fairlead/Scrimshaw'
$script:ScrimshawFairleadMaxBody = 262144
$script:ScrimshawFairleadMaxReply = 2097152
$script:ScrimshawFairleadMaxAudio = 12582912
# Tests replace these. Production leaves them unset.
$script:ScrimshawFairleadKeyReader = $null
$script:ScrimshawLocalTokenReader = $null
$script:ScrimshawHookKey = $null
$script:ScrimshawHookProbe = $null
$script:ScrimshawHookOwners = $null
$script:ScrimshawHookProcess = $null
$script:ScrimshawHookStart = $null
$script:ScrimshawHookForward = $null
$script:ScrimshawHookBase = $null

function Reset-ScrimshawFairleadTestHooks {
    $script:ScrimshawFairleadKeyReader = $null
    $script:ScrimshawLocalTokenReader = $null
    $script:ScrimshawHookKey = $null
    $script:ScrimshawHookProbe = $null
    $script:ScrimshawHookOwners = $null
    $script:ScrimshawHookProcess = $null
    $script:ScrimshawHookStart = $null
    $script:ScrimshawHookForward = $null
    $script:ScrimshawHookBase = $null
}

function Get-ScrimshawProxyReason([int]$Status) {
    switch ($Status) {
        200 { return 'OK' }
        400 { return 'Bad Request' }
        401 { return 'Unauthorized' }
        403 { return 'Forbidden' }
        404 { return 'Not Found' }
        405 { return 'Method Not Allowed' }
        413 { return 'Payload Too Large' }
        502 { return 'Bad Gateway' }
        503 { return 'Service Unavailable' }
        default { return 'Status' }
    }
}

function New-ScrimshawProxyResult([int]$Status, [string]$Message, [string]$Type = 'application/json; charset=utf-8', [byte[]]$Raw = $null) {
    $body = $Raw
    if ($null -eq $body) {
        $json = (@{ error = $Message } | ConvertTo-Json -Compress)
        $body = [Text.Encoding]::UTF8.GetBytes($json)
    }
    return @{ Status = $Status; Reason = (Get-ScrimshawProxyReason $Status); Type = $Type; Body = $body }
}

function Test-ScrimshawLoopbackHttp([string]$Url) {
    $u = $null
    if ([string]::IsNullOrWhiteSpace($Url) -or -not [uri]::TryCreate($Url.Trim(), [UriKind]::Absolute, [ref]$u)) { return $false }
    if ($u.Scheme -ne 'http' -or $u.UserInfo) { return $false }
    $hostName = $u.Host
    return ($hostName -eq '127.0.0.1' -or $hostName -eq 'localhost' -or $hostName -eq '[::1]' -or $u.IsLoopback)
}

function Get-ScrimshawFairleadBase {
    if ($script:ScrimshawHookBase) { return ([string]$script:ScrimshawHookBase).TrimEnd('/') }
    foreach ($name in @('SCRIMSHAW_AI_ENDPOINT_URL', 'LLM_URL')) {
        $v = [Environment]::GetEnvironmentVariable($name)
        if ($v -and (Test-ScrimshawLoopbackHttp $v)) { return $v.Trim().TrimEnd('/') }
    }
    return 'http://127.0.0.1:8776'
}

function Test-ScrimshawFairleadKeyText([string]$Text) {
    # Fairlead's own keys are "fl-" plus 24 alphabet characters (GatewayEngine.NewClientKey).
    # Reject anything that could break an HTTP header.
    if ([string]::IsNullOrWhiteSpace($Text)) { return $false }
    return [bool]($Text.Trim() -cmatch '^fl-[A-Za-z0-9]{16,64}$')
}

function Read-ScrimshawLocalTokenText([string]$Text) {
    if ($null -eq $Text) { return $null }
    $line = ($Text -split "`n", 2)[0]
    if ($null -eq $line) { return $null }
    $line = $line.Trim().TrimEnd("`r")
    if (-not (Test-ScrimshawFairleadKeyText $line)) { return $null }
    return $line
}

function Get-ScrimshawLocalTokenPath {
    $custom = [Environment]::GetEnvironmentVariable('FAIRLEAD_LOCAL_TOKEN_FILE')
    if ($custom) { return $custom }
    $root = $env:LOCALAPPDATA
    if (-not $root) { $root = [Environment]::GetFolderPath('LocalApplicationData') }
    if (-not $root) { return $null }
    return (Join-Path (Join-Path $root 'Fairlead') 'local-token')
}

function Read-ScrimshawLocalToken {
    if ($script:ScrimshawLocalTokenReader) {
        return (Read-ScrimshawLocalTokenText (& $script:ScrimshawLocalTokenReader))
    }
    $path = Get-ScrimshawLocalTokenPath
    if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try {
        $text = [IO.File]::ReadAllText($path)
    } catch { return $null }
    return (Read-ScrimshawLocalTokenText $text)
}

function Initialize-ScrimshawCredentialReader {
    if ('Scrimshaw.FairleadCredential' -as [type]) { return }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace Scrimshaw {
  public static class FairleadCredential {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL {
      public int Flags; public int Type; public string TargetName; public string Comment;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
      public int CredentialBlobSize; public IntPtr CredentialBlob; public int Persist;
      public int AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);
    private static bool Printable(string text) {
      if (string.IsNullOrWhiteSpace(text)) return false;
      foreach (char ch in text.Trim()) if (ch < 0x20 || ch > 0x7E) return false;
      return true;
    }
    public static string Read(string target) {
      IntPtr ptr;
      if (!CredRead(target, 1, 0, out ptr)) return null;
      try {
        CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
        if (c.CredentialBlobSize <= 0 || c.CredentialBlob == IntPtr.Zero) return null;
        byte[] blob = new byte[c.CredentialBlobSize];
        Marshal.Copy(c.CredentialBlob, blob, 0, blob.Length);
        string wide = (blob.Length % 2 == 0) ? Encoding.Unicode.GetString(blob) : null;
        if (Printable(wide)) return wide.Trim();
        string narrow = Encoding.UTF8.GetString(blob);
        return Printable(narrow) ? narrow.Trim() : null;
      } finally { CredFree(ptr); }
    }
  }
}
'@
}

function Get-ScrimshawFairleadCredential {
    if ($script:ScrimshawFairleadKeyReader) {
        $v = & $script:ScrimshawFairleadKeyReader $script:ScrimshawFairleadTarget
        if ($v -and (Test-ScrimshawFairleadKeyText ([string]$v))) { return ([string]$v).Trim() }
        return $null
    }
    if ($env:OS -ne 'Windows_NT') { return $null }
    try {
        Initialize-ScrimshawCredentialReader
        $v = [Scrimshaw.FairleadCredential]::Read($script:ScrimshawFairleadTarget)
        if ($v -and (Test-ScrimshawFairleadKeyText $v)) { return $v.Trim() }
    } catch { }
    return $null
}

function Resolve-ScrimshawFairleadKey {
    # Credential first (Fairlead/<App>), then the local-token file. Never an environment variable.
    $cred = Get-ScrimshawFairleadCredential
    if ($cred) { return @{ Key = $cred; Source = 'credential' } }
    $local = Read-ScrimshawLocalToken
    if ($local) { return @{ Key = $local; Source = 'local-token' } }
    return $null
}

# --- path identity, same rules as FleetPort Test-FleetProcessIdentity ---

function ConvertTo-ScrimshawAbsolutePath([string]$Path) {
    if (-not $Path) { return $null }
    $p = $Path.Trim().Trim('"').Replace('/', '\')
    if ($p -notmatch '^(?:[A-Za-z]:\\|\\\\[^\\?.]+\\[^\\]+)') { return $null }
    if ($env:OS -eq 'Windows_NT') {
        try { $p = [IO.Path]::GetFullPath($p) } catch { return $null }
    } elseif ($p -match '\\\.{1,2}(\\|$)') { return $null }
    return $p.TrimEnd('\')
}

function Split-ScrimshawCommandLine([string]$CommandLine) {
    $out = New-Object System.Collections.Generic.List[string]
    if (-not $CommandLine) { return ,$out.ToArray() }
    $sb = New-Object System.Text.StringBuilder
    $inQuote = $false; $have = $false; $i = 0; $n = $CommandLine.Length
    while ($i -lt $n) {
        $c = $CommandLine[$i]
        if ($c -eq '\') {
            $j = $i; while ($j -lt $n -and $CommandLine[$j] -eq '\') { $j++ }
            $count = $j - $i
            if ($j -lt $n -and $CommandLine[$j] -eq '"') {
                [void]$sb.Append('\', [int][Math]::Floor($count / 2))
                if ($count % 2 -eq 1) { [void]$sb.Append('"'); $i = $j + 1 } else { $i = $j }
            } else { [void]$sb.Append('\', $count); $i = $j }
            $have = $true; continue
        }
        if ($c -eq '"') {
            if ($inQuote -and ($i + 1) -lt $n -and $CommandLine[$i + 1] -eq '"') { [void]$sb.Append('"'); $i += 2; $have = $true; continue }
            $inQuote = -not $inQuote; $have = $true; $i++; continue
        }
        if (-not $inQuote -and ($c -eq ' ' -or $c -eq "`t")) {
            if ($have) { $out.Add($sb.ToString()); [void]$sb.Clear(); $have = $false }
            $i++; continue
        }
        [void]$sb.Append($c); $have = $true; $i++
    }
    if ($have) { $out.Add($sb.ToString()) }
    return ,$out.ToArray()
}

function Get-ScrimshawScriptFromCommandLine([string]$CommandLine) {
    [string[]]$argv = Split-ScrimshawCommandLine $CommandLine
    if ($null -eq $argv -or $argv.Count -lt 3) { return $null }
    $exeLeaf = ($argv[0] -split '[\\/]')[-1]
    if (@('powershell', 'powershell.exe', 'pwsh', 'pwsh.exe') -notcontains $exeLeaf.ToLowerInvariant()) { return $null }
    for ($k = 1; $k -lt $argv.Count - 1; $k++) {
        $a = $argv[$k].ToLowerInvariant()
        if ($a -eq '-file' -or $a -eq '-f' -or $a -eq '/file') { return $argv[$k + 1] }
        if ($a -match '^[-/](c|command|e|ec|encodedcommand|commandwithargs|cwa)$') { return $null }
        if ($a -match '^[-/](executionpolicy|ep|ex|windowstyle|w|version|v|inputformat|if|outputformat|of|psconsolefile|configurationname|workingdirectory|wd|settingsfile)$') { $k++; continue }
        if ($a -notmatch '^[-/]') { return $null }
    }
    return $null
}

function Test-ScrimshawProcessPath([string]$Path, [string]$CommandLine, [string]$ExecutablePath) {
    $want = ConvertTo-ScrimshawAbsolutePath $Path
    if (-not $want) { return $false }
    $exe = ConvertTo-ScrimshawAbsolutePath $ExecutablePath
    if ($exe -and [string]::Equals($exe, $want, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    $script = ConvertTo-ScrimshawAbsolutePath (Get-ScrimshawScriptFromCommandLine $CommandLine)
    if ($script -and [string]::Equals($script, $want, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $false
}

function Test-ScrimshawFairleadIdentity($Id, [int[]]$Owners, $Process, [bool]$OwnersKnown = $true) {
    # No listener list means the check could not run. Do not send the key.
    if (-not $OwnersKnown) { return @{ Ok = $false; Problem = 'owner' } }
    $listeners = @($Owners)
    if (-not $Id) {
        # Nothing answered, and nothing is listening: Fairlead can be started.
        if ($listeners.Count -eq 0) { return @{ Ok = $false; Problem = 'none' } }
        return @{ Ok = $false; Problem = 'owner' }
    }
    $tool = ''
    if ($Id.PSObject -and ($Id.PSObject.Properties.Name -contains 'tool')) { $tool = [string]$Id.tool }
    elseif ($Id -is [System.Collections.IDictionary] -and $Id.Contains('tool')) { $tool = [string]$Id['tool'] }
    if ($tool -ne 'fairlead') { return @{ Ok = $false; Problem = 'tool' } }
    $pidText = ''
    if ($Id.PSObject -and ($Id.PSObject.Properties.Name -contains 'pid')) { $pidText = [string]$Id.pid }
    elseif ($Id -is [System.Collections.IDictionary] -and $Id.Contains('pid')) { $pidText = [string]$Id['pid'] }
    $procId = 0
    if (-not [int]::TryParse($pidText, [ref]$procId) -or $procId -le 4) { return @{ Ok = $false; Problem = 'pid' } }
    # Exactly one listener, and it is the pid the id report named.
    if ($listeners.Count -ne 1 -or [int]$listeners[0] -ne $procId) { return @{ Ok = $false; Problem = 'owner' } }
    $path = ''
    if ($Id.PSObject -and ($Id.PSObject.Properties.Name -contains 'path') -and $Id.path) { $path = [string]$Id.path }
    elseif ($Id -is [System.Collections.IDictionary] -and $Id.Contains('path') -and $Id['path']) { $path = [string]$Id['path'] }
    # A missing path is not proof. Fail closed.
    if (-not $path) { return @{ Ok = $false; Problem = 'path' } }
    $cmd = ''; $exe = ''
    if ($Process) {
        if ($Process.PSObject -and ($Process.PSObject.Properties.Name -contains 'CommandLine')) { $cmd = [string]$Process.CommandLine }
        elseif ($Process -is [System.Collections.IDictionary] -and $Process.Contains('CommandLine')) { $cmd = [string]$Process['CommandLine'] }
        if ($Process.PSObject -and ($Process.PSObject.Properties.Name -contains 'ExecutablePath')) { $exe = [string]$Process.ExecutablePath }
        elseif ($Process -is [System.Collections.IDictionary] -and $Process.Contains('ExecutablePath')) { $exe = [string]$Process['ExecutablePath'] }
    }
    if (-not (Test-ScrimshawProcessPath -Path $path -CommandLine $cmd -ExecutablePath $exe)) {
        return @{ Ok = $false; Problem = 'path' }
    }
    return @{ Ok = $true; Problem = '' }
}

function Test-ScrimshawRequestOrigin([string]$Origin, [string[]]$Allowed, [bool]$RequireOrigin) {
    # Fairlead routes require an Origin on the allowlist. Other loopback routes still allow a blank Origin.
    $value = ''
    if ($Origin) { $value = $Origin.Trim().ToLowerInvariant() }
    $listed = $false
    if ($value -and $null -ne $Allowed) {
        foreach ($item in @($Allowed)) { if ([string]$item -eq $value) { $listed = $true; break } }
    }
    if ($RequireOrigin) { return $listed }
    if ($value -eq '') { return $true }
    return $listed
}

function Get-ScrimshawFairleadPortOwners([int]$Port) {
    # Known $false means the listener check could not run. Callers must not send the key.
    if ($script:ScrimshawHookOwners) {
        $hooked = & $script:ScrimshawHookOwners $Port
        if ($null -eq $hooked) { return @{ Known = $false; Pids = @() } }
        return @{ Known = $true; Pids = @($hooked | ForEach-Object { [int]$_ }) }
    }
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        try {
            $owners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique)
            return @{ Known = $true; Pids = @($owners) }
        } catch { return @{ Known = $false; Pids = @() } }
    }
    $netstat = Join-Path ([Environment]::SystemDirectory) 'netstat.exe'
    if (-not (Test-Path -LiteralPath $netstat)) { return @{ Known = $false; Pids = @() } }
    try {
        $owners = @()
        foreach ($line in @(& $netstat -ano -p TCP 2>$null) + @(& $netstat -ano -p TCPv6 2>$null)) {
            if ([string]$line -match '^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$' -and [int]$Matches[2] -eq $Port) { $owners += [int]$Matches[3] }
        }
        return @{ Known = $true; Pids = @($owners | Sort-Object -Unique) }
    } catch { return @{ Known = $false; Pids = @() } }
}

function Get-ScrimshawProcessInfo([int]$ProcessId) {
    if ($script:ScrimshawHookProcess) { return (& $script:ScrimshawHookProcess $ProcessId) }
    if ($env:OS -ne 'Windows_NT') { return $null }
    try {
        $p = Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
        if (-not $p) { return $null }
        return @{ CommandLine = [string]$p.CommandLine; ExecutablePath = [string]$p.ExecutablePath }
    } catch { return $null }
}

function Find-ScrimshawFleetPortModule {
    if ($env:SCRIMSHAW_FLEETPORT -and (Test-Path -LiteralPath $env:SCRIMSHAW_FLEETPORT -PathType Leaf)) {
        return $env:SCRIMSHAW_FLEETPORT
    }
    $here = $PSScriptRoot
    if (-not $here) { $here = (Split-Path -Parent $MyInvocation.MyCommand.Path) }
    $names = @(
        (Join-Path $here '..\edge-ops\tools\fleet-port\FleetPort.psm1'),
        (Join-Path $here '..\..\edge-ops\tools\fleet-port\FleetPort.psm1')
    )
    if ($env:USERPROFILE) {
        $names += (Join-Path $env:USERPROFILE 'Projects\edge-ops\tools\fleet-port\FleetPort.psm1')
        $names += (Join-Path $env:USERPROFILE 'src\edge-ops\tools\fleet-port\FleetPort.psm1')
    }
    foreach ($c in $names) {
        if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return (Resolve-Path -LiteralPath $c).Path }
    }
    return $null
}

function Start-ScrimshawFairleadService {
    if ($script:ScrimshawHookStart) { return (& $script:ScrimshawHookStart) }
    try {
        if (-not (Get-Command Start-FleetService -ErrorAction SilentlyContinue)) {
            $mod = Find-ScrimshawFleetPortModule
            if (-not $mod) { return @{ State = 'unavailable'; Reason = 'no-helper' } }
            Import-Module -Name $mod -Force -ErrorAction Stop
        }
        $r = Start-FleetService -Name fairlead -WaitSeconds 40
        $state = 'unavailable'; $reason = 'start-failed'
        if ($r) {
            if ($r.PSObject.Properties.Name -contains 'State') { $state = [string]$r.State }
            if ($r.PSObject.Properties.Name -contains 'Reason' -and $r.Reason) { $reason = [string]$r.Reason }
        }
        return @{ State = $state; Reason = $reason }
    } catch {
        return @{ State = 'unavailable'; Reason = 'start-failed' }
    }
}

function Get-ScrimshawFairleadProbe([string]$Base) {
    if ($script:ScrimshawHookProbe) { return (& $script:ScrimshawHookProbe $Base) }
    $url = $Base.TrimEnd('/') + '/__fleethacker/id'
    if (-not (Test-ScrimshawLoopbackHttp $url)) { return $null }
    $resp = $null
    try {
        $req = [System.Net.HttpWebRequest]::Create($url)
        $req.Method = 'GET'
        $req.Proxy = $null
        $req.AllowAutoRedirect = $false
        $req.Timeout = 3000
        $req.ReadWriteTimeout = 3000
        $req.Accept = 'application/json'
        $resp = $req.GetResponse()
        if ([int]$resp.StatusCode -ne 200) { return $null }
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        try { $text = $reader.ReadToEnd() } finally { $reader.Close() }
        if (-not $text -or $text.Length -gt 8192) { return $null }
        return ($text | ConvertFrom-Json)
    } catch { return $null }
    finally { if ($resp) { $resp.Close() } }
}

function Resolve-ScrimshawFairleadReady([string]$Base) {
    $port = 8776
    try { $parsed = [int]([uri]$Base).Port; if ($parsed -gt 0) { $port = $parsed } } catch { }
    $id = Get-ScrimshawFairleadProbe $Base
    $found = Get-ScrimshawFairleadPortOwners $port
    $proc = $null
    $procId = 0
    if ($id -and [int]::TryParse([string]$id.pid, [ref]$procId) -and $procId -gt 0) { $proc = Get-ScrimshawProcessInfo $procId }
    $check = Test-ScrimshawFairleadIdentity -Id $id -Owners $found.Pids -Process $proc -OwnersKnown $found.Known
    if ($check.Ok) { return @{ Ok = $true; Problem = '' } }
    # Start only when nothing answers and nothing is listening. A foreign program, or a check
    # that could not list listeners, is left alone and the key is not sent.
    if ($check.Problem -ne 'none') { return @{ Ok = $false; Problem = $check.Problem } }
    $started = Start-ScrimshawFairleadService
    $id = Get-ScrimshawFairleadProbe $Base
    $found = Get-ScrimshawFairleadPortOwners $port
    $proc = $null; $procId = 0
    if ($id -and [int]::TryParse([string]$id.pid, [ref]$procId) -and $procId -gt 0) { $proc = Get-ScrimshawProcessInfo $procId }
    $check = Test-ScrimshawFairleadIdentity -Id $id -Owners $found.Pids -Process $proc -OwnersKnown $found.Known
    if ($check.Ok) { return @{ Ok = $true; Problem = '' } }
    $reason = 'start-failed'
    if ($started -and $started.Reason) { $reason = [string]$started.Reason }
    return @{ Ok = $false; Problem = $reason }
}

function Get-ScrimshawSafeResponseType([string]$Type) {
    if ($Type -match '^(?i)audio/wav\b') { return 'audio/wav' }
    if ($Type -match '^(?i)audio/(mpeg|mp3)\b') { return 'audio/mpeg' }
    if ($Type -match '^(?i)text/plain\b') { return 'text/plain; charset=utf-8' }
    if ($Type -match '^(?i)application/json\b') { return 'application/json; charset=utf-8' }
    return 'application/octet-stream'
}

function Get-ScrimshawFairleadRouteSpec([string]$Route) {
    # Fixed allowlist. The page cannot choose the upstream path.
    switch ($Route) {
        '/api/fairlead/v1/chat/completions' { return @{ Upstream = '/v1/chat/completions'; Kind = 'json'; MaxBody = 262144; MaxReply = 2097152 } }
        '/api/fairlead/v1/audio/speech' { return @{ Upstream = '/v1/audio/speech'; Kind = 'json'; MaxBody = 65536; MaxReply = $script:ScrimshawFairleadMaxAudio } }
        '/api/fairlead/v1/audio/transcriptions' { return @{ Upstream = '/v1/audio/transcriptions'; Kind = 'multipart'; MaxBody = 8388608; MaxReply = 2097152 } }
        default { return $null }
    }
}

function Test-ScrimshawForwardContentType([string]$Type, [string]$Kind) {
    if ([string]::IsNullOrWhiteSpace($Type) -or $Type.Length -gt 200 -or $Type -match '[\r\n]') { return $false }
    if ($Kind -eq 'json') { return [bool]($Type -match '^(?i)application/json\b') }
    if ($Kind -eq 'multipart') { return [bool]($Type -match '^(?i)multipart/form-data;\s*boundary=[A-Za-z0-9''()+_,./:=?-]{1,70}\s*$') }
    return $false
}

function Send-ScrimshawFairleadBody([string]$Url, [string]$Key, [bool]$PrivacyLocal, [byte[]]$Body, [string]$ContentType = 'application/json', [int]$MaxReply = 0) {
    if ($script:ScrimshawHookForward) { return (& $script:ScrimshawHookForward $Url $Key $PrivacyLocal $Body $ContentType) }
    if (-not (Test-ScrimshawLoopbackHttp $Url)) {
        return (New-ScrimshawProxyResult 502 'The router address is not on this computer, so the key was not sent.')
    }
    if ($MaxReply -le 0) { $MaxReply = $script:ScrimshawFairleadMaxReply }
    $req = [System.Net.HttpWebRequest]::Create($Url)
    $req.Method = 'POST'
    # Do not let a system proxy see the request that carries the key.
    $req.Proxy = $null
    $req.AllowAutoRedirect = $false
    $req.Timeout = 180000
    $req.ReadWriteTimeout = 180000
    $req.ContentType = $ContentType
    $req.Accept = 'application/json, text/plain, audio/wav, audio/mpeg'
    [void]$req.Headers.Add('X-Fairlead-Label', $script:ScrimshawFairleadLabel)
    if ($PrivacyLocal) { [void]$req.Headers.Add('X-Fairlead-Privacy', 'local') }
    # Authorization is a restricted header on HttpWebRequest. Set it by the enum, not Add().
    $req.Headers[[System.Net.HttpRequestHeader]::Authorization] = 'Bearer ' + $Key
    $req.ContentLength = $Body.Length
    $out = $req.GetRequestStream()
    try { $out.Write($Body, 0, $Body.Length) } finally { $out.Close() }
    $resp = $null
    try { $resp = $req.GetResponse() }
    catch [System.Net.WebException] {
        if ($_.Exception.Response) { $resp = $_.Exception.Response }
        else { return (New-ScrimshawProxyResult 502 'Could not reach Fairlead.') }
    }
    try {
        $status = [int]$resp.StatusCode
        $type = Get-ScrimshawSafeResponseType ([string]$resp.ContentType)
        $stream = $resp.GetResponseStream()
        $ms = New-Object System.IO.MemoryStream
        $buf = New-Object byte[] 8192
        $total = 0
        while ($true) {
            $n = $stream.Read($buf, 0, $buf.Length)
            if ($n -le 0) { break }
            $total += $n
            if ($total -gt $MaxReply) {
                return (New-ScrimshawProxyResult 502 'Fairlead sent a reply that is too large.')
            }
            $ms.Write($buf, 0, $n)
        }
        return @{ Status = $status; Reason = (Get-ScrimshawProxyReason $status); Type = $type; Body = $ms.ToArray() }
    } finally {
        if ($resp) { $resp.Close() }
        $Key = $null
    }
}

function Read-ScrimshawLimitedBody($Stream, $Headers, [int]$MaxBytes) {
    if ($Headers.ContainsKey('transfer-encoding')) { return @{ Ok = $false; Error = 'Chunked requests are not supported.' } }
    if (-not $Headers.ContainsKey('content-length')) { return @{ Ok = $false; Error = 'Content-Length is required.' } }
    $len = 0
    if (-not [int]::TryParse($Headers['content-length'], [ref]$len) -or $len -lt 0) { return @{ Ok = $false; Error = 'Bad Content-Length.' } }
    if ($len -gt $MaxBytes) { return @{ Ok = $false; Error = 'The request is too large.' } }
    if ($len -eq 0) { return @{ Ok = $true; Body = (New-Object byte[] 0) } }
    $body = New-Object byte[] $len
    $got = 0
    while ($got -lt $len) {
        $n = $Stream.Read($body, $got, $len - $got)
        if ($n -le 0) { break }
        $got += $n
    }
    if ($got -ne $len) { return @{ Ok = $false; Error = 'The request ended early.' } }
    return @{ Ok = $true; Body = $body }
}

function Get-ScrimshawFairleadStateWord([string]$Base) {
    # Probe only. A status request must not start Fairlead.
    $port = 8776
    try { $parsed = [int]([uri]$Base).Port; if ($parsed -gt 0) { $port = $parsed } } catch { }
    $id = Get-ScrimshawFairleadProbe $Base
    $found = Get-ScrimshawFairleadPortOwners $port
    $proc = $null
    $procId = 0
    if ($id -and [int]::TryParse([string]$id.pid, [ref]$procId) -and $procId -gt 0) { $proc = Get-ScrimshawProcessInfo $procId }
    $check = Test-ScrimshawFairleadIdentity -Id $id -Owners $found.Pids -Process $proc -OwnersKnown $found.Known
    if ($check.Ok) { return 'running' }
    if ($check.Problem -eq 'none') { return 'stopped' }
    return 'unverified'
}

function Get-ScrimshawFairleadStatusObject {
    $fairlead = Get-ScrimshawFairleadStateWord (Get-ScrimshawFairleadBase)
    $source = 'none'
    $resolved = Resolve-ScrimshawFairleadKey
    if ($resolved) { $source = [string]$resolved.Source; $resolved.Key = $null; $resolved = $null }
    return @{ fairlead = $fairlead; key = $source }
}

function Invoke-ScrimshawFairleadRoute([string]$Method, [string]$Route, $Headers, [byte[]]$Body) {
    $base = Get-ScrimshawFairleadBase
    if ($Route -eq '/api/fairlead/status') {
        if ($Method -ne 'GET' -and $Method -ne 'HEAD') { return (New-ScrimshawProxyResult 405 'Method not allowed.') }
        $status = Get-ScrimshawFairleadStatusObject
        $json = ($status | ConvertTo-Json -Compress)
        return (New-ScrimshawProxyResult 200 $null 'application/json; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($json)))
    }
    $spec = Get-ScrimshawFairleadRouteSpec $Route
    if (-not $spec) { return (New-ScrimshawProxyResult 404 'No such route.') }
    if ($Method -ne 'POST') { return (New-ScrimshawProxyResult 405 'Method not allowed.') }
    $ctype = ''
    if ($Headers -and $Headers.ContainsKey('content-type')) { $ctype = [string]$Headers['content-type'] }
    if (-not (Test-ScrimshawForwardContentType $ctype $spec.Kind)) {
        if ($spec.Kind -eq 'multipart') { return (New-ScrimshawProxyResult 400 'Content-Type must be multipart/form-data with a boundary.') }
        return (New-ScrimshawProxyResult 400 'Content-Type must be application/json.')
    }
    if (-not $Body -or $Body.Length -eq 0) { return (New-ScrimshawProxyResult 400 'The request had no body.') }
    if ($Body.Length -gt [int]$spec.MaxBody) { return (New-ScrimshawProxyResult 413 'The request is too large.') }
    if ($spec.Kind -eq 'json') {
        $text = ''
        try { $text = [Text.Encoding]::UTF8.GetString($Body).Trim() } catch { return (New-ScrimshawProxyResult 400 'The request was not JSON.') }
        if (-not $text.StartsWith('{')) { return (New-ScrimshawProxyResult 400 'The request was not a JSON object.') }
        try { $null = $text | ConvertFrom-Json } catch { return (New-ScrimshawProxyResult 400 'The request was not JSON.') }
    }
    $ready = Resolve-ScrimshawFairleadReady $base
    if (-not $ready.Ok) {
        $msg = 'The program on Fairlead''s port did not identify itself as Fairlead, so the key was not sent.'
        if ($ready.Problem -eq 'none' -or $ready.Problem -eq 'start-failed' -or $ready.Problem -eq 'timeout' -or $ready.Problem -eq 'exited') {
            $msg = 'Fairlead is not running. Scrimshaw tried to start it and it did not identify itself, so the key was not sent.'
        } elseif ($ready.Problem -eq 'no-helper' -or $ready.Problem -eq 'not-found') {
            $msg = 'Fairlead is not running, and FleetPort Start-FleetService is not available on this computer, so the key was not sent.'
        }
        return (New-ScrimshawProxyResult 503 $msg)
    }
    $resolved = $null
    if ($script:ScrimshawHookKey) { $resolved = & $script:ScrimshawHookKey }
    else { $resolved = Resolve-ScrimshawFairleadKey }
    if (-not $resolved -or -not $resolved.Key) {
        return (New-ScrimshawProxyResult 503 'No Fairlead key is on this computer. Open Fairlead once so it can write its local token, or install the Fairlead/Scrimshaw credential.')
    }
    $key = [string]$resolved.Key
    $resolved.Key = $null
    $privacy = $false
    if ($Headers -and $Headers.ContainsKey('x-fairlead-privacy') -and [string]$Headers['x-fairlead-privacy'] -match '^(?i)local$') { $privacy = $true }
    $url = $base.TrimEnd('/') + $spec.Upstream
    try {
        return (Send-ScrimshawFairleadBody -Url $url -Key $key -PrivacyLocal $privacy -Body $Body -ContentType $ctype -MaxReply ([int]$spec.MaxReply))
    } catch {
        return (New-ScrimshawProxyResult 502 'Could not complete the call to Fairlead.')
    } finally {
        $key = $null
    }
}
