# Scrimshaw CLI and action API

Scrimshaw's file operations are Fleet actions on FleetAction 1.0.1. Each action is one Windows PowerShell 5.1 function. Action ids are `scrimshaw.<noun>.<verb>`.

```text
scrimshaw.ps1 commands --json
scrimshaw.ps1 help --json
scrimshaw.ps1 <noun> <verb> [--<arg> <value>]... [--json] [--out <file>] [--dry-run] [--confirmed]
scrimshaw.ps1 job run --file <job.json> [--json] [--confirmed] [--dry-run]
scrimshaw.ps1 api --port 8775
```

`commands --json` is discovery. `help --json` prints the same document. The envelope is `{ "v": 1, "ok": true, "result": { "actions": [ ... ] } }`.

`--confirmed` is Scrimshaw's destructive-confirm flag. The entry script passes it to FleetAction as `--yes`, which sets `-Confirmed`. `--dry-run` checks the action and does not call it. `--out` writes that JSON document. The course file an action writes is `--dest`, and `--replace true` overwrites it. The course to read is `--course`. Media paths are one `--media` string separated by `|`.

Exit codes follow FleetAction: 0 ok, 2 bad arguments, 3 not found, 4 confirmation required, 1 internal.

Exit codes: `0` ok, `1` error, `2` the course has problems, `64` bad usage.

A destructive action does nothing until you pass `--confirmed`. `--dry-run` does not need it, and it still writes nothing.

## API

Scrimshaw's server is a `TcpListener` on `http://127.0.0.1:8775/`. It is not an `HttpListener`. Pass `-Api` to serve the action routes on that same address (no second port):

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File Start.ps1 -Api -NoBrowser
```

`scrimshaw.ps1 api --port 8775` starts the module's own listener, and only then, on `http://127.0.0.1:<port>/`. It refuses any other bind.

| Method | Path | Role |
| --- | --- | --- |
| GET | `/api/session` | Returns a token for this process. Loopback only. |
| GET | `/api/actions` | The discovery document. Needs the token. |
| GET | `/api/help` | Same document. |
| POST | `/api/actions/scrimshaw/<noun>/<verb>` | Run one action. Body is the args object. |
| POST | `/api/jobs` | Run a JSON job. Body is the job. |

Send the token in the `X-Fleet-Action-Token` header. The editor keeps it in memory and does not put it in the page. Do not log it. A call without the token is `401`.

`/api/heartbeat`, `/__fleethacker/id`, and `/__fleethacker/shutdown` are unchanged.

## Job files

Job files are JSON only. A `.yml` or `.txt` file is refused.

```powershell
scrimshaw.ps1 job run examples/training-to-course.job.json
```

Run that from the repo root. It builds a course from the Capstan clip and the SnapShackle PNG in `examples/fixtures/`, checks it, and publishes `bridge-watch.html`. The fixtures are tiny stand-ins so the job runs without those apps; replace the paths with a real Capstan MP4 (and its `.vtt`) and a SnapShackle PNG (and its `.png.meta.json`) when you have them.

## Actions

### scrimshaw.course.new

Create a course file.

```powershell
scrimshaw.ps1 course new --title "Bridge watch" --out bridge.scrim --json
```

```json
{ "id": "scrimshaw.course.new", "args": { "title": "Bridge watch", "out": "bridge.scrim", "yes": true } }
```

```powershell
curl.exe -s -X POST http://127.0.0.1:8775/api/actions/scrimshaw/course/new -H "Content-Type: application/json" -H "X-Fleet-Action-Token: $token" -d "{\"title\":\"Bridge watch\",\"out\":\"bridge.scrim\",\"yes\":true}"
```

### scrimshaw.course.info

Count scenes, slides, questions, graded questions, assets, and variables.

```powershell
scrimshaw.ps1 course info --file bridge.scrim --json
```

```json
{ "id": "scrimshaw.course.info", "args": { "file": "bridge.scrim" } }
```

```powershell
curl.exe -s -X POST http://127.0.0.1:8775/api/actions/scrimshaw/course/info -H "Content-Type: application/json" -H "X-Fleet-Action-Token: $token" -d "{\"file\":\"bridge.scrim\"}"
```

### scrimshaw.course.validate

Same checks as the publish dialog: broken trigger targets, questions that cannot be answered, images without alt text, media without captions. Exit code 2 when there is a problem. The JSON still includes `data.problems`.

```powershell
scrimshaw.ps1 course validate --file bridge.scrim --json
```

```json
{ "id": "scrimshaw.course.validate", "args": { "file": "bridge.scrim" } }
```

```powershell
curl.exe -s -X POST http://127.0.0.1:8775/api/actions/scrimshaw/course/validate -H "Content-Type: application/json" -H "X-Fleet-Action-Token: $token" -d "{\"file\":\"bridge.scrim\"}"
```

### scrimshaw.course.save

Write a `.scrim` file. The editor's Save to file still downloads from the browser when `-Api` is off.

```powershell
scrimshaw.ps1 course save --file bridge.scrim --out copy.scrim --json
```

```json
{ "id": "scrimshaw.course.save", "args": { "file": "bridge.scrim", "out": "copy.scrim" } }
```

```powershell
curl.exe -s -X POST http://127.0.0.1:8775/api/actions/scrimshaw/course/save -H "Content-Type: application/json" -H "X-Fleet-Action-Token: $token" -d "{\"file\":\"bridge.scrim\",\"out\":\"copy.scrim\"}"
```

### scrimshaw.course.settings

Destructive. Sets title, description, author, passing score, navigation (`free` or `restricted`), and the player switches (`showMenu`, `showNav`, `showSeekbar`, `showTitle`, `showNotes`, `resume`).

```powershell
scrimshaw.ps1 course settings --file bridge.scrim --title "Bridge watch" --passPercent 80 --out bridge.scrim --yes --confirmed --json
```

```json
{ "id": "scrimshaw.course.settings", "args": { "file": "bridge.scrim", "title": "Bridge watch", "passPercent": 80, "out": "bridge.scrim", "yes": true, "confirmed": true } }
```

```powershell
curl.exe -s -X POST http://127.0.0.1:8775/api/actions/scrimshaw/course/settings -H "Content-Type: application/json" -H "X-Fleet-Action-Token: $token" -d "{\"file\":\"bridge.scrim\",\"title\":\"Bridge watch\",\"out\":\"bridge.scrim\",\"yes\":true,\"confirmed\":true}"
```

### scrimshaw.course.replace

Destructive. Replaces text in the title, slide titles, object text, alt text, state text, and accepted answers.

```powershell
scrimshaw.ps1 course replace --file bridge.scrim --find "Hello" --replacement "Welcome" --out bridge.scrim --yes --confirmed --json
```

```json
{ "id": "scrimshaw.course.replace", "args": { "file": "bridge.scrim", "find": "Hello", "replacement": "Welcome", "out": "bridge.scrim", "yes": true, "confirmed": true } }
```

```powershell
curl.exe -s -X POST http://127.0.0.1:8775/api/actions/scrimshaw/course/replace -H "Content-Type: application/json" -H "X-Fleet-Action-Token: $token" -d "{\"file\":\"bridge.scrim\",\"find\":\"Hello\",\"replacement\":\"Welcome\",\"out\":\"bridge.scrim\",\"yes\":true,\"confirmed\":true}"
```

### scrimshaw.course.export-texts

CSV with `key` and `translation` columns (the translation column is empty). Excel can open it; the file starts with a UTF-8 BOM for that reason. Other `--out` files do not.

```powershell
scrimshaw.ps1 course export-texts --file bridge.scrim --out texts.csv --json
```

```json
{ "id": "scrimshaw.course.export-texts", "args": { "file": "bridge.scrim", "out": "texts.csv" } }
```

```powershell
curl.exe -s -X POST http://127.0.0.1:8775/api/actions/scrimshaw/course/export-texts -H "Content-Type: application/json" -H "X-Fleet-Action-Token: $token" -d "{\"file\":\"bridge.scrim\",\"out\":\"texts.csv\"}"
```

### scrimshaw.course.import-texts

Destructive. Fills text from the `translation` column.

```powershell
scrimshaw.ps1 course import-texts --file bridge.scrim --csvFile texts.csv --out bridge.scrim --yes --confirmed --json
```

```json
{ "id": "scrimshaw.course.import-texts", "args": { "file": "bridge.scrim", "csvFile": "texts.csv", "out": "bridge.scrim", "yes": true, "confirmed": true } }
```

```powershell
curl.exe -s -X POST http://127.0.0.1:8775/api/actions/scrimshaw/course/import-texts -H "Content-Type: application/json" -H "X-Fleet-Action-Token: $token" -d "{\"file\":\"bridge.scrim\",\"csvFile\":\"texts.csv\",\"out\":\"bridge.scrim\",\"yes\":true,\"confirmed\":true}"
```

### scrimshaw.course.publish

`format` is `html`, `scorm12`, `scorm2004`, `xapi`, or `cmi5`. `--shell` defaults to `dist/index.html`.

```powershell
scrimshaw.ps1 course publish --file bridge.scrim --format html --out bridge.html --json
```

```json
{ "id": "scrimshaw.course.publish", "args": { "file": "bridge.scrim", "format": "html", "out": "bridge.html", "shell": "dist/index.html" } }
```

```powershell
curl.exe -s -X POST http://127.0.0.1:8775/api/actions/scrimshaw/course/publish -H "Content-Type: application/json" -H "X-Fleet-Action-Token: $token" -d "{\"file\":\"bridge.scrim\",\"format\":\"scorm12\",\"out\":\"bridge.scorm12.zip\"}"
```

### scrimshaw.media.import

Destructive. Reads Capstan MP4, WebVTT captions, SnapShackle PNG plus `.png.meta.json`, and TalkForge WAV. Bytes are checked; a renamed file of the wrong type is refused. Matching captions attach to the video. The new slides go in a scene named `Imported media`.

```powershell
scrimshaw.ps1 media import --file bridge.scrim --media clip.mp4 --media clip.vtt --media shot.png --media shot.png.meta.json --out bridge.scrim --yes --confirmed --json
```

```json
{
  "id": "scrimshaw.media.import",
  "args": {
    "file": "bridge.scrim",
    "out": "bridge.scrim",
    "yes": true,
    "confirmed": true,
    "media": ["clip.mp4", "clip.vtt", "shot.png", "shot.png.meta.json"]
  }
}
```

```powershell
curl.exe -s -X POST http://127.0.0.1:8775/api/actions/scrimshaw/media/import -H "Content-Type: application/json" -H "X-Fleet-Action-Token: $token" -d "{\"file\":\"bridge.scrim\",\"out\":\"bridge.scrim\",\"yes\":true,\"confirmed\":true,\"media\":[\"clip.mp4\",\"shot.png\"]}"
```

Repeat `--media` for each file. TalkForge WAV is accepted. The publish check still wants captions on narration, so a WAV alone does not pass `course validate`.

### scrimshaw.session.stop

Destructive. From another process, asks the server to stop.

```powershell
scrimshaw.ps1 session stop --port 8775 --confirmed --json
```

```json
{ "id": "scrimshaw.session.stop", "args": { "port": 8775, "confirmed": true } }
```

```powershell
curl.exe -s -X POST http://127.0.0.1:8775/api/actions/scrimshaw/session/stop -H "Content-Type: application/json" -H "X-Fleet-Action-Token: $token" -d "{\"port\":8775,\"confirmed\":true}"
```

The editor's End session control calls `POST /__fleethacker/shutdown` itself. The server handles one request at a time, so that button does not call this action on the same process (the action would wait for a shutdown that cannot start until the action returns). Cancel is the focused button in that dialog.

## What stays in the editor

These need the open page, a pointer, or browser storage. They are not actions:

| Feature | Why it stays in the editor |
| --- | --- |
| Projects, Save now | The course lives in IndexedDB, keyed to this browser. |
| Open a `.scrim` file | The file picker and the unsaved-work check are part of the page. `course info` reads a file headlessly. |
| New course, course settings dialog | The page builds the in-memory course and the full settings form (resources, glossary, colours). `course new` and `course settings` cover the file. |
| Canvas: move, resize, rotate, snap, align, distribute, z-order, group, format painter | They use the current selection and the pointer. |
| Slides, layers, states, triggers, variables, timeline, quizzes as on-canvas edits | The operations exist in `src/store/ops.ts` and undo as you drag. There is no headless target for "the thing you have selected". |
| Storyboard HTML | `src/export/storyboard.tsx` renders with React. |
| Word handout | Built by the editor's docx writer. |
| Draft with the router | Opt-in call to Fairlead, then a review step before anything is added. |
| Preview, themes, zoom, shortcuts | Editor chrome, not a course file. |
| PowerPoint import | Runs in the page from a picked `.pptx`. |

When you start with `-Api`, Export text, Import translation, Import Fleet media, Replace all, and Publish call the action. Otherwise they keep the existing in-page path, including `file://`.

## Module pin

`vendor/FleetAction/` is the vendored framework. `vendor/FleetAction/LOCK.json` records the SHA256 and that the baseline commit could not be read from this run. Replace it with the `fleet-action-baseline` v1.0.0 module when that release is reachable.
