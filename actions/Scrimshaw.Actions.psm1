#requires -Version 5.1
<#
  Scrimshaw actions. Each user-facing file operation is one function. The CLI,
  JSON jobs, and the loopback API call that function through FleetAction.
#>
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$fleetModule = Join-Path (Split-Path $PSScriptRoot -Parent) 'vendor/FleetAction/FleetAction.psm1'
if (-not (Get-Module FleetAction)) { Import-Module $fleetModule }

$script:ScrimshawRoot = ''
$script:EditorConnect = "connect-src 'self' http://127.0.0.1:8776 http://localhost:8776"
$script:MaxMediaBytes = 25 * 1024 * 1024

function Get-FleetProp {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) {
        foreach ($key in @($Object.Keys)) {
            if ([string]$key -ceq $Name) { return $Object[$key] }
        }
        return $null
    }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    return $prop.Value
}

function New-FleetId {
    param([string]$Prefix)
    $bytes = New-Object byte[] 8
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($bytes)
    return ($Prefix + (-join ($bytes | ForEach-Object { $_.ToString('x2') })))
}

function Throw-Fleet {
    param([string]$Code, [string]$Message)
    FleetAction\New-FleetErrorRecord -Code $Code -Message $Message
}

function Test-ReplaceArg {
    param($Arguments)
    $value = Get-FleetProp $Arguments 'replace'
    return ($value -eq $true)
}

function Write-FleetFile {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Text, [bool]$Yes)
    $utf8 = New-Object System.Text.UTF8Encoding $false
    if ((Test-Path -LiteralPath $Path) -and -not $Yes) {
        return @{ Ok = $false; Message = "$Path already exists. Pass --replace true to replace it." }
    }
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    [IO.File]::WriteAllText($Path, $Text, $utf8)
    return @{ Ok = $true; out = $Path; bytes = $utf8.GetByteCount($Text); written = $true }
}

function Write-FleetBytes {
    param([string]$Path, [byte[]]$Bytes, [bool]$Yes)
    if ((Test-Path -LiteralPath $Path) -and -not $Yes) {
        return @{ Ok = $false; Message = "$Path already exists. Pass --replace true to replace it." }
    }
    $parent = Split-Path -Parent $Path
    if ($parent -and -not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent | Out-Null }
    [IO.File]::WriteAllBytes($Path, $Bytes)
    return @{ Ok = $true; out = $Path; bytes = $Bytes.Length; written = $true }
}

function ConvertTo-FleetJson {
    param($Value)
    $module = Get-Module FleetAction
    $script = $module.NewBoundScriptBlock({ param($Item) ConvertTo-FleetJson -Value $Item })
    $raw = $script.Invoke($Value)
    return ([string]$raw).TrimEnd()
}

function Set-FleetProp {
    param($Object, [string]$Name, $Value)
    if ($Object -is [System.Collections.IDictionary]) { $Object[$Name] = $Value; return }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
    else { $prop.Value = $Value }
}

function Get-ListProp {
    # Always return a real array. A bare "return @($one)" unwraps on Windows PowerShell 5.1,
    # and strict mode then throws when the caller reads .Count.
    param($Object, [string]$Name)
    $list = New-Object System.Collections.Generic.List[object]
    $value = Get-FleetProp $Object $Name
    if ($null -eq $value) { return ,$list.ToArray() }
    $one = ($value -is [string]) -or ($value -is [System.Collections.IDictionary]) -or ($value -is [System.Management.Automation.PSCustomObject])
    if ($one) { [void]$list.Add($value); return ,$list.ToArray() }
    foreach ($item in $value) { if ($null -ne $item) { [void]$list.Add($item) } }
    return ,$list.ToArray()
}

function New-ScrimStyle {
    param([hashtable]$Over)
    $style = [ordered]@{
        fill = 'transparent'; stroke = 'transparent'; strokeWidth = 0; radius = 0
        color = '#1a1a19'; fontSize = 20; fontWeight = 400; fontFamily = 'sans'; italic = $false; underline = $false
        align = 'left'; valign = 'top'; padding = 8; opacity = 1; shadow = $false; lineHeight = 1.35
    }
    if ($Over) { foreach ($key in @($Over.Keys)) { $style[$key] = $Over[$key] } }
    return $style
}

function New-ScrimObject {
    param([string]$Kind, [hashtable]$Over)
    $obj = [ordered]@{
        id = (New-FleetId 'o'); kind = $Kind; name = $Kind; x = 80; y = 80; w = 200; h = 100; rotation = 0
        style = (New-ScrimStyle @{})
        text = ''; shape = 'rect'; src = ''; alt = ''; decorative = $false
        initiallyHidden = $false; start = 0; end = $null
        enter = [ordered]@{ type = 'none'; duration = 0.5 }
        exit = [ordered]@{ type = 'none'; duration = 0.5 }
        motion = $null; states = @(); triggers = @()
        variableId = $null; multiline = $false; min = 0; max = 10; step = 1; correct = $false; choiceMode = 'radio'
        draggable = $false; dropTarget = $false; correctTargetId = $null
        autoplay = $false; controls = $true; loop = $false; captions = ''; locked = $false; groupId = $null; editorHidden = $false
    }
    if ($Over) { foreach ($key in @($Over.Keys)) { $obj[$key] = $Over[$key] } }
    return $obj
}

function New-ScrimLayer {
    param([string]$Name, [bool]$Base)
    $objects = New-Object System.Collections.Generic.List[object]
    return [ordered]@{
        id = (New-FleetId 'l'); name = $Name; base = $Base; hideOthers = $true; modal = $false
        objects = $objects.ToArray(); triggers = @()
    }
}

function New-ScrimSlide {
    param([string]$Title)
    $layer = New-ScrimLayer 'Base layer' $true
    $layers = New-Object System.Collections.Generic.List[object]
    [void]$layers.Add($layer)
    return [ordered]@{
        id = (New-FleetId 's'); title = $Title; notes = ''; background = '#ffffff'; duration = 5; advance = 'user'
        layers = $layers.ToArray(); triggers = @(); question = $null; inMenu = $true; useMaster = $true
    }
}

function New-ScrimCourse {
    param([string]$Title)
    $now = [DateTime]::UtcNow.ToString('o')
    $slide = New-ScrimSlide 'Title slide'
    $titleObj = New-ScrimObject 'text' @{ name = 'Title'; x = 80; y = 190; w = 800; h = 80; text = $Title; style = (New-ScrimStyle @{ fontSize = 44; fontWeight = 600; align = 'center' }) }
    $subObj = New-ScrimObject 'text' @{ name = 'Subtitle'; x = 80; y = 280; w = 800; h = 50; text = 'Add a subtitle'; style = (New-ScrimStyle @{ fontSize = 22; color = '#52514e'; align = 'center' }) }
    $objs = New-Object System.Collections.Generic.List[object]
    [void]$objs.Add($titleObj); [void]$objs.Add($subObj)
    $slide.layers[0].objects = $objs.ToArray()
    $slides = New-Object System.Collections.Generic.List[object]
    [void]$slides.Add($slide)
    $scene = [ordered]@{ id = (New-FleetId 'sc'); name = 'Scene 1'; slides = $slides.ToArray(); bank = $null }
    $scenes = New-Object System.Collections.Generic.List[object]
    [void]$scenes.Add($scene)
    $master = New-ScrimSlide 'Slide master'
    $master.id = (New-FleetId 'master')
    $master.background = 'transparent'
    $master.inMenu = $false
    $master.useMaster = $false
    $palette = @('#ffffff', '#1a1a19', '#2f74c8', '#e8c15a', '#287a4c', '#c93b3b', '#b38ae6', '#f08a3c', '#9a988f', '#f4f4f2')
    return [ordered]@{
        schema = 1; id = (New-FleetId 'c'); title = $Title; author = ''; description = ''
        size = [ordered]@{ w = 960; h = 540 }
        scenes = $scenes.ToArray()
        master = $master
        variables = @(); theme = $palette; startSlideId = $null
        player = [ordered]@{
            showMenu = $true; showNav = $true; showSeekbar = $true; showTitle = $true; showNotes = $false
            resources = @(); glossary = @(); logo = ''; accent = ''; navigation = 'free'; resume = $true
        }
        quiz = [ordered]@{ passPercent = 80; reporting = 'passed-failed'; completionSlideId = $null }
        assets = [ordered]@{}
        created = $now; modified = $now
    }
}

function ConvertTo-ScrimText {
    param($Course)
    $doc = [ordered]@{ format = 'scrimshaw'; version = 1; course = $Course }
    return (ConvertTo-FleetJson $doc)
}

function Read-ScrimText {
    param([string]$Text)
    if ($Text.Length -gt 0 -and [int][char]$Text[0] -eq 0xFEFF) { $Text = $Text.Substring(1) }
    try { $doc = ConvertFrom-Json $Text } catch { return @{ Ok = $false; Message = 'The file is not valid JSON.' } }
    $course = $doc
    if ($null -ne (Get-FleetProp $doc 'course')) { $course = Get-FleetProp $doc 'course' }
    $scenes = Get-ListProp $course 'scenes'
    if ($scenes.Count -eq 0) { return @{ Ok = $false; Message = 'This file is not a Scrimshaw course.' } }
    return @{ Ok = $true; Course = $course; Document = $doc }
}

function Read-ScrimArgument {
    param($Arguments)
    $inline = Get-FleetProp $Arguments 'scrim'
    if ($inline) {
        $loaded = Read-ScrimText ([string]$inline)
        if (-not $loaded.Ok) { Throw-Fleet 'E_ARGS' ([string]$loaded.Message) }
        return $loaded
    }
    $path = Get-FleetProp $Arguments 'course'
    if (-not $path) { Throw-Fleet 'E_ARGS' 'Missing argument course.' }
    if (-not (Test-Path -LiteralPath $path)) { Throw-Fleet 'E_NOT_FOUND' "File not found: $path" }
    $loaded = Read-ScrimText ([IO.File]::ReadAllText($path))
    if (-not $loaded.Ok) { Throw-Fleet 'E_ARGS' ([string]$loaded.Message) }
    return $loaded
}

function Save-ScrimResult {
    param($Course, $Arguments, [hashtable]$Extra)
    $text = ConvertTo-ScrimText $Course
    $data = @{}
    if ($Extra) { foreach ($key in @($Extra.Keys)) { $data[$key] = $Extra[$key] } }
    $dest = Get-FleetProp $Arguments 'dest'
    if (-not $dest) { Throw-Fleet 'E_ARGS' 'Missing argument dest.' }
    $written = Write-FleetFile -Path ([string]$dest) -Text $text -Yes (Test-ReplaceArg $Arguments)
    if (-not $written.Ok) { Throw-Fleet 'E_ARGS' ([string]$written.Message) }
    foreach ($key in @($written.Keys)) { if ($key -ne 'Ok') { $data[$key] = $written[$key] } }
    return $data
}

function Get-CourseSlides {
    param($Course, [bool]$IncludeMaster)
    $slides = New-Object System.Collections.Generic.List[object]
    foreach ($scene in (Get-ListProp $Course 'scenes')) {
        foreach ($slide in (Get-ListProp $scene 'slides')) { [void]$slides.Add($slide) }
    }
    if ($IncludeMaster) {
        $master = Get-FleetProp $Course 'master'
        if ($master) { [void]$slides.Add($master) }
    }
    return $slides.ToArray()
}

function Get-SlideObjects {
    param($Slide)
    $objects = New-Object System.Collections.Generic.List[object]
    foreach ($layer in (Get-ListProp $Slide 'layers')) {
        foreach ($obj in (Get-ListProp $layer 'objects')) { [void]$objects.Add($obj) }
    }
    return $objects.ToArray()
}

function Find-SlideObject {
    param($Slide, [string]$Id)
    if (-not $Id -or $Id -eq 'this') { return $true }
    foreach ($obj in (Get-SlideObjects $Slide)) {
        if ([string](Get-FleetProp $obj 'id') -eq $Id) { return $true }
    }
    return $false
}

function Find-SlideLayer {
    param($Slide, [string]$Id)
    foreach ($layer in (Get-ListProp $Slide 'layers')) {
        if ([string](Get-FleetProp $layer 'id') -eq $Id) { return $true }
    }
    return $false
}

function Get-TriggerProblems {
    param($Course, $Slide, $Trigger, [string]$Where)
    $problems = New-Object System.Collections.Generic.List[string]
    $title = [string](Get-FleetProp $Slide 'title')
    $action = Get-FleetProp $Trigger 'action'
    $event = Get-FleetProp $Trigger 'event'
    if ($null -eq $action) { return $problems }
    $type = [string](Get-FleetProp $action 'type')
    $slides = @(Get-CourseSlides $Course $false)
    $slideIds = @{}
    foreach ($s in $slides) { $slideIds[[string](Get-FleetProp $s 'id')] = $true }
    $sceneIds = @{}
    foreach ($scene in (Get-ListProp $Course 'scenes')) { $sceneIds[[string](Get-FleetProp $scene 'id')] = $true }
    $varIds = @{}
    foreach ($var in (Get-ListProp $Course 'variables')) { $varIds[[string](Get-FleetProp $var 'id')] = $true }
    $missing = {
        param($What)
        [void]$problems.Add("$title - ${Where}: the trigger '$type' points at a $What that no longer exists.")
    }
    if (($type -eq 'jump-slide' -or $type -eq 'lightbox-slide') -and -not $slideIds.ContainsKey([string](Get-FleetProp $action 'slideId'))) { & $missing 'slide' }
    if ($type -eq 'jump-scene' -and -not $sceneIds.ContainsKey([string](Get-FleetProp $action 'sceneId'))) { & $missing 'scene' }
    $layerId = [string](Get-FleetProp $action 'layerId')
    if (($type -eq 'show-layer' -or ($type -eq 'hide-layer' -and $layerId -ne 'this')) -and -not (Find-SlideLayer $Slide $layerId)) { & $missing 'layer' }
    $objectId = [string](Get-FleetProp $action 'objectId')
    if (($type -eq 'set-state' -or $type -eq 'play-media' -or $type -eq 'pause-media') -and $objectId -ne 'this' -and -not (Find-SlideObject $Slide $objectId)) { & $missing 'object' }
    if ($type -eq 'adjust-variable' -and -not $varIds.ContainsKey([string](Get-FleetProp $action 'variableId'))) { & $missing 'variable' }
    if ($event -and [string](Get-FleetProp $event 'type') -eq 'variable-change' -and -not $varIds.ContainsKey([string](Get-FleetProp $event 'variableId'))) {
        [void]$problems.Add("$title - ${Where}: a trigger waits for a variable that no longer exists.")
    }
    return $problems
}

function Get-CourseProblems {
    param($Course)
    $problems = New-Object System.Collections.Generic.List[string]
    foreach ($slide in (Get-CourseSlides $Course $false)) {
        $title = [string](Get-FleetProp $slide 'title')
        foreach ($trigger in (Get-ListProp $slide 'triggers')) {
            foreach ($p in (Get-TriggerProblems $Course $slide $trigger 'slide trigger')) { [void]$problems.Add($p) }
        }
        foreach ($layer in (Get-ListProp $slide 'layers')) {
            $layerName = [string](Get-FleetProp $layer 'name')
            foreach ($trigger in (Get-ListProp $layer 'triggers')) {
                foreach ($p in (Get-TriggerProblems $Course $slide $trigger "layer $layerName")) { [void]$problems.Add($p) }
            }
            foreach ($obj in (Get-ListProp $layer 'objects')) {
                $objName = [string](Get-FleetProp $obj 'name')
                foreach ($trigger in (Get-ListProp $obj 'triggers')) {
                    foreach ($p in (Get-TriggerProblems $Course $slide $trigger $objName)) { [void]$problems.Add($p) }
                }
                $kind = [string](Get-FleetProp $obj 'kind')
                $decorative = [bool](Get-FleetProp $obj 'decorative')
                $alt = [string](Get-FleetProp $obj 'alt')
                if ($kind -eq 'image' -and -not $decorative -and -not $alt.Trim()) {
                    [void]$problems.Add("${title} - ${objName}: add alt text or mark the image decorative.")
                }
                $src = [string](Get-FleetProp $obj 'src')
                $captions = [string](Get-FleetProp $obj 'captions')
                if (($kind -eq 'video' -or $kind -eq 'audio') -and $src -and -not $captions -and -not $decorative) {
                    [void]$problems.Add("${title} - ${objName}: add captions, or mark it decorative if it has no speech.")
                }
            }
        }
        $question = Get-FleetProp $slide 'question'
        if ($question) {
            $qKind = [string](Get-FleetProp $question 'kind')
            $graded = Get-FleetProp $question 'graded'
            $gradedOn = ($null -eq $graded -or [bool]$graded)
            if ($gradedOn -and @('multiple-choice', 'multiple-response', 'true-false', 'hotspot') -contains $qKind) {
                $answerKind = $(if ($qKind -eq 'hotspot') { 'hotspot' } else { 'choice' })
                $marked = $false
                foreach ($obj in (Get-SlideObjects $slide)) {
                    if ([string](Get-FleetProp $obj 'kind') -eq $answerKind -and [bool](Get-FleetProp $obj 'correct')) { $marked = $true }
                }
                if (-not $marked) { [void]$problems.Add("${title}: the question has no correct answer marked.") }
            }
            $inputId = [string](Get-FleetProp $question 'inputObjectId')
            if (@('essay', 'numeric', 'fill-in') -contains $qKind -and -not (Find-SlideObject $slide $inputId)) {
                [void]$problems.Add("${title}: the $qKind question has no text entry box linked.")
            }
            if ($qKind -eq 'fill-in') {
                $accepted = Get-ListProp $question 'accepted'
                $any = $false
                foreach ($a in $accepted) { if (([string]$a).Trim()) { $any = $true } }
                if (-not $any) { [void]$problems.Add("${title}: the fill-in question has no accepted answers.") }
            }
        }
    }
    return $problems.ToArray()
}

function Get-TextRows {
    param($Course)
    $rows = New-Object System.Collections.Generic.List[object]
    [void]$rows.Add(@{ key = 'course:title'; text = [string](Get-FleetProp $Course 'title') })
    $slides = @(Get-CourseSlides $Course $false)
    $master = Get-FleetProp $Course 'master'
    $ordered = New-Object System.Collections.Generic.List[object]
    foreach ($slide in $slides) { [void]$ordered.Add($slide) }
    if ($master) { [void]$ordered.Add($master) }
    $index = 0
    foreach ($slide in $ordered) {
        $isMaster = ($master -and $index -eq ($ordered.Count - 1) -and [string](Get-FleetProp $slide 'id') -eq [string](Get-FleetProp $master 'id'))
        $slideId = [string](Get-FleetProp $slide 'id')
        if (-not $isMaster) {
            [void]$rows.Add(@{ key = "slide:${slideId}:title"; text = [string](Get-FleetProp $slide 'title') })
        }
        foreach ($obj in (Get-SlideObjects $slide)) {
            $oid = [string](Get-FleetProp $obj 'id')
            $text = [string](Get-FleetProp $obj 'text')
            $alt = [string](Get-FleetProp $obj 'alt')
            if ($text) { [void]$rows.Add(@{ key = "obj:${oid}:text"; text = $text }) }
            if ($alt) { [void]$rows.Add(@{ key = "obj:${oid}:alt"; text = $alt }) }
            foreach ($state in (Get-ListProp $obj 'states')) {
                $stText = Get-FleetProp $state 'text'
                if ($stText) { [void]$rows.Add(@{ key = ("state:{0}:{1}" -f $oid, [string](Get-FleetProp $state 'id')); text = [string]$stText }) }
            }
        }
        if (-not $isMaster) {
            $question = Get-FleetProp $slide 'question'
            if ($question) {
                $j = 0
                foreach ($answer in (Get-ListProp $question 'accepted')) {
                    if (([string]$answer).Trim()) { [void]$rows.Add(@{ key = "answer:${slideId}:$j"; text = [string]$answer }) }
                    $j++
                }
            }
        }
        $index++
    }
    return $rows.ToArray()
}

function Set-TextKey {
    param($Course, [string]$Key, [string]$Value)
    if ($Key -eq 'course:title') { Set-FleetProp $Course 'title' $Value; return $true }
    foreach ($slide in (Get-CourseSlides $Course $true)) {
        $slideId = [string](Get-FleetProp $slide 'id')
        if ($Key -eq "slide:${slideId}:title") { Set-FleetProp $slide 'title' $Value; return $true }
        foreach ($obj in (Get-SlideObjects $slide)) {
            $oid = [string](Get-FleetProp $obj 'id')
            if ($Key -eq "obj:${oid}:text") { Set-FleetProp $obj 'text' $Value; return $true }
            if ($Key -eq "obj:${oid}:alt") { Set-FleetProp $obj 'alt' $Value; return $true }
            foreach ($state in (Get-ListProp $obj 'states')) {
                $stateKey = "state:{0}:{1}" -f $oid, [string](Get-FleetProp $state 'id')
                if ($Key -eq $stateKey) { Set-FleetProp $state 'text' $Value; return $true }
            }
        }
        $question = Get-FleetProp $slide 'question'
        if ($question) {
            $accepted = Get-ListProp $question 'accepted'
            for ($j = 0; $j -lt $accepted.Count; $j++) {
                if ($Key -eq "answer:${slideId}:$j") {
                    $accepted[$j] = $Value
                    Set-FleetProp $question 'accepted' $accepted
                    return $true
                }
            }
        }
    }
    return $false
}

function ConvertTo-CsvCell {
    param([string]$Value)
    if ($Value -match '[",\r\n]' -or $Value -match '^\s' -or $Value -match '\s$') { return '"' + ($Value.Replace('"', '""')) + '"' }
    return $Value
}

function ConvertFrom-CsvText {
    param([string]$Text)
    if ($Text.Length -gt 0 -and [int][char]$Text[0] -eq 0xFEFF) { $Text = $Text.Substring(1) }
    $rows = New-Object System.Collections.Generic.List[object]
    $row = New-Object System.Collections.Generic.List[string]
    $cur = New-Object System.Text.StringBuilder
    $quoted = $false
    for ($i = 0; $i -lt $Text.Length; $i++) {
        $ch = $Text[$i]
        if ($quoted) {
            if ($ch -eq '"') {
                if (($i + 1) -lt $Text.Length -and $Text[$i + 1] -eq '"') { [void]$cur.Append('"'); $i++ }
                else { $quoted = $false }
            } else { [void]$cur.Append($ch) }
        } elseif ($ch -eq '"' -and $cur.Length -eq 0) { $quoted = $true }
        elseif ($ch -eq ',') { [void]$row.Add($cur.ToString()); [void]$cur.Clear() }
        elseif ($ch -eq "`n" -or $ch -eq "`r") {
            if ($ch -eq "`r" -and ($i + 1) -lt $Text.Length -and $Text[$i + 1] -eq "`n") { $i++ }
            [void]$row.Add($cur.ToString()); [void]$cur.Clear()
            if ($row.Count -gt 1 -or ($row.Count -eq 1 -and $row[0] -ne '')) { [void]$rows.Add($row.ToArray()) }
            $row = New-Object System.Collections.Generic.List[string]
        } else { [void]$cur.Append($ch) }
    }
    if ($cur.Length -gt 0 -or $row.Count -gt 0) { [void]$row.Add($cur.ToString()); [void]$rows.Add($row.ToArray()) }
    return $rows.ToArray()
}

function Get-BoolArg {
    param($Arguments, [string]$Name)
    $value = Get-FleetProp $Arguments $Name
    if ($null -eq $value) { return $null }
    return [bool]$value
}

function Update-CourseSettings {
    param($Course, $Arguments)
    $title = Get-FleetProp $Arguments 'title'
    if ($title) { Set-FleetProp $Course 'title' ([string]$title) }
    $description = Get-FleetProp $Arguments 'description'
    if ($null -ne $description) { Set-FleetProp $Course 'description' ([string]$description) }
    $author = Get-FleetProp $Arguments 'author'
    if ($null -ne $author) { Set-FleetProp $Course 'author' ([string]$author) }
    $player = Get-FleetProp $Course 'player'
    if ($null -eq $player) { $player = [ordered]@{}; Set-FleetProp $Course 'player' $player }
    $navigation = Get-FleetProp $Arguments 'navigation'
    if ($navigation) { Set-FleetProp $player 'navigation' ([string]$navigation) }
    foreach ($name in @('showMenu', 'showNav', 'showSeekbar', 'showTitle', 'showNotes', 'resume')) {
        $flag = Get-BoolArg $Arguments $name
        if ($null -ne $flag) { Set-FleetProp $player $name $flag }
    }
    $quiz = Get-FleetProp $Course 'quiz'
    if ($null -eq $quiz) { $quiz = [ordered]@{}; Set-FleetProp $Course 'quiz' $quiz }
    $pass = Get-FleetProp $Arguments 'passPercent'
    if ($null -ne $pass) { Set-FleetProp $quiz 'passPercent' ([int]$pass) }
    Set-FleetProp $Course 'modified' ([DateTime]::UtcNow.ToString('o'))
}

function Get-AssetMap {
    param($Course)
    $assets = Get-FleetProp $Course 'assets'
    if ($null -eq $assets) { $assets = [ordered]@{}; Set-FleetProp $Course 'assets' $assets }
    return $assets
}

function Add-CourseAsset {
    param($Course, [string]$Name, [string]$Mime, [string]$DataUrl)
    $id = New-FleetId 'a'
    $asset = [ordered]@{ id = $id; name = $Name; mime = $Mime; data = $DataUrl }
    $assets = Get-AssetMap $Course
    Set-FleetProp $assets $id $asset
    return $id
}

function ConvertTo-DataUrl {
    param([byte[]]$Bytes, [string]$Mime)
    return ('data:{0};base64,{1}' -f $Mime, [Convert]::ToBase64String($Bytes))
}

function Read-Ascii {
    param([byte[]]$Bytes, [int]$At, [int]$Count)
    if ($At -lt 0 -or $Count -lt 0 -or ($At + $Count) -gt $Bytes.Length) { return '' }
    $chars = New-Object char[] $Count
    for ($i = 0; $i -lt $Count; $i++) { $chars[$i] = [char]$Bytes[$At + $i] }
    return -join $chars
}

function Read-U32BE {
    param([byte[]]$Bytes, [int]$At)
    return (([int]$Bytes[$At] -shl 24) -bor ([int]$Bytes[$At + 1] -shl 16) -bor ([int]$Bytes[$At + 2] -shl 8) -bor [int]$Bytes[$At + 3])
}

function Read-U32LE {
    param([byte[]]$Bytes, [int]$At)
    return ([int]$Bytes[$At] -bor ([int]$Bytes[$At + 1] -shl 8) -bor ([int]$Bytes[$At + 2] -shl 16) -bor ([int]$Bytes[$At + 3] -shl 24))
}

function Read-U16LE {
    param([byte[]]$Bytes, [int]$At)
    return ([int]$Bytes[$At] -bor ([int]$Bytes[$At + 1] -shl 8))
}

function Test-Mp4Bytes {
    param([string]$Name, [byte[]]$Bytes)
    if ($Bytes.Length -lt 16 -or (Read-Ascii $Bytes 4 4) -ne 'ftyp') { return "Not an MP4 file (no ftyp header): $Name" }
    $size = Read-U32BE $Bytes 0
    if ($size -lt 16 -or $size -gt $Bytes.Length) { return "Damaged MP4 header: $Name" }
    $brands = @((Read-Ascii $Bytes 8 4))
    for ($i = 16; $i + 4 -le $size; $i += 4) { $brands += (Read-Ascii $Bytes $i 4) }
    $known = @('isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ')
    $ok = $false
    foreach ($brand in $brands) { if ($known -contains $brand) { $ok = $true } }
    if (-not $ok) { return "Not a web-playable MP4: $Name" }
    return $null
}

function Test-PngBytes {
    param([string]$Name, [byte[]]$Bytes)
    $sig = @(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    if ($Bytes.Length -lt 33) { return "Not a PNG image: $Name" }
    for ($i = 0; $i -lt $sig.Count; $i++) { if ($Bytes[$i] -ne $sig[$i]) { return "Not a PNG image: $Name" } }
    if ((Read-Ascii $Bytes 12 4) -ne 'IHDR' -or (Read-U32BE $Bytes 8) -ne 13) { return "Damaged PNG header: $Name" }
    $width = [uint32](Read-U32BE $Bytes 16)
    $height = [uint32](Read-U32BE $Bytes 20)
    if ($width -lt 1 -or $height -lt 1 -or $width -gt 16384 -or $height -gt 16384) { return "Unusable image size: $Name" }
    return @{ width = [int]$width; height = [int]$height }
}

function Test-WavBytes {
    param([string]$Name, [byte[]]$Bytes)
    if ($Bytes.Length -lt 44 -or (Read-Ascii $Bytes 0 4) -ne 'RIFF' -or (Read-Ascii $Bytes 8 4) -ne 'WAVE') { return "Not a WAV file: $Name" }
    $fmt = $null
    $dataBytes = -1
    $at = 12
    while ($at + 8 -le $Bytes.Length) {
        $id = Read-Ascii $Bytes $at 4
        $len = [uint32](Read-U32LE $Bytes ($at + 4))
        if ($id -eq 'fmt ' -and $len -ge 16 -and ($at + 24) -le $Bytes.Length) {
            $fmt = @{
                tag = (Read-U16LE $Bytes ($at + 8)); channels = (Read-U16LE $Bytes ($at + 10))
                rate = [uint32](Read-U32LE $Bytes ($at + 12)); byteRate = [uint32](Read-U32LE $Bytes ($at + 16)); bits = (Read-U16LE $Bytes ($at + 22))
            }
        } elseif ($id -eq 'data') {
            $remain = $Bytes.Length - ($at + 8)
            if ([int64]$len -lt $remain) { $dataBytes = [int]$len } else { $dataBytes = $remain }
            break
        }
        $at += 8 + [int]$len + ([int]$len -band 1)
    }
    if ($null -eq $fmt) { return "WAV has no fmt chunk: $Name" }
    if (@(1, 3, 0xfffe) -notcontains [int]$fmt.tag) { return "Compressed WAV is not supported: $Name" }
    if ($dataBytes -le 0) { return "WAV has no audio data: $Name" }
    $seconds = [math]::Round(($dataBytes / [double]$fmt.byteRate), 3)
    return @{ seconds = $seconds }
}

function Get-VttCueCount {
    param([string]$Text)
    if ($Text -notmatch '^(?s)\s*WEBVTT') { return -1 }
    $n = 0
    foreach ($line in ($Text -split '\r?\n')) { if ($line -match '-->') { $n++ } }
    return $n
}

function Get-MediaLabel {
    param([string]$Name)
    $label = [IO.Path]::GetFileName($Name)
    $label = [regex]::Replace($label, '\.[^.]+$', '')
    $label = $label -replace '\.png$', ''
    $label = $label -replace '[-_]+', ' '
    $label = $label.Trim()
    if ($label.Length -gt 60) { $label = $label.Substring(0, 60) }
    if (-not $label) { $label = 'Imported media' }
    return $label
}

function Get-MediaStem {
    param([string]$Name)
    $stem = [IO.Path]::GetFileName($Name)
    $stem = [regex]::Replace($stem, '\.[^.]+$', '')
    $stem = [regex]::Replace($stem, '(?i)[\s._-]*(captions?|subtitles?|chapters?)$', '')
    return $stem.Trim().ToLowerInvariant()
}

function Add-ImportedScene {
    param($Course, $Plan)
    $slides = New-Object System.Collections.Generic.List[object]
    foreach ($video in @($Plan.Videos)) {
        $label = Get-MediaLabel $video.Name
        $slide = New-ScrimSlide $label
        $videoId = Add-CourseAsset $Course $video.Name $video.Mime $video.DataUrl
        $captions = ''
        if ($video.CaptionsData) {
            $capId = Add-CourseAsset $Course $video.CaptionsName 'text/vtt' $video.CaptionsData
            $captions = "asset:$capId"
        }
        $obj = New-ScrimObject 'video' @{
            name = $label; x = 60; y = 30; w = 840; h = 472; src = "asset:$videoId"; captions = $captions; alt = $label
        }
        $objs = New-Object System.Collections.Generic.List[object]
        [void]$objs.Add($obj)
        $slide.layers[0].objects = $objs.ToArray()
        if ($video.ChapterNotes) { $slide.notes = $video.ChapterNotes }
        [void]$slides.Add($slide)
    }
    foreach ($image in @($Plan.Images)) {
        $label = Get-MediaLabel $image.Name
        $slide = New-ScrimSlide $label
        $imageId = Add-CourseAsset $Course $image.Name 'image/png' $image.DataUrl
        $k = 1.0
        $fitW = 840.0 / [double]$image.Width
        $fitH = 440.0 / [double]$image.Height
        if ($fitW -lt $k) { $k = $fitW }
        if ($fitH -lt $k) { $k = $fitH }
        $w = [int][math]::Round($image.Width * $k)
        $h = [int][math]::Round($image.Height * $k)
        $alt = [string]$image.Alt
        $obj = New-ScrimObject 'image' @{
            name = $label; x = [int][math]::Round((960 - $w) / 2); y = 60 + [int][math]::Round((440 - $h) / 2)
            w = $w; h = $h; alt = $alt; src = "asset:$imageId"
        }
        $objs = New-Object System.Collections.Generic.List[object]
        [void]$objs.Add($obj)
        $slide.layers[0].objects = $objs.ToArray()
        $notes = ''
        if ($image.Ocr) { $notes = "Text in the screenshot: $($image.Ocr)" }
        if ($image.Tags) { if ($notes) { $notes += "`n" }; $notes += "Tags: $($image.Tags)" }
        if ($notes) { $slide.notes = $notes }
        [void]$slides.Add($slide)
    }
    foreach ($audio in @($Plan.Audio)) {
        $label = Get-MediaLabel $audio.Name
        $slide = New-ScrimSlide $label
        $seconds = [double]$audio.Seconds
        if ($seconds -lt 1) { $seconds = 1 }
        $slide.duration = [int][math]::Ceiling($seconds)
        $audioId = Add-CourseAsset $Course $audio.Name 'audio/wav' $audio.DataUrl
        $titleObj = New-ScrimObject 'text' @{ name = 'Title'; x = 60; y = 40; w = 840; h = 80; text = $label; style = (New-ScrimStyle @{ fontSize = 30; fontWeight = 600 }) }
        $audioObj = New-ScrimObject 'audio' @{ name = $label; src = "asset:$audioId"; controls = $true; autoplay = $true; alt = $label }
        $objs = New-Object System.Collections.Generic.List[object]
        [void]$objs.Add($titleObj); [void]$objs.Add($audioObj)
        $slide.layers[0].objects = $objs.ToArray()
        [void]$slides.Add($slide)
    }
    if ($slides.Count -eq 0) { return 0 }
    $scene = [ordered]@{ id = (New-FleetId 'sc'); name = 'Imported media'; slides = $slides.ToArray(); bank = $null }
    $scenes = New-Object System.Collections.Generic.List[object]
    foreach ($existing in (Get-ListProp $Course 'scenes')) { [void]$scenes.Add($existing) }
    [void]$scenes.Add($scene)
    Set-FleetProp $Course 'scenes' $scenes.ToArray()
    Set-FleetProp $Course 'modified' ([DateTime]::UtcNow.ToString('o'))
    return $slides.Count
}

function Resolve-MediaItem {
    param($Item)
    if ($Item -is [string]) {
        if (-not (Test-Path -LiteralPath $Item)) { return @{ Ok = $false; Name = $Item; Reason = "File not found: $Item" } }
        $bytes = [IO.File]::ReadAllBytes($Item)
        return @{ Ok = $true; Name = [IO.Path]::GetFileName($Item); Bytes = $bytes }
    }
    $name = [string](Get-FleetProp $Item 'name')
    $b64 = [string](Get-FleetProp $Item 'base64')
    if (-not $name -or -not $b64) { return @{ Ok = $false; Name = $name; Reason = 'A media item needs name and base64, or a file path.' } }
    try { $bytes = [Convert]::FromBase64String($b64) } catch { return @{ Ok = $false; Name = $name; Reason = "Could not read base64 for $name." } }
    return @{ Ok = $true; Name = $name; Bytes = $bytes }
}

function Build-MediaPlan {
    param($Items)
    $videos = New-Object System.Collections.Generic.List[object]
    $images = New-Object System.Collections.Generic.List[object]
    $audio = New-Object System.Collections.Generic.List[object]
    $captions = New-Object System.Collections.Generic.List[object]
    $metas = @{}
    $rejected = New-Object System.Collections.Generic.List[string]
    $warnings = New-Object System.Collections.Generic.List[string]
    foreach ($item in @($Items)) {
        $file = Resolve-MediaItem $item
        if (-not $file.Ok) { [void]$rejected.Add($file.Reason); continue }
        $name = [string]$file.Name
        $bytes = $file.Bytes
        if ($bytes.Length -eq 0) { [void]$rejected.Add("$name is empty."); continue }
        if ($bytes.Length -gt $script:MaxMediaBytes) { [void]$rejected.Add("$name is larger than 25 MB."); continue }
        $lower = $name.ToLowerInvariant()
        if ($lower.EndsWith('.png.meta.json')) {
            $text = [Text.Encoding]::UTF8.GetString($bytes)
            try { $meta = ConvertFrom-Json $text } catch { [void]$rejected.Add("$name is not valid JSON."); continue }
            $note = [string](Get-FleetProp $meta 'note')
            $ocr = [string](Get-FleetProp $meta 'ocr')
            $tags = Get-ListProp $meta 'tags'
            $key = $lower.Substring(0, $lower.Length - '.meta.json'.Length)
            $metas[$key] = @{ note = $note; ocr = $ocr; tags = ($tags -join ', ') }
            continue
        }
        $ext = [IO.Path]::GetExtension($name).ToLowerInvariant()
        if ($ext -eq '.mp4' -or $ext -eq '.m4v') {
            $err = Test-Mp4Bytes $name $bytes
            if ($err) { [void]$rejected.Add($err); continue }
            [void]$videos.Add(@{ Name = $name; Mime = 'video/mp4'; Bytes = $bytes; DataUrl = (ConvertTo-DataUrl $bytes 'video/mp4'); CaptionsData = $null; CaptionsName = ''; ChapterNotes = '' })
        } elseif ($ext -eq '.png') {
            $png = Test-PngBytes $name $bytes
            if ($png -is [string]) { [void]$rejected.Add($png); continue }
            [void]$images.Add(@{ Name = $name; Width = $png.width; Height = $png.height; DataUrl = (ConvertTo-DataUrl $bytes 'image/png'); Alt = ''; Ocr = ''; Tags = '' })
        } elseif ($ext -eq '.wav') {
            $wav = Test-WavBytes $name $bytes
            if ($wav -is [string]) { [void]$rejected.Add($wav); continue }
            [void]$audio.Add(@{ Name = $name; Seconds = $wav.seconds; DataUrl = (ConvertTo-DataUrl $bytes 'audio/wav') })
        } elseif ($ext -eq '.vtt' -or $ext -eq '.txt') {
            $text = [Text.Encoding]::UTF8.GetString($bytes)
            if ($ext -eq '.vtt') {
                $cues = Get-VttCueCount $text
                if ($cues -lt 0) { [void]$rejected.Add("$name does not start with WEBVTT."); continue }
                if ($cues -eq 0) { [void]$rejected.Add("$name has no cues."); continue }
                $data = ConvertTo-DataUrl ([Text.Encoding]::UTF8.GetBytes($text)) 'text/vtt'
                [void]$captions.Add(@{ Name = $name; DataUrl = $data })
            } else { [void]$rejected.Add("$name is not a media type Scrimshaw imports (MP4, PNG, WAV, WebVTT)."); continue }
        } else { [void]$rejected.Add("$name is not a media type Scrimshaw imports (MP4, PNG, WAV, WebVTT).") }
    }
    foreach ($cap in $captions) {
        $stem = Get-MediaStem $cap.Name
        $target = $null
        foreach ($video in $videos) {
            if (-not $video.CaptionsData -and (Get-MediaStem $video.Name) -eq $stem) { $target = $video; break }
        }
        if ($null -eq $target -and $videos.Count -eq 1 -and -not $videos[0].CaptionsData) { $target = $videos[0] }
        if ($null -eq $target) { [void]$warnings.Add("Captions '$($cap.Name)' have no matching video and were skipped."); continue }
        $target.CaptionsData = $cap.DataUrl
        $target.CaptionsName = $cap.Name
    }
    foreach ($image in $images) {
        $key = $image.Name.ToLowerInvariant()
        if ($metas.ContainsKey($key)) {
            $meta = $metas[$key]
            if ($meta.note) { $image.Alt = $meta.note } 
            $image.Ocr = $meta.ocr
            $image.Tags = $meta.tags
            [void]$metas.Remove($key)
        }
    }
    foreach ($key in @($metas.Keys)) { [void]$warnings.Add("Metadata for '$key' has no matching PNG and was skipped.") }
    return @{ Videos = $videos.ToArray(); Images = $images.ToArray(); Audio = $audio.ToArray(); Rejected = $rejected.ToArray(); Warnings = $warnings.ToArray() }
}

function Get-PrunedAssets {
    param($Course)
    $used = @{}
    $slides = New-Object System.Collections.Generic.List[object]
    foreach ($slide in (Get-CourseSlides $Course $false)) { [void]$slides.Add($slide) }
    $master = Get-FleetProp $Course 'master'
    if ($master) { [void]$slides.Add($master) }
    foreach ($slide in $slides) {
        $bg = [string](Get-FleetProp $slide 'background')
        if ($bg.StartsWith('asset:')) { $used[$bg.Substring(6)] = $true }
        foreach ($obj in (Get-SlideObjects $slide)) {
            foreach ($field in @('src', 'captions')) {
                $ref = [string](Get-FleetProp $obj $field)
                if ($ref.StartsWith('asset:')) { $used[$ref.Substring(6)] = $true }
            }
        }
    }
    $player = Get-FleetProp $Course 'player'
    if ($player) {
        $logo = [string](Get-FleetProp $player 'logo')
        if ($logo.StartsWith('asset:')) { $used[$logo.Substring(6)] = $true }
    }
    $kept = [ordered]@{}
    $assets = Get-FleetProp $Course 'assets'
    if ($assets) {
        if ($assets -is [System.Collections.IDictionary]) {
            foreach ($key in @($assets.Keys)) { if ($used.ContainsKey([string]$key)) { $kept[[string]$key] = $assets[$key] } }
        } else {
            foreach ($prop in $assets.PSObject.Properties) { if ($used.ContainsKey($prop.Name)) { $kept[$prop.Name] = $prop.Value } }
        }
    }
    return $kept
}

function ConvertTo-ScriptSafeJson {
    param($Value)
    $json = ConvertTo-FleetJson $Value
    $json = $json.Replace('<', '\u003c').Replace('>', '\u003e').Replace('&', '\u0026')
    $json = $json.Replace([string][char]0x2028, '\u2028').Replace([string][char]0x2029, '\u2029')
    return $json
}

function Escape-XmlText {
    param([string]$Text)
    if ($null -eq $Text) { return '' }
    return $Text.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace("'", '&apos;').Replace('"', '&quot;')
}

function Get-ScormId {
    param([string]$Text)
    $id = [regex]::Replace($Text, '[^A-Za-z0-9._-]', '_')
    if ($id -notmatch '^[A-Za-z_]') { $id = "_$id" }
    return $id
}

function Test-CourseGraded {
    param($Course)
    $quiz = Get-FleetProp $Course 'quiz'
    $reporting = 'passed-failed'
    if ($quiz) {
        $value = Get-FleetProp $quiz 'reporting'
        if ($value) { $reporting = [string]$value }
    }
    if ($reporting -ne 'passed-failed') { return $false }
    foreach ($slide in (Get-CourseSlides $Course $false)) {
        $question = Get-FleetProp $slide 'question'
        if ($question) {
            $graded = Get-FleetProp $question 'graded'
            if ($null -eq $graded -or [bool]$graded) { return $true }
        }
    }
    return $false
}

function New-PlayerHtml {
    param($Course, [string]$Shell, [string]$Format)
    $packed = [ordered]@{}
    if ($Course -is [System.Collections.IDictionary]) {
        foreach ($key in @($Course.Keys)) { $packed[[string]$key] = $Course[$key] }
    } else {
        foreach ($prop in $Course.PSObject.Properties) { $packed[$prop.Name] = $prop.Value }
    }
    $packed['assets'] = Get-PrunedAssets $Course
    $title = [string](Get-FleetProp $Course 'title')
    $safeTitle = $title.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
    $tag = '<script id="scrimshaw-course" type="application/json">' + (ConvertTo-ScriptSafeJson $packed) + '</script>'
    $html = [regex]::Replace($Shell, '<title>[\s\S]*?</title>', ("<title>{0}</title>" -f $safeTitle), 1)
    $at = $html.IndexOf($script:EditorConnect)
    if ($at -ge 0) { $html = $html.Remove($at, $script:EditorConnect.Length).Insert($at, "connect-src 'none'") }
    $head = $html.IndexOf('</head>')
    if ($head -lt 0) { return $null }
    $html = $html.Insert($head, ($tag + "`n"))
    if ($Format -eq 'xapi' -or $Format -eq 'cmi5') {
        $none = $html.IndexOf("connect-src 'none'")
        if ($none -ge 0) { $html = $html.Remove($none, "connect-src 'none'".Length).Insert($none, 'connect-src https: http:') }
    }
    return $html
}

function New-PackageXml {
    param($Course, [string]$Format)
    $title = Escape-XmlText ([string](Get-FleetProp $Course 'title'))
    if (-not $title) { $title = 'Untitled course' }
    $id = Get-ScormId ("scrimshaw." + [string](Get-FleetProp $Course 'id'))
    $quiz = Get-FleetProp $Course 'quiz'
    $pass = 80
    if ($quiz -and $null -ne (Get-FleetProp $quiz 'passPercent')) { $pass = [int](Get-FleetProp $quiz 'passPercent') }
    $graded = Test-CourseGraded $Course
    $description = Escape-XmlText ([string](Get-FleetProp $Course 'description'))
    if (-not $description) { $description = $title }
    if ($Format -eq 'scorm12') {
        $mastery = ''
        if ($graded) { $mastery = "`n        <adlcp:masteryscore>$pass</adlcp:masteryscore>" }
        return @"
<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="$id" version="1"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="org_1">
    <organization identifier="org_1">
      <title>$title</title>
      <item identifier="item_1" identifierref="res_1">
        <title>$title</title>$mastery
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res_1" type="webcontent" adlcp:scormtype="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>
"@
    }
    if ($Format -eq 'scorm2004') {
        $objectives = ''
        if ($graded) {
            $measure = ([math]::Round($pass) / 100).ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)
            $objectives = @"

          <imsss:sequencing>
            <imsss:objectives>
              <imsss:primaryObjective objectiveID="primary" satisfiedByMeasure="true">
                <imsss:minNormalizedMeasure>$measure</imsss:minNormalizedMeasure>
              </imsss:primaryObjective>
            </imsss:objectives>
          </imsss:sequencing>
"@
        }
        return @"
<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="$id" version="1"
  xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3"
  xmlns:adlseq="http://www.adlnet.org/xsd/adlseq_v1p3"
  xmlns:adlnav="http://www.adlnet.org/xsd/adlnav_v1p3"
  xmlns:imsss="http://www.imsglobal.org/xsd/imsss"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 imscp_v1p1.xsd http://www.adlnet.org/xsd/adlcp_v1p3 adlcp_v1p3.xsd http://www.adlnet.org/xsd/adlseq_v1p3 adlseq_v1p3.xsd http://www.adlnet.org/xsd/adlnav_v1p3 adlnav_v1p3.xsd http://www.imsglobal.org/xsd/imsss imsss_v1p0.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>2004 3rd Edition</schemaversion>
  </metadata>
  <organizations default="org_1">
    <organization identifier="org_1">
      <title>$title</title>
      <item identifier="item_1" identifierref="res_1">
        <title>$title</title>$objectives
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="res_1" type="webcontent" adlcp:scormType="sco" href="index.html">
      <file href="index.html"/>
    </resource>
  </resources>
</manifest>
"@
    }
    $activity = Escape-XmlText ("urn:scrimshaw:course:" + [string](Get-FleetProp $Course 'id'))
    if ($Format -eq 'cmi5') {
        $move = $(if ($graded) { 'CompletedAndPassed' } else { 'Completed' })
        $mastery = ''
        if ($graded) {
            $score = ([math]::Round($pass) / 100).ToString('0.00', [Globalization.CultureInfo]::InvariantCulture)
            $mastery = " masteryScore=`"$score`""
        }
        return @"
<?xml version="1.0" encoding="utf-8"?>
<courseStructure xmlns="https://w3id.org/xapi/profiles/cmi5/v1/CourseStructure.xsd">
  <course id="$activity">
    <title><langstring lang="en-US">$title</langstring></title>
    <description><langstring lang="en-US">$description</langstring></description>
  </course>
  <au id="$activity/au" moveOn="$move"$mastery launchMethod="AnyWindow">
    <title><langstring lang="en-US">$title</langstring></title>
    <description><langstring lang="en-US">$description</langstring></description>
    <url>index.html</url>
  </au>
</courseStructure>
"@
    }
    return @"
<?xml version="1.0" encoding="utf-8"?>
<tincan xmlns="http://projecttincan.com/tincan.xsd">
  <activities>
    <activity id="$activity" type="http://adlnet.gov/expapi/activities/course">
      <name>$title</name>
      <description lang="en-US">$description</description>
      <launch lang="en-US">index.html</launch>
    </activity>
  </activities>
</tincan>
"@
}

function New-ZipBytes {
    param([hashtable[]]$Entries)
    Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $stream = New-Object System.IO.MemoryStream
    $zip = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create, $true)
    $utf8 = New-Object System.Text.UTF8Encoding $false
    try {
        foreach ($entry in $Entries) {
            $item = $zip.CreateEntry([string]$entry.Name, [System.IO.Compression.CompressionLevel]::Optimal)
            $output = $item.Open()
            try {
                $payload = $utf8.GetBytes([string]$entry.Text)
                $output.Write($payload, 0, $payload.Length)
            } finally { $output.Dispose() }
        }
    } finally { $zip.Dispose() }
    $bytes = $stream.ToArray()
    $stream.Dispose()
    return $bytes
}

function Invoke-ScrimshawCourseNew {
    param($Arguments)
    $title = [string](Get-FleetProp $Arguments 'title')
    if (-not $title) { $title = 'Untitled course' }
    $course = New-ScrimCourse $title
    return (Save-ScrimResult $course $Arguments @{ title = $title })
}

function Invoke-ScrimshawCourseInfo {
    param($Arguments)
    $loaded = Read-ScrimArgument $Arguments
    $course = $loaded.Course
    $slides = @(Get-CourseSlides $course $false)
    $questions = 0
    $graded = 0
    foreach ($slide in $slides) {
        $question = Get-FleetProp $slide 'question'
        if ($question) {
            $questions++
            $flag = Get-FleetProp $question 'graded'
            if ($null -eq $flag -or [bool]$flag) { $graded++ }
        }
    }
    $assets = Get-FleetProp $course 'assets'
    $assetCount = 0
    if ($assets -is [System.Collections.IDictionary]) { $assetCount = @($assets.Keys).Count }
    elseif ($assets) { $assetCount = @($assets.PSObject.Properties).Count }
    return @{
        title = [string](Get-FleetProp $course 'title')
        scenes = (Get-ListProp $course 'scenes').Count
        slides = $slides.Count
        questions = $questions
        graded = $graded
        assets = $assetCount
        variables = (Get-ListProp $course 'variables').Count
    }
}

function Invoke-ScrimshawCourseValidate {
    param($Arguments)
    $loaded = Read-ScrimArgument $Arguments
    $problems = @(Get-CourseProblems $loaded.Course)
    return @{ valid = ($problems.Count -eq 0); problems = $problems }
}

function Invoke-ScrimshawCourseSave {
    param($Arguments)
    $loaded = Read-ScrimArgument $Arguments
    return (Save-ScrimResult $loaded.Course $Arguments @{})
}

function Invoke-ScrimshawCourseSettings {
    param($Arguments)
    $loaded = Read-ScrimArgument $Arguments
    Update-CourseSettings $loaded.Course $Arguments
    return (Save-ScrimResult $loaded.Course $Arguments @{ title = [string](Get-FleetProp $loaded.Course 'title') })
}

function Invoke-ScrimshawCourseReplace {
    param($Arguments)
    $loaded = Read-ScrimArgument $Arguments
    $find = [string](Get-FleetProp $Arguments 'find')
    $replacement = ''
    if ($null -ne (Get-FleetProp $Arguments 'replacement')) { $replacement = [string](Get-FleetProp $Arguments 'replacement') }
    $matchCase = [bool](Get-FleetProp $Arguments 'matchCase')
    $count = 0
    if ($find) {
        $options = [Text.RegularExpressions.RegexOptions]::None
        if (-not $matchCase) { $options = [Text.RegularExpressions.RegexOptions]::IgnoreCase }
        $pattern = [regex]::Escape($find)
        $repl = $replacement
        $eval = { param($m) $repl }.GetNewClosure()
        foreach ($row in (Get-TextRows $loaded.Course)) {
            $found = [regex]::Matches([string]$row.text, $pattern, $options)
            if ($found.Count -eq 0) { continue }
            $count += $found.Count
            $next = [regex]::Replace([string]$row.text, $pattern, $eval, $options)
            [void](Set-TextKey $loaded.Course ([string]$row.key) $next)
        }
        Set-FleetProp $loaded.Course 'modified' ([DateTime]::UtcNow.ToString('o'))
    }
    $saved = Save-ScrimResult $loaded.Course $Arguments @{ replaced = $count }
    return $saved
}

function Invoke-ScrimshawCourseExportTexts {
    param($Arguments)
    $loaded = Read-ScrimArgument $Arguments
    $lines = New-Object System.Collections.Generic.List[string]
    [void]$lines.Add('key,where,field,source,translation')
    foreach ($row in (Get-TextRows $loaded.Course)) {
        [void]$lines.Add(((ConvertTo-CsvCell $row.key) + ',,,' + (ConvertTo-CsvCell $row.text) + ','))
    }
    $csv = [char]0xFEFF + ($lines -join "`r`n") + "`r`n"
    $dest = Get-FleetProp $Arguments 'dest'
    if (-not $dest) { Throw-Fleet 'E_ARGS' 'Missing argument dest.' }
    $written = Write-FleetFile -Path ([string]$dest) -Text $csv -Yes (Test-ReplaceArg $Arguments)
    if (-not $written.Ok) { Throw-Fleet 'E_ARGS' ([string]$written.Message) }
    return @{ rows = (@($lines).Count - 1); out = $written.out; bytes = $written.bytes; written = $true }
}

function Invoke-ScrimshawCourseImportTexts {
    param($Arguments)
    $loaded = Read-ScrimArgument $Arguments
    $csvText = [string](Get-FleetProp $Arguments 'csv')
    $csvPath = [string](Get-FleetProp $Arguments 'csvFile')
    if (-not $csvText -and $csvPath) {
        if (-not (Test-Path -LiteralPath $csvPath)) { Throw-Fleet 'E_NOT_FOUND' "File not found: $csvPath" }
        $csvText = [IO.File]::ReadAllText($csvPath)
    }
    if (-not $csvText) { Throw-Fleet 'E_ARGS' 'Pass csvFile or csv text.' }
    $rows = @(ConvertFrom-CsvText $csvText)
    if ($rows.Count -eq 0) { Throw-Fleet 'E_ARGS' 'The CSV is empty.' }
    $head = @($rows[0])
    $keyCol = -1
    $valueCol = -1
    for ($i = 0; $i -lt $head.Count; $i++) {
        $name = ([string]$head[$i]).Trim().ToLowerInvariant()
        if ($name -eq 'key') { $keyCol = $i }
        if ($name -eq 'translation') { $valueCol = $i }
    }
    if ($keyCol -lt 0 -or $valueCol -lt 0) { Throw-Fleet 'E_ARGS' 'The CSV needs key and translation columns.' }
    $applied = 0
    for ($r = 1; $r -lt $rows.Count; $r++) {
        $row = @($rows[$r])
        if ($keyCol -ge $row.Count -or $valueCol -ge $row.Count) { continue }
        $key = [string]$row[$keyCol]
        $value = [string]$row[$valueCol]
        if ($key -and $value -ne '') {
            if (Set-TextKey $loaded.Course $key $value) { $applied++ }
        }
    }
    Set-FleetProp $loaded.Course 'modified' ([DateTime]::UtcNow.ToString('o'))
    $saved = Save-ScrimResult $loaded.Course $Arguments @{ applied = $applied }
    return $saved
}

function Invoke-ScrimshawCoursePublish {
    param($Arguments)
    $loaded = Read-ScrimArgument $Arguments
    $format = [string](Get-FleetProp $Arguments 'format')
    $shellPath = [string](Get-FleetProp $Arguments 'shell')
    if (-not $shellPath) { $shellPath = Join-Path $script:ScrimshawRoot 'dist/index.html' }
    if (-not (Test-Path -LiteralPath $shellPath)) { Throw-Fleet 'E_ARGS' "The built app was not found at $shellPath." }
    $shell = [IO.File]::ReadAllText($shellPath)
    if ($shell -notmatch '<title>') { Throw-Fleet 'E_ARGS' "$shellPath does not look like the built app." }
    $html = New-PlayerHtml $loaded.Course $shell $format
    if ($null -eq $html) { Throw-Fleet 'E_ARGS' 'The shell has no </head> element.' }
    $bytes = $null
    if ($format -eq 'html') {
        $utf8 = New-Object System.Text.UTF8Encoding $false
        $bytes = $utf8.GetBytes($html)
    } else {
        $xmlName = 'imsmanifest.xml'
        if ($format -eq 'xapi') { $xmlName = 'tincan.xml' }
        if ($format -eq 'cmi5') { $xmlName = 'cmi5.xml' }
        $bytes = New-ZipBytes @(
            @{ Name = 'index.html'; Text = $html }
            @{ Name = $xmlName; Text = (New-PackageXml $loaded.Course $format) }
        )
    }
    $dest = Get-FleetProp $Arguments 'dest'
    if (-not $dest) { Throw-Fleet 'E_ARGS' 'Missing argument dest.' }
    $written = Write-FleetBytes -Path ([string]$dest) -Bytes $bytes -Yes (Test-ReplaceArg $Arguments)
    if (-not $written.Ok) { Throw-Fleet 'E_ARGS' ([string]$written.Message) }
    return @{ format = $format; out = $written.out; bytes = $written.bytes; written = $true }
}

function Invoke-ScrimshawMediaImport {
    param($Arguments)
    $loaded = Read-ScrimArgument $Arguments
    $raw = [string](Get-FleetProp $Arguments 'media')
    if (-not $raw) { Throw-Fleet 'E_ARGS' 'Missing argument media.' }
    $media = @($raw -split '\|' | Where-Object { $_ })
    $plan = Build-MediaPlan $media
    $added = Add-ImportedScene $loaded.Course $plan
    $extra = @{ slides = $added; rejected = @($plan.Rejected); warnings = @($plan.Warnings) }
    return (Save-ScrimResult $loaded.Course $Arguments $extra)
}

function Invoke-ScrimshawSessionStop {
    param($Arguments)
    $port = 8775
    $given = Get-FleetProp $Arguments 'port'
    if ($null -ne $given) { $port = [int]$given }
    $url = "http://127.0.0.1:$port/"
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($url + '__fleethacker/shutdown') -Headers @{ 'X-FleetHacker-Shutdown' = '1' } -TimeoutSec 5
        return @{ url = $url; stopping = ($response.StatusCode -eq 200); status = [int]$response.StatusCode }
    } catch {
        Throw-Fleet 'E_NOT_FOUND' "Could not stop Scrimshaw at ${url}."
    }
}

function Initialize-ScrimshawActions {
    param([string]$Root = '')
    if ($Root) { $script:ScrimshawRoot = $Root }
    elseif (-not $script:ScrimshawRoot) { $script:ScrimshawRoot = (Split-Path $PSScriptRoot -Parent) }
    Clear-FleetAction
    $course = @{ name = 'course'; type = 'string'; required = $true; description = 'Path to a .scrim course file.' }
    $dest = @{ name = 'dest'; type = 'string'; required = $true; description = 'File to write (UTF-8, no BOM).' }
    $replace = @{ name = 'replace'; type = 'boolean'; required = $false; description = 'Replace dest if it already exists.' }
    $null = Register-FleetAction -App scrimshaw -Noun course -Verb new -Description 'Create a course file.' -Handler ${function:Invoke-ScrimshawCourseNew} -Parameters @(
        @{ name = 'title'; type = 'string'; required = $false; description = 'Course title.' }
        $dest
        $replace
    )
    $null = Register-FleetAction -App scrimshaw -Noun course -Verb info -Description 'Count the scenes, slides, questions and media in a course.' -Handler ${function:Invoke-ScrimshawCourseInfo} -Parameters @($course)
    $null = Register-FleetAction -App scrimshaw -Noun course -Verb validate -Description 'List problems that would break playback.' -Handler ${function:Invoke-ScrimshawCourseValidate} -Parameters @($course)
    $null = Register-FleetAction -App scrimshaw -Noun course -Verb save -Description 'Write a course to a .scrim file.' -Handler ${function:Invoke-ScrimshawCourseSave} -Parameters @($course, $dest, $replace)
    $null = Register-FleetAction -App scrimshaw -Noun course -Verb settings -Description 'Set the title, description, player switches, navigation, or passing score.' -Destructive -Handler ${function:Invoke-ScrimshawCourseSettings} -Parameters @(
        $course, $dest, $replace
        @{ name = 'title'; type = 'string'; required = $false }
        @{ name = 'description'; type = 'string'; required = $false }
        @{ name = 'author'; type = 'string'; required = $false }
        @{ name = 'passPercent'; type = 'number'; required = $false }
        @{ name = 'navigation'; type = 'string'; required = $false }
        @{ name = 'showMenu'; type = 'boolean'; required = $false }
        @{ name = 'showNav'; type = 'boolean'; required = $false }
        @{ name = 'showSeekbar'; type = 'boolean'; required = $false }
        @{ name = 'showTitle'; type = 'boolean'; required = $false }
        @{ name = 'showNotes'; type = 'boolean'; required = $false }
        @{ name = 'resume'; type = 'boolean'; required = $false }
    )
    $null = Register-FleetAction -App scrimshaw -Noun course -Verb replace -Description 'Replace text across titles, objects, alt text, states, and accepted answers.' -Destructive -Handler ${function:Invoke-ScrimshawCourseReplace} -Parameters @(
        $course, $dest, $replace
        @{ name = 'find'; type = 'string'; required = $true }
        @{ name = 'replacement'; type = 'string'; required = $false }
        @{ name = 'matchCase'; type = 'boolean'; required = $false }
    )
    $null = Register-FleetAction -App scrimshaw -Noun course -Verb export-texts -Description 'Export learner-facing text as CSV for translation.' -Handler ${function:Invoke-ScrimshawCourseExportTexts} -Parameters @($course, $dest, $replace)
    $null = Register-FleetAction -App scrimshaw -Noun course -Verb import-texts -Description 'Apply a translation CSV to a course.' -Destructive -Handler ${function:Invoke-ScrimshawCourseImportTexts} -Parameters @(
        $course, $dest, $replace
        @{ name = 'csvFile'; type = 'string'; required = $false }
        @{ name = 'csv'; type = 'string'; required = $false }
    )
    $null = Register-FleetAction -App scrimshaw -Noun course -Verb publish -Description 'Build a standalone player or an LMS package.' -Handler ${function:Invoke-ScrimshawCoursePublish} -Parameters @(
        $course, $dest, $replace
        @{ name = 'format'; type = 'string'; required = $true }
        @{ name = 'shell'; type = 'string'; required = $false }
    )
    $null = Register-FleetAction -App scrimshaw -Noun media -Verb import -Description 'Add a scene from Capstan video, SnapShackle PNG, and TalkForge WAV.' -Destructive -Handler ${function:Invoke-ScrimshawMediaImport} -Parameters @(
        $course, $dest, $replace
        @{ name = 'media'; type = 'string'; required = $true; description = 'Media paths separated by |.' }
    )
    $null = Register-FleetAction -App scrimshaw -Noun session -Verb stop -Description 'Stop the local Scrimshaw server.' -Destructive -Handler ${function:Invoke-ScrimshawSessionStop} -Parameters @(
        @{ name = 'port'; type = 'number'; required = $false }
    )
}

Export-ModuleMember -Function @('Initialize-ScrimshawActions')
