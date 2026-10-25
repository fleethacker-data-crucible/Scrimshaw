# Roadmap

Status of each feature area in Scrimshaw. ✅ done, 🟡 partial, ⬜ not started.

## Authoring

| Feature | Status | Notes |
| --- | --- | --- |
| Scenes and slides | ✅ | Reorder by drag, move between scenes, duplicate, start slide |
| Story view | 🟡 | Scene grid with trigger links listed; no drawn connector lines yet |
| Slide layers | ✅ | Hide others, modal dim/block, duplicate, layer triggers |
| Object states (built-in + custom) | ✅ | Hover/Down automatic, Visited after click, Selected for choices |
| Triggers | ✅ | 17 actions, 9 events, AND/OR conditions on variables and states |
| Variables | ✅ | Text, number, true/false; `%var%` references; built-in Results/Project vars |
| Timeline | 🟡 | Start/end per object, slide length, cue-point triggers (timeline reaches). No cue-point markers in the UI, no layer timelines of their own length |
| Entrance animations | ✅ | Fade, fly ×4, grow, wipe |
| Exit animations | ⬜ | Model field exists (`exit`), not rendered |
| Motion paths | ⬜ | |
| Text formatting | 🟡 | Per-object font, size, weight, colour, alignment; no per-run rich text, lists or hyperlinks inside text |
| Shapes | ✅ | Rectangle, rounded, oval, triangle, arrow, line |
| Images | ✅ | Embedded, alt text, decorative flag |
| Video | 🟡 | Embedded file or URL, autoplay, controls, play/pause triggers. No captions, no timeline sync |
| Audio / narration | ⬜ | |
| Text-to-speech, closed captions | ⬜ | |
| Buttons, hotspots | ✅ | |
| Text entry | ✅ | Writes to a variable |
| Sliders, dials | ⬜ | |
| Markers, scrolling panels, zoom regions | ⬜ | |
| Drag and drop | ⬜ | Next up: draggable objects with drop targets, graded |
| Slide masters / themes | ⬜ | Course-wide colour/font presets |
| Copy/paste between slides and projects | ✅ | Carries embedded media |
| Undo/redo | ✅ | 200 steps |
| Align, distribute, z-order, snapping, grid | ✅ | |
| Rotation | ✅ | Shift snaps to 15° |
| Grouping | ⬜ | |
| Find and replace | ⬜ | |
| Spell check | 🟡 | Browser spell check in text fields only |
| Translation (export/import text) | ⬜ | |
| Slide notes | ✅ | Author-only |

## Quizzing

| Feature | Status | Notes |
| --- | --- | --- |
| Multiple choice, multiple response, true/false | ✅ | |
| Fill in the blank | ✅ | Multiple accepted answers, case-insensitive |
| Matching, sequence, hotspot, numeric, word bank | ⬜ | |
| Freeform questions (any object as an answer) | 🟡 | Choice objects can sit on any slide; grading needs a question slide |
| Survey questions (Likert, essay, ranking) | 🟡 | Questions can be ungraded; no Likert/essay types yet |
| Attempts, try again, feedback layers | ✅ | |
| Points per question, pass mark | ✅ | |
| Results slide, retry quiz | ✅ | |
| Question banks, random draw, shuffle answers | ⬜ | |
| Review quiz mode | ⬜ | |

## Player

| Feature | Status | Notes |
| --- | --- | --- |
| Menu, prev/next, seekbar, title | ✅ | Each can be turned off |
| Free / restricted navigation | ✅ | |
| Resume (local or LMS) | ✅ | |
| Keyboard access, screen-reader names | ✅ | |
| Player theming (colours, logo) | ⬜ | |
| Glossary, resources, notes tab | ⬜ | |
| Responsive / mobile layout | 🟡 | Scales to fit; no mobile-specific player layout |
| Lightbox slides | ⬜ | |

## Publishing and reporting

| Feature | Status | Notes |
| --- | --- | --- |
| Web (standalone HTML) | ✅ | One self-contained file |
| SCORM 1.2 | ✅ | Status, score, location, suspend data |
| SCORM 2004 | ⬜ | Next up |
| xAPI (Tin Can), cmi5 | ⬜ | |
| AICC | ⬜ | |
| Word / PDF handout export | ⬜ | |
| Video (MP4) export | ⬜ | |
| Publish-time validation | ✅ | Broken trigger targets, unanswerable questions, missing alt text |

## Platform

| Feature | Status | Notes |
| --- | --- | --- |
| Local server (PowerShell 5.1, TcpListener) | ✅ | 127.0.0.1 only, Host check, no traversal |
| Offline, no CDN | ✅ | |
| Autosave (IndexedDB) and .scrim files | ✅ | |
| Light / dark theme, reduced motion | ✅ | UI kit tokens |
| Import other authoring tools' files | ⬜ | The formats are proprietary; a best-effort importer is a stretch goal |
| Collaboration / review comments | ⬜ | |
| Rust → WebAssembly compute | ⬜ | Not needed yet; reserved for heavy work such as video export |
| Service worker | ⬜ | The app is one file, so offline already works |

## Suggested order

1. Drag-and-drop interactions and question type
2. SCORM 2004 and xAPI publishing
3. Audio objects and captions (WebVTT)
4. Exit animations and motion paths
5. Question banks with random draw
6. Rich text runs (bold/italic/links per word)
7. Grouping and slide masters
8. Player theming
