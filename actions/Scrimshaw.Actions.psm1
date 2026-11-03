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

function Set-FleetProp {
    param($Object, [string]$Name, $Value)
    if ($Object -is [System.Collections.IDictionary]) { $Object[$Name] = $Value; return }
    $prop = $Object.PSObject.Properties[$Name]
    if ($null -eq $prop) { $Object | Add-Member -NotePropertyName $Name -NotePropertyValue $Value }
    else { $prop.Value = $Value }
}

function Get-ListProp {
    param($Object, [string]$Name)
    $value = Get-FleetProp $Object $Name
    if ($null -eq $value) { return @() }
    if ($value -is [string]) { return @($value) }
    if ($value -is [System.Collections.IDictionary] -or $value -is [System.Management.Automation.PSCustomObject]) { return @($value) }
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($item in $value) { [void]$list.Add($item) }
    return $list.ToArray()
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
    if ($inline) { return (Read-ScrimText ([string]$inline)) }
    $path = Get-FleetProp $Arguments 'file'
    if (-not $path) { return @{ Ok = $false; Message = 'Pass --file or scrim text.' } }
    if (-not (Test-Path -LiteralPath $path)) { return @{ Ok = $false; Code = 'not-found'; Message = "File not found: $path" } }
    return (Read-ScrimText ([IO.File]::ReadAllText($path)))
}

function Save-ScrimResult {
    param($Course, $Arguments, $Context, [hashtable]$Extra)
    $text = ConvertTo-ScrimText $Course
    $data = @{}
    if ($Extra) { foreach ($key in @($Extra.Keys)) { $data[$key] = $Extra[$key] } }
    $inline = Get-FleetProp $Arguments 'inline'
    if ($inline) { $data['scrim'] = $text }
    $out = Get-FleetProp $Arguments 'out'
    if (-not $out) {
        if ($inline) { return @{ Data = $data; Exit = 0 } }
        return @{ Ok = $false; Code = 'usage'; Exit = 64; Message = 'Pass --out, or inline=true to return the course text.' }
    }
    $written = Write-FleetFile -Path ([string]$out) -Text $text -Yes ([bool]$Context.Yes) -DryRun ([bool]$Context.DryRun)
    if ($written -is [System.Collections.IDictionary] -and $written.ContainsKey('Ok') -and -not $written['Ok']) { return $written }
    foreach ($key in @($written.Keys)) { $data[$key] = $written[$key] }
    return @{ Data = $data; Exit = 0 }
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
                $accepted = @(Get-ListProp $question 'accepted')
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
            $accepted = @(Get-ListProp $question 'accepted')
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
    param($Arguments, $Context)
    $title = [string](Get-FleetProp $Arguments 'title')
    if (-not $title) { $title = 'Untitled course' }
    $course = New-ScrimCourse $title
    $saved = Save-ScrimResult $course $Arguments $Context @{ title = $title }
    return $saved
}

function Invoke-ScrimshawCourseInfo {
    param($Arguments, $Context)
    $loaded = Read-ScrimArgument $Arguments
    if (-not $loaded.Ok) {
        $code = 'bad-course'
        if ($loaded.ContainsKey('Code')) { $code = [string]$loaded.Code }
        $exit = 1
        if ($code -eq 'usage') { $exit = 64 }
        return @{ Ok = $false; Code = $code; Exit = $exit; Message = [string]$loaded.Message }
    }
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
        Data = @{
            title = [string](Get-FleetProp $course 'title')
            scenes = @(Get-ListProp $course 'scenes').Count
            slides = $slides.Count
            questions = $questions
            graded = $graded
            assets = $assetCount
            variables = @(Get-ListProp $course 'variables').Count
        }
        Exit = 0
    }
}

function Invoke-ScrimshawCourseValidate {
    param($Arguments, $Context)
    $loaded = Read-ScrimArgument $Arguments
    if (-not $loaded.Ok) {
        $code = 'bad-course'
        if ($loaded.ContainsKey('Code')) { $code = [string]$loaded.Code }
        return @{ Ok = $false; Code = $code; Exit = 1; Message = [string]$loaded.Message }
    }
    $problems = @(Get-CourseProblems $loaded.Course)
    $exit = 0
    if ($problems.Count -gt 0) { $exit = 2 }
    return @{ Data = @{ valid = ($problems.Count -eq 0); problems = $problems }; Exit = $exit }
}

function Invoke-ScrimshawCourseSave {
    param($Arguments, $Context)
    $loaded = Read-ScrimArgument $Arguments
    if (-not $loaded.Ok) {
        $code = 'bad-course'
        if ($loaded.ContainsKey('Code')) { $code = [string]$loaded.Code }
        $exit = $(if ($code -eq 'usage') { 64 } else { 1 })
        return @{ Ok = $false; Code = $code; Exit = $exit; Message = [string]$loaded.Message }
    }
    return (Save-ScrimResult $loaded.Course $Arguments $Context @{})
}

function Invoke-ScrimshawCourseSettings {
    param($Arguments, $Context)
    $loaded = Read-ScrimArgument $Arguments
    if (-not $loaded.Ok) { return @{ Ok = $false; Code = 'bad-course'; Exit = 1; Message = [string]$loaded.Message } }
    if ($Context.DryRun) {
        return @{ Data = @{ title = [string](Get-FleetProp $loaded.Course 'title'); written = $false; dryRun = $true }; Exit = 0 }
    }
    Update-CourseSettings $loaded.Course $Arguments
    return (Save-ScrimResult $loaded.Course $Arguments $Context @{ title = [string](Get-FleetProp $loaded.Course 'title') })
}

function Invoke-ScrimshawCourseReplace {
    param($Arguments, $Context)
    $loaded = Read-ScrimArgument $Arguments
    if (-not $loaded.Ok) { return @{ Ok = $false; Code = 'bad-course'; Exit = 1; Message = [string]$loaded.Message } }
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
            if (-not $Context.DryRun) {
                $next = [regex]::Replace([string]$row.text, $pattern, $eval, $options)
                [void](Set-TextKey $loaded.Course ([string]$row.key) $next)
            }
        }
        if (-not $Context.DryRun) { Set-FleetProp $loaded.Course 'modified' ([DateTime]::UtcNow.ToString('o')) }
    }
    if ($Context.DryRun) { return @{ Data = @{ replaced = $count; written = $false; dryRun = $true }; Exit = 0 } }
    return (Save-ScrimResult $loaded.Course $Arguments $Context @{ replaced = $count })
}

function Invoke-ScrimshawCourseExportTexts {
    param($Arguments, $Context)
    $loaded = Read-ScrimArgument $Arguments
    if (-not $loaded.Ok) { return @{ Ok = $false; Code = 'bad-course'; Exit = 1; Message = [string]$loaded.Message } }
    $lines = New-Object System.Collections.Generic.List[string]
    [void]$lines.Add('key,where,field,source,translation')
    foreach ($row in (Get-TextRows $loaded.Course)) {
        [void]$lines.Add(((ConvertTo-CsvCell $row.key) + ',,,' + (ConvertTo-CsvCell $row.text) + ','))
    }
    $csv = [char]0xFEFF + ($lines -join "`r`n") + "`r`n"
    $data = @{ rows = @($lines).Count - 1 }
    $inline = Get-FleetProp $Arguments 'inline'
    if ($inline) { $data['csv'] = $csv }
    $out = Get-FleetProp $Arguments 'out'
    if (-not $out) {
        if ($inline) { return @{ Data = $data; Exit = 0 } }
        return @{ Ok = $false; Code = 'usage'; Exit = 64; Message = 'Pass --out, or inline=true to return the CSV.' }
    }
    $written = Write-FleetFile -Path ([string]$out) -Text $csv -Yes ([bool]$Context.Yes) -DryRun ([bool]$Context.DryRun)
    if ($written.ContainsKey('Ok') -and -not $written['Ok']) { return $written }
    foreach ($key in @($written.Keys)) { $data[$key] = $written[$key] }
    return @{ Data = $data; Exit = 0 }
}

function Invoke-ScrimshawCourseImportTexts {
    param($Arguments, $Context)
    $loaded = Read-ScrimArgument $Arguments
    if (-not $loaded.Ok) { return @{ Ok = $false; Code = 'bad-course'; Exit = 1; Message = [string]$loaded.Message } }
    $csvText = [string](Get-FleetProp $Arguments 'csv')
    $csvPath = [string](Get-FleetProp $Arguments 'csvFile')
    if (-not $csvText -and $csvPath) {
        if (-not (Test-Path -LiteralPath $csvPath)) { return @{ Ok = $false; Code = 'not-found'; Exit = 1; Message = "File not found: $csvPath" } }
        $csvText = [IO.File]::ReadAllText($csvPath)
    }
    if (-not $csvText) { return @{ Ok = $false; Code = 'usage'; Exit = 64; Message = 'Pass --csvFile or csv text.' } }
    $rows = @(ConvertFrom-CsvText $csvText)
    if ($rows.Count -eq 0) { return @{ Ok = $false; Code = 'usage'; Exit = 1; Message = 'The CSV is empty.' } }
    $head = @($rows[0])
    $keyCol = -1
    $valueCol = -1
    for ($i = 0; $i -lt $head.Count; $i++) {
        $name = ([string]$head[$i]).Trim().ToLowerInvariant()
        if ($name -eq 'key') { $keyCol = $i }
        if ($name -eq 'translation') { $valueCol = $i }
    }
    if ($keyCol -lt 0 -or $valueCol -lt 0) { return @{ Ok = $false; Code = 'usage'; Exit = 1; Message = 'The CSV needs key and translation columns.' } }
    $applied = 0
    if (-not $Context.DryRun) {
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
    } else {
        for ($r = 1; $r -lt $rows.Count; $r++) {
            $row = @($rows[$r])
            if ($valueCol -lt $row.Count -and [string]$row[$valueCol] -ne '') { $applied++ }
        }
        return @{ Data = @{ applied = $applied; written = $false; dryRun = $true }; Exit = 0 }
    }
    return (Save-ScrimResult $loaded.Course $Arguments $Context @{ applied = $applied })
}

function Invoke-ScrimshawCoursePublish {
    param($Arguments, $Context)
    $loaded = Read-ScrimArgument $Arguments
    if (-not $loaded.Ok) { return @{ Ok = $false; Code = 'bad-course'; Exit = 1; Message = [string]$loaded.Message } }
    $format = [string](Get-FleetProp $Arguments 'format')
    $shellPath = [string](Get-FleetProp $Arguments 'shell')
    if (-not $shellPath) { $shellPath = Join-Path $script:ScrimshawRoot 'dist/index.html' }
    if (-not (Test-Path -LiteralPath $shellPath)) { return @{ Ok = $false; Code = 'no-shell'; Exit = 1; Message = "The built app was not found at $shellPath." } }
    $shell = [IO.File]::ReadAllText($shellPath)
    if ($shell -notmatch '<title>') { return @{ Ok = $false; Code = 'no-shell'; Exit = 1; Message = "$shellPath does not look like the built app." } }
    $html = New-PlayerHtml $loaded.Course $shell $format
    if ($null -eq $html) { return @{ Ok = $false; Code = 'no-shell'; Exit = 1; Message = 'The shell has no </head> element.' } }
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
    $data = @{ format = $format; bytes = $bytes.Length }
    if (Get-FleetProp $Arguments 'inline') { $data['base64'] = [Convert]::ToBase64String($bytes) }
    $out = Get-FleetProp $Arguments 'out'
    if (-not $out) {
        if (Get-FleetProp $Arguments 'inline') { $data['written'] = $false; return @{ Data = $data; Exit = 0 } }
        return @{ Ok = $false; Code = 'usage'; Exit = 64; Message = 'Pass --out, or inline=true to return the package.' }
    }
    $written = Write-FleetBytes -Path ([string]$out) -Bytes $bytes -Yes ([bool]$Context.Yes) -DryRun ([bool]$Context.DryRun)
    if ($written.ContainsKey('Ok') -and -not $written['Ok']) { return $written }
    foreach ($key in @($written.Keys)) { $data[$key] = $written[$key] }
    return @{ Data = $data; Exit = 0 }
}

function Invoke-ScrimshawMediaImport {
    param($Arguments, $Context)
    $loaded = Read-ScrimArgument $Arguments
    if (-not $loaded.Ok) { return @{ Ok = $false; Code = 'bad-course'; Exit = 1; Message = [string]$loaded.Message } }
    $media = @(Get-ListProp $Arguments 'media')
    if ($media.Count -eq 0) { return @{ Ok = $false; Code = 'usage'; Exit = 64; Message = 'Pass at least one --media path.' } }
    $plan = Build-MediaPlan $media
    $added = 0
    if (-not $Context.DryRun) { $added = Add-ImportedScene $loaded.Course $plan }
    else {
        $added = @($plan.Videos).Count + @($plan.Images).Count + @($plan.Audio).Count
        return @{
            Data = @{
                slides = $added; rejected = @($plan.Rejected); warnings = @($plan.Warnings); written = $false; dryRun = $true
            }
            Exit = 0
        }
    }
    $extra = @{ slides = $added; rejected = @($plan.Rejected); warnings = @($plan.Warnings) }
    return (Save-ScrimResult $loaded.Course $Arguments $Context $extra)
}

function Invoke-ScrimshawSessionStop {
    param($Arguments, $Context)
    $port = 8775
    $given = Get-FleetProp $Arguments 'port'
    if ($null -ne $given) { $port = [int]$given }
    $url = "http://127.0.0.1:$port/"
    if ($Context.DryRun) { return @{ Data = @{ url = $url; stopping = $false; dryRun = $true }; Exit = 0 } }
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Method Post -Uri ($url + '__fleethacker/shutdown') -Headers @{ 'X-FleetHacker-Shutdown' = '1' } -TimeoutSec 5
        return @{ Data = @{ url = $url; stopping = ($response.StatusCode -eq 200); status = [int]$response.StatusCode }; Exit = 0 }
    } catch {
        $message = Protect-FleetLog $_.Exception.Message
        return @{ Ok = $false; Code = 'unreachable'; Exit = 1; Message = "Could not stop Scrimshaw at ${url}: $message" }
    }
}

function Initialize-ScrimshawActions {
    param([string]$Root = '')
    if ($Root) { $script:ScrimshawRoot = $Root }
    elseif (-not $script:ScrimshawRoot) { $script:ScrimshawRoot = (Split-Path $PSScriptRoot -Parent) }
    Clear-FleetAction -App 'scrimshaw'
    $fileOrScrim = @{
        file = @{ type = 'string'; description = 'A .scrim course file.' }
        scrim = @{ type = 'string'; description = 'Course JSON text, used by the editor instead of a path.' }
        inline = @{ type = 'boolean'; description = 'Return the result text in the JSON body.' }
    }
    $writeFlags = @{
        out = @{ type = 'string'; description = 'File to write (UTF-8, no BOM).' }
    }
    Register-FleetAction -Id 'scrimshaw.course.new' -Summary 'Create a course file.' -Example @('course', 'new', '--title', 'Demo', '--out', 'new.scrim') -Handler ${function:Invoke-ScrimshawCourseNew} -Schema @{
        type = 'object'; additionalProperties = $false; required = @()
        properties = @{
            title = @{ type = 'string'; description = 'Course title.'; default = 'Untitled course' }
            out = $writeFlags.out; inline = $fileOrScrim.inline
        }
    }
    Register-FleetAction -Id 'scrimshaw.course.info' -Summary 'Count the scenes, slides, questions and media in a course.' -Example @('course', 'info', '--file', 'demo.scrim') -Handler ${function:Invoke-ScrimshawCourseInfo} -Schema @{
        type = 'object'; additionalProperties = $false; required = @()
        properties = @{ file = $fileOrScrim.file; scrim = $fileOrScrim.scrim }
    }
    Register-FleetAction -Id 'scrimshaw.course.validate' -Summary 'List problems that would break playback. Exit code 2 when there are any.' -Example @('course', 'validate', '--file', 'demo.scrim') -Handler ${function:Invoke-ScrimshawCourseValidate} -Schema @{
        type = 'object'; additionalProperties = $false; required = @()
        properties = @{ file = $fileOrScrim.file; scrim = $fileOrScrim.scrim }
    }
    Register-FleetAction -Id 'scrimshaw.course.save' -Summary 'Write a course to a .scrim file.' -Example @('course', 'save', '--file', 'demo.scrim', '--out', 'copy.scrim') -Handler ${function:Invoke-ScrimshawCourseSave} -Schema @{
        type = 'object'; additionalProperties = $false; required = @()
        properties = @{ file = $fileOrScrim.file; scrim = $fileOrScrim.scrim; out = $writeFlags.out; inline = $fileOrScrim.inline }
    }
    Register-FleetAction -Id 'scrimshaw.course.settings' -Summary 'Set the title, description, player switches, navigation, or passing score.' -Destructive -Example @('course', 'settings', '--file', 'demo.scrim', '--title', 'Bridge watch', '--out', 'demo.scrim') -Handler ${function:Invoke-ScrimshawCourseSettings} -Schema @{
        type = 'object'; additionalProperties = $false; required = @()
        properties = @{
            file = $fileOrScrim.file; scrim = $fileOrScrim.scrim; out = $writeFlags.out; inline = $fileOrScrim.inline
            title = @{ type = 'string'; description = 'Course title.' }
            description = @{ type = 'string'; description = 'Course description.' }
            author = @{ type = 'string'; description = 'Author name stored in the course.' }
            passPercent = @{ type = 'integer'; minimum = 0; maximum = 100; description = 'Passing score percent.' }
            navigation = @{ type = 'string'; enum = @('free', 'restricted'); description = 'Menu navigation.' }
            showMenu = @{ type = 'boolean'; description = 'Show the player menu.' }
            showNav = @{ type = 'boolean'; description = 'Show previous and next.' }
            showSeekbar = @{ type = 'boolean'; description = 'Show the seekbar.' }
            showTitle = @{ type = 'boolean'; description = 'Show the title.' }
            showNotes = @{ type = 'boolean'; description = 'Show slide notes to learners.' }
            resume = @{ type = 'boolean'; description = 'Resume where the learner left off.' }
        }
    }
    Register-FleetAction -Id 'scrimshaw.course.replace' -Summary 'Replace text across titles, objects, alt text, states, and accepted answers.' -Destructive -Example @('course', 'replace', '--file', 'demo.scrim', '--find', 'Hello', '--replacement', 'Welcome', '--out', 'demo.scrim') -Handler ${function:Invoke-ScrimshawCourseReplace} -Schema @{
        type = 'object'; additionalProperties = $false; required = @('find')
        properties = @{
            file = $fileOrScrim.file; scrim = $fileOrScrim.scrim; out = $writeFlags.out; inline = $fileOrScrim.inline
            find = @{ type = 'string'; minLength = 1; description = 'Text to find.' }
            replacement = @{ type = 'string'; description = 'Text to write in its place.' }
            matchCase = @{ type = 'boolean'; description = 'Match letter case.' }
        }
    }
    Register-FleetAction -Id 'scrimshaw.course.export-texts' -Summary 'Export learner-facing text as CSV for translation.' -Example @('course', 'export-texts', '--file', 'demo.scrim', '--out', 'texts.csv') -Handler ${function:Invoke-ScrimshawCourseExportTexts} -Schema @{
        type = 'object'; additionalProperties = $false; required = @()
        properties = @{ file = $fileOrScrim.file; scrim = $fileOrScrim.scrim; out = $writeFlags.out; inline = $fileOrScrim.inline }
    }
    Register-FleetAction -Id 'scrimshaw.course.import-texts' -Summary 'Apply a translation CSV to a course.' -Destructive -Example @('course', 'import-texts', '--file', 'demo.scrim', '--csvFile', 'texts.csv', '--out', 'demo.scrim') -Handler ${function:Invoke-ScrimshawCourseImportTexts} -Schema @{
        type = 'object'; additionalProperties = $false; required = @()
        properties = @{
            file = $fileOrScrim.file; scrim = $fileOrScrim.scrim; out = $writeFlags.out; inline = $fileOrScrim.inline
            csvFile = @{ type = 'string'; description = 'CSV file with key and translation columns.' }
            csv = @{ type = 'string'; description = 'CSV text, used by the editor instead of a path.' }
        }
    }
    Register-FleetAction -Id 'scrimshaw.course.publish' -Summary 'Build a standalone player or an LMS package.' -Example @('course', 'publish', '--file', 'demo.scrim', '--format', 'html', '--out', 'course.html') -Handler ${function:Invoke-ScrimshawCoursePublish} -Schema @{
        type = 'object'; additionalProperties = $false; required = @('format')
        properties = @{
            file = $fileOrScrim.file; scrim = $fileOrScrim.scrim; out = $writeFlags.out; inline = $fileOrScrim.inline
            format = @{ type = 'string'; enum = @('html', 'scorm12', 'scorm2004', 'xapi', 'cmi5'); description = 'Package type.' }
            shell = @{ type = 'string'; description = 'Built app to use as the player shell. Defaults to dist/index.html.' }
        }
    }
    Register-FleetAction -Id 'scrimshaw.media.import' -Summary 'Add a scene from Capstan video, SnapShackle PNG, and TalkForge WAV.' -Destructive -Example @('media', 'import', '--file', 'demo.scrim', '--media', 'clip.mp4', '--out', 'demo.scrim') -Handler ${function:Invoke-ScrimshawMediaImport} -Schema @{
        type = 'object'; additionalProperties = $false; required = @('media')
        properties = @{
            file = $fileOrScrim.file; scrim = $fileOrScrim.scrim; out = $writeFlags.out; inline = $fileOrScrim.inline
            media = @{
                type = 'array'; description = 'File paths, or objects with name and base64.'
            }
        }
    }
    Register-FleetAction -Id 'scrimshaw.session.stop' -Summary 'Stop the local Scrimshaw server.' -Destructive -Example @('session', 'stop', '--port', '8775') -Handler ${function:Invoke-ScrimshawSessionStop} -Schema @{
        type = 'object'; additionalProperties = $false; required = @()
        properties = @{
            port = @{ type = 'integer'; minimum = 1; maximum = 65535; description = 'Server port. Default 8775.' }
        }
    }
}

Export-ModuleMember -Function @('Initialize-ScrimshawActions')
