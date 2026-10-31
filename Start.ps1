#requires -Version 5.1
<#
  Scrimshaw local server (run by Launch.bat).
  Serves the built app in dist\ on http://127.0.0.1 with a TcpListener, then opens the default
  browser. Per the TechStack: no admin rights, no installer, no service, nothing leaves the machine.
  Projects are stored in the browser (IndexedDB), so this server only serves static files.

    Start.ps1                 use port 8775 (Scrimshaw's Fleet port) and open the browser
    Start.ps1 -Port 9000      use a specific port exactly (an error if it is busy)
    Start.ps1 -NoBrowser      print the URL instead of opening it
    Start.ps1 -IdleMinutes 0  never stop on idle (default: stop after 240 idle minutes)

  Close the console window (or press Ctrl+C) to stop it.
#>
param(
    [int]$Port = 0,
    [switch]$NoBrowser,
    [int]$IdleMinutes = 240,
    [string]$Root = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

if (-not $Root) { $Root = Join-Path $PSScriptRoot 'dist' }
$Root = [IO.Path]::GetFullPath($Root)
if (-not (Test-Path -LiteralPath (Join-Path $Root 'index.html'))) {
    Write-Host "Scrimshaw could not start: $Root\index.html is missing. Download a release, or build it with 'npm run build'." -ForegroundColor Red
    exit 1
}

$Mime = @{
    '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
    '.mjs' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'
    '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.gif' = 'image/gif'
    '.webp' = 'image/webp'; '.ico' = 'image/x-icon'; '.woff2' = 'font/woff2'; '.mp4' = 'video/mp4'; '.webm' = 'video/webm'
    '.mp3' = 'audio/mpeg'; '.wav' = 'audio/wav'; '.txt' = 'text/plain; charset=utf-8'; '.xml' = 'application/xml; charset=utf-8'
    '.wasm' = 'application/wasm'; '.zip' = 'application/zip'
}

# Scrimshaw's block in the Fleet port registry (edge-ops PORTS.md) is the single port 8775, policy "reuse".
# Browser data is keyed to the origin, so the port never moves: no walking, no port 0.
$FleetPort = 8775
$ownVersion = '0.0.0'
foreach ($vf in @((Join-Path $PSScriptRoot 'VERSION'), (Join-Path $Root 'VERSION'))) {
    if (Test-Path -LiteralPath $vf -PathType Leaf) { $ownVersion = ([IO.File]::ReadAllText($vf)).Trim(); break }
}

function Get-RunningScrimshaw([int]$P) {
    # Answers only for a Scrimshaw that serves the Fleet id endpoint; anything else (or silence) is "not ours".
    try {
        $r = Invoke-RestMethod -UseBasicParsing -Uri "http://127.0.0.1:$P/__fleethacker/id" -TimeoutSec 2
        if ($r -and $r.tool -eq 'scrimshaw') { return $r }
    } catch { }
    return $null
}

function Compare-DottedVersion([string]$A, [string]$B) {
    # Dotted numbers; a -suffix is ignored; a version that does not parse counts as older.
    $pa = @(($A -split '-')[0] -split '\.'); $pb = @(($B -split '-')[0] -split '\.')
    for ($i = 0; $i -lt [Math]::Max($pa.Count, $pb.Count); $i++) {
        $x = 0; $y = 0
        if ($i -lt $pa.Count -and -not [int]::TryParse($pa[$i], [ref]$x)) { return -1 }
        if ($i -lt $pb.Count) { [void][int]::TryParse($pb[$i], [ref]$y) }
        if ($x -ne $y) { if ($x -lt $y) { return -1 } else { return 1 } }
    }
    return 0
}

function New-Listener([int]$Preferred) {
    # A port given with -Port is used exactly (busy means an error). Otherwise the Fleet port, under the "reuse" policy:
    # the same or a newer Scrimshaw already there -> open the browser to it and exit; an older one -> stop it, then start.
    $p = if ($Preferred -gt 0) { $Preferred } else { $FleetPort }
    for ($attempt = 0; $attempt -lt 2; $attempt++) {
        try {
            $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
            $l.Start()
            return $l
        } catch {
            if ($Preferred -gt 0) { throw "Port $p is not available: $($_.Exception.Message)" }
            $running = Get-RunningScrimshaw $p
            if (-not $running) { throw "Port $p (Scrimshaw's port in the Fleet registry) is in use by another program, or by a Scrimshaw too old to identify itself. Close it, or run Start.ps1 -Port <n>." }
            $existing = "http://127.0.0.1:$p/"
            if ((Compare-DottedVersion ([string]$running.version) $ownVersion) -ge 0) {
                Write-Host "Scrimshaw $($running.version) is already running at $existing" -ForegroundColor Green
                if (-not $NoBrowser) { try { Start-Process $existing } catch { Write-Host "Open $existing in Edge or Chrome." -ForegroundColor Yellow } }
                exit 0
            }
            Write-Host "An older Scrimshaw ($($running.version)) is running on port $p; stopping it." -ForegroundColor Yellow
            try { [void](Invoke-WebRequest -UseBasicParsing -Method Post -Uri "${existing}__fleethacker/shutdown" -Headers @{ 'X-FleetHacker-Shutdown' = '1' } -TimeoutSec 3) } catch { }
            $deadline = (Get-Date).AddSeconds(5)
            while ((Get-RunningScrimshaw $p) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 200 }
        }
    }
    throw "An older Scrimshaw is still running on port $p; close its window and relaunch."
}

function Send-Response($Stream, [int]$Status, [string]$Reason, [string]$Type, [byte[]]$Body, [bool]$HeadOnly) {
    $headers = "HTTP/1.1 $Status $Reason`r`n" +
        "Content-Type: $Type`r`n" +
        "Content-Length: $($Body.Length)`r`n" +
        "Cache-Control: no-store`r`n" +
        "X-Content-Type-Options: nosniff`r`n" +
        "Referrer-Policy: no-referrer`r`n" +
        "Cross-Origin-Opener-Policy: same-origin`r`n" +
        "Connection: close`r`n`r`n"
    $h = [Text.Encoding]::ASCII.GetBytes($headers)
    $Stream.Write($h, 0, $h.Length)
    if (-not $HeadOnly -and $Body.Length -gt 0) { $Stream.Write($Body, 0, $Body.Length) }
    $Stream.Flush()
}

function Send-Text($Stream, [int]$Status, [string]$Reason, [string]$Text, [bool]$HeadOnly) {
    Send-Response $Stream $Status $Reason 'text/plain; charset=utf-8' ([Text.Encoding]::UTF8.GetBytes($Text)) $HeadOnly
}

function Read-RequestHead($Stream) {
    # Reads up to the blank line ending the headers (max 16 KB).
    $buf = New-Object byte[] 1
    $sb = New-Object System.Text.StringBuilder
    while ($sb.Length -lt 16384) {
        $n = $Stream.Read($buf, 0, 1)
        if ($n -le 0) { break }
        [void]$sb.Append([char]$buf[0])
        if ($sb.Length -ge 4 -and $sb.ToString($sb.Length - 4, 4) -eq "`r`n`r`n") { break }
    }
    return $sb.ToString()
}

function Resolve-StaticPath([string]$UrlPath) {
    $path = [Uri]::UnescapeDataString(($UrlPath -split '\?')[0])
    if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
    if ($path.Contains("`0")) { return $null }
    $rel = $path.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
    $full = [IO.Path]::GetFullPath((Join-Path $Root $rel))
    $rootWithSep = $Root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($rootWithSep, [StringComparison]::OrdinalIgnoreCase)) { return $null }
    if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { return $null }
    return $full
}

$listener = New-Listener $Port
$actualPort = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
$url = "http://127.0.0.1:$actualPort/"
$allowedHosts = @("127.0.0.1:$actualPort", "localhost:$actualPort")
try { $Host.UI.RawUI.WindowTitle = "Scrimshaw - $url" } catch { }
Write-Host "Scrimshaw is running at $url" -ForegroundColor Green
Write-Host 'Your projects are saved in the browser. Close this window to stop the server.'
if (-not $NoBrowser) { try { Start-Process $url } catch { Write-Host "Open $url in Edge or Chrome." -ForegroundColor Yellow } }

$lastRequest = Get-Date
try {
    while ($true) {
        if (-not $listener.Pending()) {
            Start-Sleep -Milliseconds 50
            if ($IdleMinutes -gt 0 -and ((Get-Date) - $lastRequest).TotalMinutes -ge $IdleMinutes) {
                Write-Host "No requests for $IdleMinutes minutes; stopping." -ForegroundColor Yellow
                break
            }
            continue
        }
        $client = $listener.AcceptTcpClient()
        $lastRequest = Get-Date
        try {
            $client.ReceiveTimeout = 5000
            $client.SendTimeout = 10000
            $stream = $client.GetStream()
            # Browsers open idle "preconnect" sockets. This server handles one connection at a time, so
            # give a socket 300 ms to start its request and otherwise close it (the browser reconnects).
            $deadline = (Get-Date).AddMilliseconds(300)
            while (-not $stream.DataAvailable -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 5 }
            if (-not $stream.DataAvailable) { continue }
            $head = Read-RequestHead $stream
            $lines = $head -split "`r`n"
            $parts = $lines[0] -split ' '
            if ($parts.Count -lt 3) { Send-Text $stream 400 'Bad Request' 'Bad request' $false; continue }
            $method = $parts[0]
            $target = $parts[1]
            $hostHeader = ($lines | Where-Object { $_ -match '^(?i)host:\s*' } | Select-Object -First 1)
            $hostValue = if ($hostHeader) { ($hostHeader -replace '^(?i)host:\s*', '').Trim().ToLowerInvariant() } else { '' }
            # Only answer requests addressed to this server (blocks DNS-rebinding pages).
            if ($allowedHosts -notcontains $hostValue) { Send-Text $stream 403 'Forbidden' 'Forbidden' $false; continue }
            $headOnly = $method -eq 'HEAD'
            if ($method -ne 'GET' -and -not $headOnly) { Send-Text $stream 405 'Method Not Allowed' 'Method not allowed' $false; continue }
            $file = Resolve-StaticPath $target
            if (-not $file) { Send-Text $stream 404 'Not Found' 'Not found' $headOnly; continue }
            $ext = [IO.Path]::GetExtension($file).ToLowerInvariant()
            $type = if ($Mime.ContainsKey($ext)) { $Mime[$ext] } else { 'application/octet-stream' }
            Send-Response $stream 200 'OK' $type ([IO.File]::ReadAllBytes($file)) $headOnly
        } catch {
            Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor DarkYellow
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
}
