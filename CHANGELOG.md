# Changelog

## 0.2.0 (2026-10-25)

Fixes from an independent code review:

- LMS completion waits for the last question to be answered, and a changed result (after a retry) is reported again.
- Copied slides, layers and objects keep working drag-and-drop targets.
- Autoplay audio and video now start on every slide, not only the first.
- Each layer has its own running timeline: delayed layer objects appear and layer timeline triggers fire.
- Undo restores theme colours.
- Malformed or hand-edited course files load safely instead of crashing.
- Dragging a slide later in the same scene lands where it was dropped.
- A "pause timeline" trigger no longer leaves the next slide paused.
- Drag and drop works by touch.
- Hovers no longer commit to the LMS; progress is sent only when it changes.
- Deleting objects or layers removes the triggers, conditions and answers that pointed at them.
- Player: no `role=application` (screen-reader browse mode works); focus moves to the new slide on navigation.
- Local server: idle browser preconnect sockets no longer stall page loads.

- Drag and drop: draggable objects, drop targets, keyboard support, `drop` trigger event, graded question type.
- Question banks per scene (shuffle and/or draw N, redrawn on retry) and shuffled answers.
- SCORM 2004 3rd Edition publishing; session time reported for 1.2 and 2004.
- xAPI (Tin Can) publishing: statements per attempt, answer and result; resume through the State API.
- Audio objects, media looping, exit animations.
- Sliders bound to number variables.
- Find and replace; translation export/import as CSV.
- Player accent colour with an AA contrast check.
- Objects list in the inspector for keyboard selection.
- Grouping (Ctrl+G), story view arrows.
- Hotspot and numeric question types.
- Inline text formatting: bold, italic, underline, strike, links, bullets.
- Player Resources and Glossary panels.
- Lightbox slides.
- Essay (survey) question type, multi-line text entry.
- Copy and paste formatting (Ctrl+Alt+C / V), Ctrl+wheel zoom.
- WebVTT captions for video and audio.
- Fix: the published player now fits phone screens (no clipped Next button or slide).
- Slide master: shared display objects under every slide, with a per-slide opt-out.
- Motion paths (straight line), played on the timeline or by triggers, reversible.
- Printable storyboard export for review and sign-off.
- cmi5 publishing.
- Player logo.
- Likert scale survey, sequence and word bank question templates.
- Right-click menu on the canvas.
- Optional learner Notes panel.
- Theme colours: course swatches; changing one recolours every object that uses it.
- Import slides from PowerPoint (.pptx): text, bullets, pictures, backgrounds, speaker notes.
- Fix: find and replace and translation import now report the right count.
- Fix: a click that navigates away now still marks the object Visited for when the learner returns.

- Logo: brand files in `docs/brand/`, the emblem as the browser-tab icon and in the Projects dialog, and the full logo on the README.

### Fixes from the second review

- Layer timelines start with the layer when a slide's timeline-start triggers show it.
- Timeline cues from a slide that was just left no longer fire on the next slide.
- Motion paths animate on the first play instead of jumping to the end.
- PowerPoint placeholders without their own position take it from the slide layout or master
  (and fall back to standard title and content areas) instead of being dropped.
- cmi5: completed and passed are sent once per registration (remembered across sessions); a failed
  retry can still be followed by passed; answer statements use the LMS context template.
- Hotspot questions with several correct areas accept a click on any one of them.
- Resuming rebuilds the play order when a republished course has gained slides.
- Closing a lightbox returns to the slide underneath as it was: layers, states and timeline position,
  without running its timeline-start triggers again.
- Courses with no graded questions report completion only (SCORM mastery score and cmi5 moveOn).
- Duplicating a layer points its triggers at the copied objects.
- Arrow keys and Delete inside an open menu no longer act on the canvas.
- Dragging a theme colour picker recolours once, when it closes, so passing colours can't capture
  other objects.
- Quiz settings are validated when a file is opened; a missing completion slide falls back to the last slide.

## 0.1.0 (2026-10-25)

First version.

- Editor: scenes and slides, canvas with snapping, layers, states, triggers, variables, timeline,
  story view, undo/redo, autosave, keyboard shortcuts, light and dark themes.
- Quizzes: multiple choice, multiple response, true/false, fill in the blank, results slide.
- Player: menu, navigation, seekbar, resume, keyboard-accessible course objects.
- Publishing: SCORM 1.2 zip, standalone HTML, .scrim project files.
- Windows launcher (Launch.bat + Start.ps1, PowerShell 5.1 TcpListener on 127.0.0.1).
- Built on the FleetHacker UI Kit v0.2.2.
