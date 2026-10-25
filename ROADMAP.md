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
| Exit animations | ✅ | Entrance effects played in reverse when the object disappears |
| Motion paths | ⬜ | |
| Text formatting | 🟡 | Per-object font, size, weight, colour, alignment; inline **bold**, *italic*, __underline__, ~~strike~~, links and bullet lines; no WYSIWYG run editor yet |
| Shapes | ✅ | Rectangle, rounded, oval, triangle, arrow, line |
| Images | ✅ | Embedded, alt text, decorative flag |
| Video | 🟡 | Embedded file or URL, autoplay, controls, loop, play/pause triggers. No captions, no timeline sync |
| Audio / narration | 🟡 | Audio objects that start on the timeline, optional play button, loop, play/pause triggers. No waveform editing or per-slide narration track |
| Text-to-speech, closed captions | 🟡 | WebVTT captions for video (native track) and audio (caption bar); publish check warns when media has none. No text-to-speech |
| Buttons, hotspots | ✅ | |
| Text entry | ✅ | Writes to a variable |
| Sliders, dials | 🟡 | Sliders bound to a number variable; no dials |
| Markers, scrolling panels, zoom regions | ⬜ | |
| Drag and drop | ✅ | Draggable objects and drop targets, snap, one item per target, keyboard support, drop triggers, graded question type |
| Slide masters / themes | ⬜ | Course-wide colour/font presets |
| Copy/paste between slides and projects | ✅ | Carries embedded media |
| Undo/redo | ✅ | 200 steps |
| Align, distribute, z-order, snapping, grid | ✅ | |
| Rotation | ✅ | Shift snaps to 15° |
| Grouping | ✅ | Ctrl+G / Ctrl+Shift+G; Alt+click picks one member |
| Find and replace | ✅ | Titles, text, state text, alt text, accepted answers |
| Spell check | 🟡 | Browser spell check in text fields only |
| Translation (export/import text) | ✅ | CSV with stable keys; opens in Excel |
| Slide notes | ✅ | Author-only |

## Quizzing

| Feature | Status | Notes |
| --- | --- | --- |
| Multiple choice, multiple response, true/false | ✅ | |
| Fill in the blank | ✅ | Multiple accepted answers, case-insensitive |
| Matching, sequence, hotspot, numeric, word bank | 🟡 | Hotspot and numeric (range) types; matching and sequence via drag and drop; no word bank yet |
| Freeform questions (any object as an answer) | 🟡 | Choice objects can sit on any slide; grading needs a question slide |
| Survey questions (Likert, essay, ranking) | 🟡 | Essay type; any question can be ungraded (a Likert scale is an ungraded multiple choice); no ranking type |
| Attempts, try again, feedback layers | ✅ | |
| Points per question, pass mark | ✅ | |
| Results slide, retry quiz | ✅ | |
| Question banks, random draw, shuffle answers | ✅ | Per-scene bank: shuffle and/or draw N, redrawn on retry; shuffle answers per question |
| Review quiz mode | ⬜ | |

## Player

| Feature | Status | Notes |
| --- | --- | --- |
| Menu, prev/next, seekbar, title | ✅ | Each can be turned off |
| Free / restricted navigation | ✅ | |
| Resume (local or LMS) | ✅ | |
| Keyboard access, screen-reader names | ✅ | |
| Player theming (colours, logo) | 🟡 | Accent colour with contrast check; no logo or layout options |
| Glossary, resources, notes tab | 🟡 | Resources and Glossary panels; no learner-facing notes tab |
| Responsive / mobile layout | 🟡 | Scales to fit; phone layout with an overlay menu, safe-area insets; no portrait-specific slide layouts |
| Lightbox slides | ✅ | Open a slide as a pop-up over the current one; close, Next or Prev returns |

## Publishing and reporting

| Feature | Status | Notes |
| --- | --- | --- |
| Web (standalone HTML) | ✅ | One self-contained file |
| SCORM 1.2 | ✅ | Status, score, location, suspend data |
| SCORM 2004 | ✅ | 3rd Edition manifest, completion and success status, scaled score, session time |
| xAPI (Tin Can) | ✅ | Tin Can launch, initialized/answered/passed/failed/completed/terminated statements, State API resume |
| cmi5 | ⬜ | |
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

1. cmi5 publishing
3. Motion paths
4. WYSIWYG rich text editing (formatting already works inline)
5. Slide masters
6. Word bank and Likert question types
7. Player logo and layout options
