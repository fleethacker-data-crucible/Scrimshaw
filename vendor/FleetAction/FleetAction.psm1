#requires -Version 5.1
<#
  Fleet action framework (Windows PowerShell 5.1).

  One registered action is one function. The CLI, a JSON job file, and the loopback
  HTTP API all call Invoke-FleetAction, which calls that function.

  This copy is vendored. See LOCK.json for the upstream pin. It is written to the
  contract in use while fleet-action-baseline is still landing:
    - action ids are app.noun.verb
    - discovery is "<app> commands --json"; "help --json" is an alias
    - JSON job files only
    - destructive actions require -Confirmed (--confirmed)
    - ConvertFrom-Json objects are read with PSObject.Properties, never ContainsKey
    - ConvertTo-Json is only called with -Depth
    - secrets are not written to logs
    - the listener binds http://127.0.0.1:<port>/ only
#>
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$script:FleetActions = @{}
$script:FleetToken = $null
$script:FleetListener = $null
$script:FleetSchema = 1

function Protect-FleetLog {
    param([AllowNull()][string]$Message)
    if ($null -eq $Message) { return '' }
    $clean = [regex]::Replace($Message, '(?i)authorization\s*:\s*(?:bearer\s+)?\S+', 'Authorization: (redacted)')
    $clean = [regex]::Replace($clean, '(?i)bearer\s+\S+', 'Bearer (redacted)')
    $clean = [regex]::Replace($clean, '(?i)((?:token|password|secret|api[_-]?key)\s*[=:]\s*)\S+', '$1(redacted)')
    $clean = [regex]::Replace($clean, '(?i)("(?:token|password|secret|apiKey|api_key)"\s*:\s*")([^"]*)(")', '$1(redacted)$3')
    return $clean
}

function Write-FleetLog {
    param([string]$Message)
    Write-Verbose (Protect-FleetLog $Message)
}

function Get-FleetProp {
    <#
      Reads one property. ConvertFrom-Json yields a PSCustomObject: use
      PSObject.Properties. ContainsKey is only for dictionaries we built.
    #>
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        if ($Object.ContainsKey($Name)) { return $Object[$Name] }
        return $null
    }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

function ConvertTo-FleetHashtable {
    param($Value)
    if ($null -eq $Value) { return $null }
    if ($Value -is [string]) { return $Value }
    if ($Value -is [bool]) { return $Value }
    if ($Value -is [byte] -or $Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal] -or $Value -is [single]) { return $Value }
    if ($Value -is [System.Collections.IDictionary]) {
        $copy = @{}
        foreach ($key in @($Value.Keys)) { $copy[[string]$key] = ConvertTo-FleetHashtable $Value[$key] }
        return $copy
    }
    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $copy = @{}
        foreach ($prop in $Value.PSObject.Properties) { $copy[$prop.Name] = ConvertTo-FleetHashtable $prop.Value }
        return $copy
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $list = New-Object System.Collections.Generic.List[object]
        foreach ($item in $Value) { [void]$list.Add((ConvertTo-FleetHashtable $item)) }
        return ,$list.ToArray()
    }
    return $Value
}

function ConvertTo-JsonDepth {
    <# Always passes -Depth. Prefer ConvertTo-FleetJson for course documents. #>
    param($Value, [int]$Depth = 40)
    return (ConvertTo-Json -InputObject $Value -Depth $Depth -Compress)
}

function ConvertTo-FleetJson {
    param($Value)
    function Escape-Text([string]$Text) {
        if ($null -eq $Text) { return '' }
        $sb = New-Object System.Text.StringBuilder
        foreach ($ch in $Text.ToCharArray()) {
            $code = [int]$ch
            if ($code -eq 34) { [void]$sb.Append('\"') }
            elseif ($code -eq 92) { [void]$sb.Append('\\') }
            elseif ($code -eq 8) { [void]$sb.Append('\b') }
            elseif ($code -eq 12) { [void]$sb.Append('\f') }
            elseif ($code -eq 10) { [void]$sb.Append('\n') }
            elseif ($code -eq 13) { [void]$sb.Append('\r') }
            elseif ($code -eq 9) { [void]$sb.Append('\t') }
            elseif ($code -lt 32 -or $code -eq 0x2028 -or $code -eq 0x2029) {
                [void]$sb.Append(('\u{0}' -f $code.ToString('x4')))
            } else { [void]$sb.Append($ch) }
        }
        return $sb.ToString()
    }
    function Emit($Node) {
        if ($null -eq $Node) { return 'null' }
        if ($Node -is [bool]) { if ($Node) { return 'true' } else { return 'false' } }
        if ($Node -is [string]) { return '"' + (Escape-Text $Node) + '"' }
        if ($Node -is [byte] -or $Node -is [int] -or $Node -is [long]) { return ([string]$Node) }
        if ($Node -is [double] -or $Node -is [decimal] -or $Node -is [single]) {
            $number = [double]$Node
            if ([double]::IsNaN($number) -or [double]::IsInfinity($number)) { return 'null' }
            return $number.ToString('G15', [Globalization.CultureInfo]::InvariantCulture)
        }
        if ($Node -is [System.Collections.IDictionary]) {
            $parts = New-Object System.Collections.Generic.List[string]
            foreach ($key in @($Node.Keys)) {
                [void]$parts.Add(((Emit ([string]$key)) + ':' + (Emit $Node[$key])))
            }
            return '{' + ($parts -join ',') + '}'
        }
        if ($Node -is [System.Management.Automation.PSCustomObject]) {
            $parts = New-Object System.Collections.Generic.List[string]
            foreach ($prop in $Node.PSObject.Properties) {
                [void]$parts.Add(((Emit $prop.Name) + ':' + (Emit $prop.Value)))
            }
            return '{' + ($parts -join ',') + '}'
        }
        if ($Node -is [System.Collections.IEnumerable]) {
            $parts = New-Object System.Collections.Generic.List[string]
            foreach ($item in $Node) { [void]$parts.Add((Emit $item)) }
            return '[' + ($parts -join ',') + ']'
        }
        return '"' + (Escape-Text ([string]$Node)) + '"'
    }
    return (Emit $Value)
}

function New-FleetId {
    param([string]$Prefix)
    $bytes = New-Object byte[] 8
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    $hex = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    return ($Prefix + $hex)
}

function Get-FleetActionToken {
    if (-not $script:FleetToken) {
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes)
        $script:FleetToken = ([Convert]::ToBase64String($bytes)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    }
    return $script:FleetToken
}

function Clear-FleetAction {
    param([string]$App = '')
    if (-not $App) { $script:FleetActions = @{}; return }
    $next = @{}
    foreach ($key in @($script:FleetActions.Keys)) {
        if (-not $key.StartsWith("$App.")) { $next[$key] = $script:FleetActions[$key] }
    }
    $script:FleetActions = $next
}

function Register-FleetAction {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Summary,
        [hashtable]$Schema,
        [scriptblock]$Handler,
        [switch]$Destructive,
        [string[]]$Example
    )
    if ($Id -notmatch '^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+$') {
        throw "Action id '$Id' must be app.noun.verb (lowercase)."
    }
    $parts = $Id.Split('.')
    if ($null -eq $Schema) { $Schema = @{ type = 'object'; additionalProperties = $false; properties = @{}; required = @() } }
    $script:FleetActions[$Id] = @{
        Id = $Id
        App = $parts[0]
        Noun = $parts[1]
        Verb = $parts[2]
        Name = ('{0} {1}' -f $parts[1], $parts[2])
        Summary = $Summary
        Schema = $Schema
        Handler = $Handler
        Destructive = [bool]$Destructive
        Example = @($Example)
    }
}

function Get-FleetAction {
    param([string]$Id)
    if ($Id) {
        if ($script:FleetActions.ContainsKey($Id)) { return $script:FleetActions[$Id] }
        return $null
    }
    return @($script:FleetActions.Values | Sort-Object { $_.Id })
}

function Get-FleetGlobalFlags {
    return @(
        @{ name = 'json'; description = 'Print the result as one JSON object on stdout.' }
        @{ name = 'out'; description = 'File the action writes. Also accepted when the action schema has an out property.' }
        @{ name = 'yes'; description = 'Replace an existing --out file.' }
        @{ name = 'dry-run'; description = 'Report what would change and write nothing.' }
        @{ name = 'confirmed'; description = 'Run a destructive action. The parameter name is -Confirmed.' }
    )
}

function ConvertTo-FleetCommandRecord {
    param($Action)
    $schema = $Action.Schema
    return [ordered]@{
        id = $Action.Id
        name = $Action.Name
        summary = $Action.Summary
        destructive = [bool]$Action.Destructive
        args = $schema
        example = @($Action.Example)
    }
}

function Get-FleetDiscovery {
    $commands = New-Object System.Collections.Generic.List[object]
    foreach ($action in (Get-FleetAction)) { [void]$commands.Add((ConvertTo-FleetCommandRecord $action)) }
    return [ordered]@{
        schema = $script:FleetSchema
        ok = $true
        commands = $commands.ToArray()
        globalFlags = @(Get-FleetGlobalFlags)
    }
}

function Test-FleetSchema {
    param($Schema, $Value, [string]$Path)
    $errors = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Schema) { return $errors }
    $schemaType = [string](Get-FleetProp $Schema 'type')
    if (-not $schemaType) { $schemaType = 'object' }
    switch ($schemaType) {
        'object' {
            if ($null -eq $Value -or -not ($Value -is [System.Collections.IDictionary])) {
                [void]$errors.Add("$Path must be an object.")
                return $errors
            }
            $props = Get-FleetProp $Schema 'properties'
            $required = @(Get-FleetProp $Schema 'required')
            $propNames = @()
            if ($props -is [System.Collections.IDictionary]) { $propNames = @($props.Keys) }
            elseif ($props -is [System.Management.Automation.PSCustomObject]) {
                foreach ($p in $props.PSObject.Properties) { $propNames += $p.Name }
            }
            $allowed = @{}
            foreach ($name in $propNames) { $allowed[[string]$name] = $true }
            foreach ($key in @($Value.Keys)) {
                if (-not $allowed.ContainsKey([string]$key)) {
                    $additional = Get-FleetProp $Schema 'additionalProperties'
                    if ($additional -eq $false -or $null -eq $additional) { [void]$errors.Add("$Path has unknown argument '$key'.") }
                }
            }
            foreach ($name in $required) {
                if (-not $Value.ContainsKey([string]$name) -or $null -eq $Value[[string]$name] -or ([string]$Value[[string]$name]) -eq '') {
                    [void]$errors.Add("$Path is missing $name.")
                }
            }
            foreach ($name in $propNames) {
                if (-not $Value.ContainsKey([string]$name) -or $null -eq $Value[[string]$name]) {
                    $spec = Get-FleetProp $props $name
                    $default = Get-FleetProp $spec 'default'
                    if ($null -ne $default -and -not ($Value.ContainsKey([string]$name))) { $Value[[string]$name] = $default }
                    continue
                }
                $spec = Get-FleetProp $props $name
                foreach ($child in (Test-FleetSchema $spec $Value[[string]$name] "$Path.$name")) { [void]$errors.Add($child) }
            }
        }
        'string' {
            if ($Value -isnot [string]) { [void]$errors.Add("$Path must be text."); return $errors }
            $min = Get-FleetProp $Schema 'minLength'
            if ($null -ne $min -and $Value.Length -lt [int]$min) { [void]$errors.Add("$Path is too short.") }
            $enum = Get-FleetProp $Schema 'enum'
            if ($null -ne $enum) {
                $ok = $false
                foreach ($item in @($enum)) { if ([string]$item -eq $Value) { $ok = $true } }
                if (-not $ok) { [void]$errors.Add("$Path must be one of $([string]::Join(', ', @($enum))).") }
            }
        }
        'boolean' {
            if ($Value -isnot [bool]) { [void]$errors.Add("$Path must be true or false.") }
        }
        'integer' {
            $number = 0L
            $numeric = ($Value -is [byte] -or $Value -is [int] -or $Value -is [long])
            if (-not $numeric) {
                if ($Value -is [double] -or $Value -is [decimal]) { $numeric = ([double]$Value -eq [math]::Floor([double]$Value)) }
            }
            if (-not $numeric) { [void]$errors.Add("$Path must be an integer."); return $errors }
            $intValue = [long]$Value
            $min = Get-FleetProp $Schema 'minimum'
            $max = Get-FleetProp $Schema 'maximum'
            if ($null -ne $min -and $intValue -lt [long]$min) { [void]$errors.Add("$Path is below the minimum.") }
            if ($null -ne $max -and $intValue -gt [long]$max) { [void]$errors.Add("$Path is above the maximum.") }
        }
        'number' {
            $numeric = ($Value -is [byte] -or $Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal] -or $Value -is [single])
            if (-not $numeric) { [void]$errors.Add("$Path must be a number.") }
        }
        'array' {
            $notList = ($null -eq $Value -or $Value -is [string] -or $Value -is [System.Collections.IDictionary] -or $Value -is [System.Management.Automation.PSCustomObject] -or -not ($Value -is [System.Collections.IEnumerable]))
            if ($notList) {
                [void]$errors.Add("$Path must be a list.")
                return $errors
            }
            $itemSchema = Get-FleetProp $Schema 'items'
            $index = 0
            foreach ($item in $Value) {
                if ($null -ne $itemSchema) {
                    foreach ($child in (Test-FleetSchema $itemSchema $item "$Path[$index]")) { [void]$errors.Add($child) }
                }
                $index++
            }
        }
        default { [void]$errors.Add("$Path has an unsupported schema type '$schemaType'.") }
    }
    return $errors
}

function New-FleetFailure {
    param([string]$Code, [string]$Message, [int]$Exit = 1, [string]$Id = '')
    return @{
        Ok = $false
        Exit = $Exit
        Code = $Code
        Message = $Message
        Id = $Id
        Data = $null
    }
}

function Invoke-FleetAction {
    param(
        [Parameter(Mandatory = $true)][string]$Id,
        [hashtable]$Arguments,
        [switch]$DryRun,
        [switch]$Yes,
        [switch]$Confirmed
    )
    $action = Get-FleetAction $Id
    if (-not $action) { return (New-FleetFailure 'usage' "Unknown action '$Id'." 64 $Id) }
    if ($null -eq $Arguments) { $Arguments = @{} }
    $argsCopy = @{}
    foreach ($key in @($Arguments.Keys)) { $argsCopy[[string]$key] = $Arguments[$key] }
    if ($argsCopy.ContainsKey('dryRun') -and $argsCopy['dryRun']) { $DryRun = $true }
    if ($argsCopy.ContainsKey('yes') -and $argsCopy['yes']) { $Yes = $true }
    if ($argsCopy.ContainsKey('confirmed') -and $argsCopy['confirmed']) { $Confirmed = $true }
    foreach ($flag in @('dryRun', 'yes', 'confirmed', 'json')) { [void]$argsCopy.Remove($flag) }
    $schemaErrors = @(Test-FleetSchema $action.Schema $argsCopy '')
    if ($schemaErrors.Count -gt 0) {
        return (New-FleetFailure 'usage' ($schemaErrors -join ' ') 64 $Id)
    }
    if ($action.Destructive -and -not $Confirmed -and -not $DryRun) {
        return (New-FleetFailure 'confirm' "This action is destructive. Pass --confirmed to run it." 1 $Id)
    }
    $context = @{
        DryRun = [bool]$DryRun
        Yes = [bool]$Yes
        Confirmed = [bool]$Confirmed
        Id = $Id
    }
    try {
        $result = & $action.Handler $argsCopy $context
    } catch {
        $safe = Protect-FleetLog $_.Exception.Message
        Write-FleetLog ("Action {0} failed: {1}" -f $Id, $safe)
        return (New-FleetFailure 'error' $safe 1 $Id)
    }
    if ($null -eq $result) { return (New-FleetFailure 'error' 'The action returned nothing.' 1 $Id) }
    if ($result -is [System.Collections.IDictionary] -and $result.ContainsKey('Ok') -and -not $result['Ok']) {
        $code = 'error'
        if ($result.ContainsKey('Code') -and $result['Code']) { $code = [string]$result['Code'] }
        $exit = 1
        if ($result.ContainsKey('Exit')) { $exit = [int]$result['Exit'] }
        $message = [string]$result['Message']
        return (New-FleetFailure $code $message $exit $Id)
    }
    $data = $result
    $exitCode = 0
    if ($result -is [System.Collections.IDictionary] -and $result.ContainsKey('Data')) {
        $data = $result['Data']
        if ($result.ContainsKey('Exit')) { $exitCode = [int]$result['Exit'] }
    }
    return @{ Ok = ($exitCode -eq 0); Exit = $exitCode; Code = ''; Message = ''; Id = $Id; Data = $data }
}

function ConvertTo-FleetEnvelope {
    param($Result)
    $body = [ordered]@{
        schema = $script:FleetSchema
        ok = [bool]$Result.Ok
        id = [string]$Result.Id
    }
    if (-not $Result.Ok) {
        $code = [string]$Result.Code
        if (-not $code -and [int]$Result.Exit -eq 2) { $code = 'problems' }
        if (-not $code) { $code = 'error' }
        $message = [string]$Result.Message
        if (-not $message -and $code -eq 'problems') { $message = 'The course has problems.' }
        $body['error'] = [ordered]@{ code = $code; message = $message }
    }
    if ($null -ne $Result.Data) { $body['data'] = $Result.Data }
    return ((ConvertTo-FleetJson $body) + "`n")
}

function Format-FleetHuman {
    param($Result)
    if (-not $Result.Ok) { return ('scrimshaw: {0}' -f $Result.Message) }
    $data = $Result.Data
    if ($null -eq $data) { return 'Done.' }
    if ($data -is [System.Collections.IDictionary]) {
        $lines = New-Object System.Collections.Generic.List[string]
        foreach ($key in @($data.Keys)) {
            $value = $data[$key]
            if ($value -is [System.Collections.IEnumerable] -and $value -isnot [string]) {
                $n = 0
                foreach ($item in $value) { $n++ }
                if ($n -eq 0) { [void]$lines.Add(('{0}: (none)' -f $key)); continue }
                [void]$lines.Add(('{0}:' -f $key))
                foreach ($item in $value) { [void]$lines.Add(('  {0}' -f [string]$item)) }
            } else {
                [void]$lines.Add(('{0}: {1}' -f $key, [string]$value))
            }
        }
        return ($lines -join "`n")
    }
    return [string]$data
}

function Get-FleetUsageText {
    $lines = New-Object System.Collections.Generic.List[string]
    [void]$lines.Add('Usage: scrimshaw.ps1 <noun> <verb> [options]')
    [void]$lines.Add('       scrimshaw.ps1 commands --json')
    [void]$lines.Add('       scrimshaw.ps1 help --json')
    [void]$lines.Add('       scrimshaw.ps1 job run <file.json> [--dry-run] [--confirmed]')
    [void]$lines.Add('       scrimshaw.ps1 api --port <n>')
    [void]$lines.Add('')
    foreach ($action in (Get-FleetAction)) {
        $mark = ''
        if ($action.Destructive) { $mark = ' (destructive)' }
        [void]$lines.Add(('  {0,-24} {1}{2}' -f $action.Name, $action.Summary, $mark))
    }
    [void]$lines.Add('')
    [void]$lines.Add('Flags: --json --out --yes --dry-run --confirmed')
    [void]$lines.Add('Exit codes: 0 ok, 1 error, 2 the course has problems, 64 bad usage.')
    return ($lines -join "`n")
}

function Invoke-FleetActionCli {
    param([string[]]$Argv)
    $words = @()
    if ($null -ne $Argv) { $words = @($Argv) }
    $json = $false
    $dry = $false
    $yes = $false
    $confirmed = $false
    $resultOut = ''
    $positional = New-Object System.Collections.Generic.List[string]
    $options = @{}
    for ($i = 0; $i -lt $words.Count; $i++) {
        $word = [string]$words[$i]
        if ($word -eq '--json') { $json = $true; continue }
        if ($word -eq '--dry-run') { $dry = $true; continue }
        if ($word -eq '--yes') { $yes = $true; continue }
        if ($word -eq '--confirmed') { $confirmed = $true; continue }
        if ($word -eq '--help') { $positional.Add('help'); continue }
        if ($word -eq '--out') {
            $i++
            if ($i -ge $words.Count) {
                $fail = New-FleetFailure 'usage' '--out needs a path.' 64 ''
                return @{ Exit = 64; Stdout = ''; Stderr = "scrimshaw: --out needs a path.`n" }
            }
            $resultOut = [string]$words[$i]
            continue
        }
        if ($word.StartsWith('--')) {
            $name = $word.Substring(2)
            $i++
            if ($i -ge $words.Count -or ([string]$words[$i]).StartsWith('--')) {
                return @{ Exit = 64; Stdout = ''; Stderr = "scrimshaw: $word needs a value.`n" }
            }
            $value = [string]$words[$i]
            if ($options.ContainsKey($name)) {
                $existing = $options[$name]
                if ($existing -is [System.Collections.IList] -and $existing -isnot [string]) { [void]$existing.Add($value) }
                else {
                    $list = New-Object System.Collections.Generic.List[string]
                    [void]$list.Add([string]$existing)
                    [void]$list.Add($value)
                    $options[$name] = $list
                }
            } else { $options[$name] = $value }
            continue
        }
        [void]$positional.Add($word)
    }
    $emit = {
        param($Result, [bool]$AsJson, [string]$OutFile, [string]$Human)
        $stdout = ''
        $stderr = ''
        if ($AsJson) { $stdout = ConvertTo-FleetEnvelope $Result }
        elseif (-not $Result.Ok) { $stderr = "scrimshaw: $($Result.Message)`n" }
        else { $stdout = ($Human + "`n") }
        if ($OutFile -and $AsJson) {
            $utf8 = New-Object System.Text.UTF8Encoding $false
            [IO.File]::WriteAllText($OutFile, $stdout, $utf8)
        }
        return @{ Exit = [int]$Result.Exit; Stdout = $stdout; Stderr = $stderr }
    }
    if ($positional.Count -eq 0) {
        $text = Get-FleetUsageText
        return @{ Exit = 64; Stdout = ($text + "`n"); Stderr = '' }
    }
    $head = [string]$positional[0]
    if ($head -eq 'help' -or $head -eq 'commands') {
        if ($json) {
            $doc = Get-FleetDiscovery
            $stdout = (ConvertTo-FleetJson $doc) + "`n"
            if ($resultOut) {
                $utf8 = New-Object System.Text.UTF8Encoding $false
                [IO.File]::WriteAllText($resultOut, $stdout, $utf8)
            }
            return @{ Exit = 0; Stdout = $stdout; Stderr = '' }
        }
        return @{ Exit = 0; Stdout = ((Get-FleetUsageText) + "`n"); Stderr = '' }
    }
    if ($head -eq 'job') {
        if ($positional.Count -lt 3 -or [string]$positional[1] -ne 'run') {
            $fail = New-FleetFailure 'usage' 'Usage: scrimshaw.ps1 job run <file.json>' 64 ''
            return (& $emit $fail $json '' '')
        }
        $jobPath = [string]$positional[2]
        $result = Invoke-FleetJob -Path $jobPath -DryRun:$dry -Yes:$yes -Confirmed:$confirmed
        $human = Format-FleetHuman $result
        return (& $emit $result $json $resultOut $human)
    }
    if ($head -eq 'api') {
        return @{ Exit = 64; Stdout = ''; Stderr = "scrimshaw: 'api' is started by scrimshaw.ps1 itself, not the action runner.`n" }
    }
    if ($positional.Count -lt 2) {
        $fail = New-FleetFailure 'usage' "Usage: scrimshaw.ps1 <noun> <verb>. Run scrimshaw.ps1 commands." 64 ''
        return (& $emit $fail $json '' '')
    }
    $noun = [string]$positional[0]
    $verb = [string]$positional[1]
    $match = $null
    foreach ($action in (Get-FleetAction)) {
        if ($action.Noun -eq $noun -and $action.Verb -eq $verb) { $match = $action; break }
    }
    if (-not $match) {
        $fail = New-FleetFailure 'usage' "Unknown command '$noun $verb'. Run scrimshaw.ps1 commands." 64 ''
        return (& $emit $fail $json '' '')
    }
    $schemaProps = @{}
    $props = Get-FleetProp $match.Schema 'properties'
    if ($props -is [System.Collections.IDictionary]) {
        foreach ($key in @($props.Keys)) { $schemaProps[[string]$key] = Get-FleetProp $props $key }
    }
    $arguments = @{}
    foreach ($key in @($options.Keys)) {
        $value = $options[$key]
        if ($value -is [System.Collections.Generic.List[string]]) { $value = $value.ToArray() }
        $spec = $null
        if ($schemaProps.ContainsKey([string]$key)) { $spec = $schemaProps[[string]$key] }
        if ($null -eq $spec) {
            $fail = New-FleetFailure 'usage' "Unknown option --$key." 64 $match.Id
            return (& $emit $fail $json '' '')
        }
        $kind = [string](Get-FleetProp $spec 'type')
        if ($kind -eq 'array') {
            if ($value -is [string]) { $arguments[[string]$key] = @([string]$value) }
            else { $arguments[[string]$key] = @($value) }
        } elseif ($kind -eq 'boolean') {
            $arguments[[string]$key] = ($value -eq 'true' -or $value -eq '1')
        } elseif ($kind -eq 'integer') {
            $parsed = 0
            if (-not [int]::TryParse([string]$value, [ref]$parsed)) {
                $fail = New-FleetFailure 'usage' "--$key must be an integer." 64 $match.Id
                return (& $emit $fail $json '' '')
            }
            $arguments[[string]$key] = $parsed
        } elseif ($kind -eq 'number') {
            $parsedN = 0.0
            if (-not [double]::TryParse([string]$value, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$parsedN)) {
                $fail = New-FleetFailure 'usage' "--$key must be a number." 64 $match.Id
                return (& $emit $fail $json '' '')
            }
            $arguments[[string]$key] = $parsedN
        } else { $arguments[[string]$key] = [string]$value }
    }
    if ($resultOut -and $schemaProps.ContainsKey('out') -and -not $arguments.ContainsKey('out')) { $arguments['out'] = $resultOut; $resultOut = '' }
    if ($positional.Count -gt 2) {
        $fail = New-FleetFailure 'usage' "Unexpected argument '$($positional[2])'." 64 $match.Id
        return (& $emit $fail $json '' '')
    }
    $result = Invoke-FleetAction -Id $match.Id -Arguments $arguments -DryRun:$dry -Yes:$yes -Confirmed:$confirmed
    $human = Format-FleetHuman $result
    return (& $emit $result $json $resultOut $human)
}

function Invoke-FleetJob {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$DryRun,
        [switch]$Yes,
        [switch]$Confirmed
    )
    if ($Path -notmatch '(?i)\.json$') {
        return (New-FleetFailure 'usage' 'Job files are JSON only (.json).' 64 '')
    }
    if (-not (Test-Path -LiteralPath $Path)) {
        return (New-FleetFailure 'not-found' "Job file not found: $Path" 1 '')
    }
    $raw = [IO.File]::ReadAllText($Path)
    try { $doc = ConvertFrom-Json $raw } catch {
        return (New-FleetFailure 'usage' 'The job file is not valid JSON.' 64 '')
    }
    $steps = Get-FleetProp $doc 'actions'
    if ($null -eq $steps) { return (New-FleetFailure 'usage' 'The job file needs an actions list.' 64 '') }
    $ran = New-Object System.Collections.Generic.List[object]
    $index = 0
    foreach ($step in @($steps)) {
        $index++
        $id = [string](Get-FleetProp $step 'id')
        if (-not $id) { $id = [string](Get-FleetProp $step 'action') }
        if (-not $id) { return (New-FleetFailure 'usage' "Job step $index has no id." 64 '') }
        $rawArgs = Get-FleetProp $step 'args'
        $arguments = @{}
        if ($null -ne $rawArgs) { $arguments = ConvertTo-FleetHashtable $rawArgs }
        if ($arguments -isnot [System.Collections.IDictionary]) { $arguments = @{} }
        $stepDry = $DryRun
        $stepYes = $Yes
        $stepConfirmed = $Confirmed
        if ($arguments.ContainsKey('dryRun') -and $arguments['dryRun']) { $stepDry = $true }
        if ($arguments.ContainsKey('yes') -and $arguments['yes']) { $stepYes = $true }
        if ($arguments.ContainsKey('confirmed') -and $arguments['confirmed']) { $stepConfirmed = $true }
        $result = Invoke-FleetAction -Id $id -Arguments $arguments -DryRun:$stepDry -Yes:$stepYes -Confirmed:$stepConfirmed
        $entry = @{ step = $index; id = $id; ok = [bool]$result.Ok; exit = [int]$result.Exit }
        if (-not $result.Ok) {
            $entry['error'] = @{ code = [string]$result.Code; message = [string]$result.Message }
            [void]$ran.Add($entry)
            return @{
                Ok = $false; Exit = [int]$result.Exit; Code = [string]$result.Code; Message = [string]$result.Message; Id = $id
                Data = @{ steps = $ran.ToArray() }
            }
        }
        [void]$ran.Add($entry)
    }
    return @{ Ok = $true; Exit = 0; Code = ''; Message = ''; Id = 'job'; Data = @{ steps = $ran.ToArray(); count = $ran.Count } }
}

function Write-FleetFile {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Text,
        [bool]$Yes,
        [bool]$DryRun
    )
    $utf8 = New-Object System.Text.UTF8Encoding $false
    $bytes = $utf8.GetByteCount($Text)
    $exists = Test-Path -LiteralPath $Path
    if ($DryRun) { return @{ out = $Path; bytes = $bytes; written = $false; dryRun = $true } }
    if ($exists -and -not $Yes) {
        return @{ Ok = $false; Code = 'exists'; Exit = 1; Message = "$Path already exists. Pass --yes to replace it." }
    }
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) { [void](New-Item -ItemType Directory -Path $parent) }
    [IO.File]::WriteAllText($Path, $Text, $utf8)
    return @{ out = $Path; bytes = $bytes; written = $true; dryRun = $false }
}

function Write-FleetBytes {
    param([string]$Path, [byte[]]$Bytes, [bool]$Yes, [bool]$DryRun)
    $exists = Test-Path -LiteralPath $Path
    if ($DryRun) { return @{ out = $Path; bytes = $Bytes.Length; written = $false; dryRun = $true } }
    if ($exists -and -not $Yes) {
        return @{ Ok = $false; Code = 'exists'; Exit = 1; Message = "$Path already exists. Pass --yes to replace it." }
    }
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) { [void](New-Item -ItemType Directory -Path $parent) }
    [IO.File]::WriteAllBytes($Path, $Bytes)
    return @{ out = $Path; bytes = $Bytes.Length; written = $true; dryRun = $false }
}

function Test-FleetLoopback {
    param([string]$RemoteAddress, [string]$HostHeader, [string]$Origin, [string[]]$AllowedHosts, [string[]]$AllowedOrigins)
    if ($RemoteAddress) {
        $remoteOk = ($RemoteAddress -eq '127.0.0.1' -or $RemoteAddress -eq '::1' -or $RemoteAddress -eq '::ffff:127.0.0.1')
        if (-not $remoteOk) { return $false }
    }
    if ($HostHeader) {
        $hostOnly = $HostHeader.Trim().ToLowerInvariant()
        if ($AllowedHosts -notcontains $hostOnly) { return $false }
    }
    if ($Origin) {
        $originOnly = $Origin.Trim().ToLowerInvariant()
        if ($AllowedOrigins -notcontains $originOnly) { return $false }
    }
    return $true
}

function Invoke-FleetHttpRequest {
    param(
        [Parameter(Mandatory = $true)][string]$Method,
        [Parameter(Mandatory = $true)][string]$Path,
        [hashtable]$Headers,
        [string]$Body,
        [string]$RemoteAddress,
        [string[]]$ListenHost
    )
    if ($null -eq $Headers) { $Headers = @{} }
    $hostHeader = ''
    $origin = ''
    $token = ''
    foreach ($key in @($Headers.Keys)) {
        $lower = ([string]$key).ToLowerInvariant()
        if ($lower -eq 'host') { $hostHeader = [string]$Headers[$key] }
        elseif ($lower -eq 'origin') { $origin = [string]$Headers[$key] }
        elseif ($lower -eq 'x-fleet-action-token') { $token = [string]$Headers[$key] }
    }
    $allowedHosts = @($ListenHost)
    $allowedOrigins = @($allowedHosts | ForEach-Object { "http://$_" })
    if (-not (Test-FleetLoopback $RemoteAddress $hostHeader $origin $allowedHosts $allowedOrigins)) {
        return @{ Status = 403; Type = 'application/json; charset=utf-8'; Body = '{"schema":1,"ok":false,"error":{"code":"forbidden","message":"Forbidden"}}' }
    }
    $route = ($Path -split '\?')[0]
    $needsToken = ($Method -ne 'GET') -or ($route -ne '/api/session')
    if ($route -eq '/api/session' -and $Method -eq 'GET') {
        $session = @{ schema = $script:FleetSchema; ok = $true; token = (Get-FleetActionToken) }
        return @{ Status = 200; Type = 'application/json; charset=utf-8'; Body = (ConvertTo-FleetJson $session) }
    }
    if ($needsToken) {
        $expected = Get-FleetActionToken
        if (-not $token -or $token -ne $expected) {
            return @{ Status = 401; Type = 'application/json; charset=utf-8'; Body = '{"schema":1,"ok":false,"error":{"code":"unauthorized","message":"This call needs the loopback action token."}}' }
        }
    }
    if ($route -eq '/api/actions' -or $route -eq '/api/help') {
        if ($Method -ne 'GET') { return @{ Status = 405; Type = 'application/json; charset=utf-8'; Body = '{"schema":1,"ok":false,"error":{"code":"method","message":"Use GET."}}' } }
        return @{ Status = 200; Type = 'application/json; charset=utf-8'; Body = (ConvertTo-FleetJson (Get-FleetDiscovery)) }
    }
    if ($route -eq '/api/jobs' -and $Method -eq 'POST') {
        $temp = Join-Path ([IO.Path]::GetTempPath()) ('fleet-job-' + [guid]::NewGuid().ToString('n') + '.json')
        $utf8 = New-Object System.Text.UTF8Encoding $false
        [IO.File]::WriteAllText($temp, $Body, $utf8)
        try {
            $result = Invoke-FleetJob -Path $temp
            $status = 200
            if (-not $result.Ok) { $status = 400 }
            return @{ Status = $status; Type = 'application/json; charset=utf-8'; Body = ((ConvertTo-FleetEnvelope $result).Trim()) }
        } finally {
            Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
        }
    }
    if ($route.StartsWith('/api/actions/') -and $Method -eq 'POST') {
        $rest = $route.Substring('/api/actions/'.Length).Trim('/')
        $bits = $rest.Split('/')
        if ($bits.Count -ne 3) {
            return @{ Status = 404; Type = 'application/json; charset=utf-8'; Body = '{"schema":1,"ok":false,"error":{"code":"not-found","message":"Action route not found."}}' }
        }
        $id = ('{0}.{1}.{2}' -f $bits[0], $bits[1], $bits[2])
        $arguments = @{}
        if ($Body) {
            try { $parsed = ConvertFrom-Json $Body } catch {
                return @{ Status = 400; Type = 'application/json; charset=utf-8'; Body = '{"schema":1,"ok":false,"error":{"code":"usage","message":"The body is not valid JSON."}}' }
            }
            $converted = ConvertTo-FleetHashtable $parsed
            if ($converted -is [System.Collections.IDictionary]) { $arguments = $converted }
        }
        $result = Invoke-FleetAction -Id $id -Arguments $arguments
        $status = 200
        if (-not $result.Ok -and $result.Exit -eq 64) { $status = 400 }
        elseif (-not $result.Ok -and $result.Code -eq 'confirm') { $status = 409 }
        elseif (-not $result.Ok -and $result.Code -eq 'not-found') { $status = 404 }
        elseif (-not $result.Ok) { $status = 400 }
        return @{ Status = $status; Type = 'application/json; charset=utf-8'; Body = ((ConvertTo-FleetEnvelope $result).Trim()) }
    }
    return $null
}

function Start-FleetActionListener {
    param([int]$Port = 8775)
    if ($Port -lt 1 -or $Port -gt 65535) { throw 'Port must be between 1 and 65535.' }
    $prefix = "http://127.0.0.1:$Port/"
    if ($prefix -notmatch '^http://127\.0\.0\.1:\d+/$') { throw 'The action listener only binds http://127.0.0.1:<port>/.' }
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($prefix)
    $listener.Start()
    $script:FleetListener = $listener
    Write-FleetLog "Action API listening on $prefix"
    Write-Host "Scrimshaw action API is listening on $prefix"
    $hostName = "127.0.0.1:$Port"
    $pending = $listener.BeginGetContext($null, $null)
    try {
        while ($listener.IsListening) {
            if (-not $pending.AsyncWaitHandle.WaitOne(200)) { continue }
            $context = $null
            try { $context = $listener.EndGetContext($pending) } catch { break }
            try { $pending = $listener.BeginGetContext($null, $null) } catch { $pending = $null }
            try {
                $request = $context.Request
                $remote = $request.RemoteEndPoint.Address.ToString()
                $headerMap = @{}
                foreach ($key in $request.Headers.AllKeys) { $headerMap[$key] = $request.Headers[$key] }
                $bodyText = ''
                if ($request.HasEntityBody) {
                    $reader = New-Object System.IO.StreamReader($request.InputStream, [Text.Encoding]::UTF8)
                    try { $bodyText = $reader.ReadToEnd() } finally { $reader.Dispose() }
                }
                $answered = Invoke-FleetHttpRequest -Method $request.HttpMethod -Path $request.RawUrl -Headers $headerMap -Body $bodyText -RemoteAddress $remote -ListenHost $hostName
                if ($null -eq $answered) { $answered = @{ Status = 404; Type = 'application/json; charset=utf-8'; Body = '{"schema":1,"ok":false,"error":{"code":"not-found","message":"Not found."}}' } }
                $payload = [Text.Encoding]::UTF8.GetBytes([string]$answered.Body)
                $context.Response.StatusCode = [int]$answered.Status
                $context.Response.ContentType = [string]$answered.Type
                $context.Response.Headers.Add('Cache-Control', 'no-store')
                $context.Response.Headers.Add('X-Content-Type-Options', 'nosniff')
                $context.Response.ContentLength64 = $payload.Length
                $context.Response.OutputStream.Write($payload, 0, $payload.Length)
            } catch {
                Write-FleetLog ("Request failed: {0}" -f (Protect-FleetLog $_.Exception.Message))
            } finally {
                if ($context) { $context.Response.Close() }
            }
            if (-not $pending) { break }
        }
    } finally {
        if ($listener.IsListening) { $listener.Stop() }
        $listener.Close()
        $script:FleetListener = $null
    }
}

function Stop-FleetActionListener {
    if ($script:FleetListener) {
        try { $script:FleetListener.Stop() } catch {}
        try { $script:FleetListener.Close() } catch {}
        $script:FleetListener = $null
    }
}

Export-ModuleMember -Function @(
    'Protect-FleetLog', 'Write-FleetLog', 'Get-FleetProp', 'ConvertTo-FleetHashtable',
    'ConvertTo-JsonDepth', 'ConvertTo-FleetJson', 'New-FleetId', 'Get-FleetActionToken',
    'Clear-FleetAction', 'Register-FleetAction', 'Get-FleetAction', 'Get-FleetDiscovery',
    'Invoke-FleetAction', 'Invoke-FleetActionCli', 'Invoke-FleetJob', 'Write-FleetFile',
    'Write-FleetBytes', 'Invoke-FleetHttpRequest', 'Start-FleetActionListener',
    'Stop-FleetActionListener', 'Test-FleetSchema', 'Get-FleetUsageText'
)
