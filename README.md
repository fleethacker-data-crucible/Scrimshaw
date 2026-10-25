# Scrimshaw

An open-source e-learning authoring tool in the spirit of Articulate Storyline. Build interactive
courses from slides, layers, object states, triggers and variables, add graded quizzes, preview
them in the editor, and publish a SCORM 1.2 or 2004 package or a standalone web page.

Scrimshaw follows the FleetHacker Edge-Ops conventions: the **TechStack** (PowerShell 5.1 local
server on 127.0.0.1, React 19 + TypeScript, Tailwind CSS 4 with CVA and Lucide, IndexedDB for
data, everything bundled, no CDNs) and the **FleetHacker UI Kit v0.2.2** (tokens, Exo 2 / Syne
Mono, 25 px controls, gold brand accent, native dialogs, toasts and the kit's accessibility rules).

## Run it

**Windows (workstation):** double-click `Launch.bat`. It starts the local server in a minimised
window and opens the editor in your browser. Close the *Scrimshaw* window to stop it.
No admin rights, installer or Node.js needed: `dist/` is committed.

**Anywhere:** open `dist/index.html` directly in Edge or Chrome. The app is one self-contained file
and works from `file://`.

Projects save automatically to the browser (IndexedDB). Use **File › Save to file** for a `.scrim`
backup you can move between machines or share with another author.

## What it does

| Area | Features |
| --- | --- |
| Slides | Scenes, slides, slide master, drag-to-reorder, duplicate, start slide, completion slide, story view with trigger links |
| Objects | Text, shapes (rectangle, rounded, oval, triangle, arrow, line), images, video and audio (with WebVTT captions), buttons, hotspots, text entry, choices, sliders |
| Drag and drop | Any object can be draggable or a drop target; snap to target, one item per target, keyboard pick-up and drop, `drop` trigger event |
| Canvas | Select, marquee, multi-select, move, resize (Shift keeps aspect), rotate, snapping guides, grid, zoom, inline text editing, align and distribute, z-order, copy/paste/duplicate, lock, hide while editing |
| Layers | Per-slide layers, hide other layers, modal (dim and block the base layer), layer triggers |
| States | Normal, Hover, Down, Selected, Visited, Disabled, Hidden and custom states, with preview in the editor |
| Triggers | 19 actions × 10 events (including lightbox slides and drag-and-drop drops), AND/OR conditions on variables and object states, reorder, enable/disable, plain-English descriptions |
| Variables | Text, number and true/false variables, `%Name%` in any text, built-ins such as `%Results.ScorePercent%` and `%Project.SlideNumber%` |
| Timeline | Per-object appear/disappear times, drag bars, slide length, entrance and exit animations (fade, fly, grow, wipe), motion paths, cue-point triggers, auto-advance |
| Quizzes | Multiple choice, multiple response, true/false, fill-in-the-blank, drag and drop, sequence, hotspot, numeric, essay and Likert (surveys); points, attempts, try-again/correct/incorrect feedback layers, shuffled answers, question banks (shuffle and draw per scene), results slide, retry |
| Player | Menu, prev/next, seekbar, pause, Resources and Glossary panels, resume where you left off, restricted or free navigation, accent colour (with an AA contrast check) and logo, keyboard-accessible objects |
| Publish | SCORM 1.2 and SCORM 2004 3rd Edition zips (status, success, score, location, suspend data, session time), xAPI (Tin Can) and cmi5 zips with State API resume, standalone HTML, printable storyboard, `.scrim` project file; publish-time checks for broken references and missing alt text |
| Editor | Undo/redo (200 steps, coalesced drags and typing), autosave, find and replace, translation export/import (CSV), keyboard shortcuts (`?`), light and dark themes, reduced motion |

New to it? Start with the [author guide](docs/GUIDE.md). See [ROADMAP.md](ROADMAP.md) for the full Storyline parity checklist and what is next.

## Develop

Build off-workstation (per the TechStack), then commit `dist/`.

```sh
npm install          # Node 22.18+
npm run build        # -> dist/index.html (one file, ~600 KB)
npm run watch        # rebuild on change; open dist/index.html
npm test             # unit tests (node:test, engine/editor/io)
npm run typecheck
npm run test:e2e     # Playwright: editor, preview, publish, SCORM in a mock LMS
```

The build is `tools/build.mjs`: esbuild bundles `src/main.tsx`, the Tailwind CLI compiles
`src/styles.css` (which imports the vendored UI kit), and everything, fonts included, is inlined
into `dist/index.html`. The same bundle is the editor and the published player: publishing copies
the running app's HTML and embeds the course as JSON, so what you preview is exactly what learners get.

### Layout

```
Launch.bat, Start.ps1   Windows launcher and PowerShell 5.1 TcpListener static server
dist/                   committed build (index.html, font licences)
src/model/              course types, factories, queries, schema/migration, trigger descriptions
src/engine/runtime.ts   the player engine: pure functions over (course, state), unit-tested in Node
src/store/              undo/redo history, editing operations, IndexedDB + settings persistence
src/render/             SlideView: one renderer for canvas, thumbnails and player
src/player/             learner-facing player
src/editor/             editor shell, canvas, inspector, trigger wizard, timeline, layers, dialogs
src/export/             publishing (HTML, SCORM 1.2 zip) and the LMS runtime adapter
src/ui/                 kit.tsx (React versions of the UI kit patterns), generated Lucide icons
vendor/ui-kit/          FleetHacker UI Kit v0.2.2 (vendored, unmodified)
tests/                  unit tests
tools/                  build, e2e test, icon generator
```

### Updating the UI kit

Copy the new `ui-kit/` folder over `vendor/ui-kit/`, check `VERSION`, rebuild. The kit sits in
`@layer kit` between Tailwind's base and components layers, so app styles refine it without
`!important`.

### Icons

`src/ui/icons.tsx` is generated from Lucide's SVG sources so only used icons ship:
`node tools/gen-icons.mjs <lucide checkout>/icons`.

## Accessibility

Editor and player follow the UI kit rules: landmarks and a skip link, labelled fields, visible
focus rings, native dialogs that trap focus and close on Esc, APG menus and tabs, polite toasts
and `role=alert` errors, destructive confirmations that focus Cancel, AA contrast tokens, forced
colours and reduced motion. In courses, interactive objects are real keyboard targets (buttons,
radios, checkboxes, text fields), images take alt text or a decorative flag, modal layers make the
base layer inert, and the publish check warns about images without alt text.

## Licence

MIT. Bundled fonts (Exo 2, Syne Mono) are under the SIL Open Font License 1.1; see
`vendor/ui-kit/fonts/` and `dist/licenses/`. Icons are from Lucide (ISC).

Scrimshaw is an independent project and is not affiliated with or endorsed by Articulate Global, LLC.
“Storyline” is a trademark of its owner and is used here only to describe compatibility goals.
