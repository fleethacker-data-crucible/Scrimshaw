# Changelog

## 0.2.0 (2026-10-25)

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
- Fix: find and replace and translation import now report the right count.
- Fix: a click that navigates away now still marks the object Visited for when the learner returns.

## 0.1.0 (2026-10-25)

First version.

- Editor: scenes and slides, canvas with snapping, layers, states, triggers, variables, timeline,
  story view, undo/redo, autosave, keyboard shortcuts, light and dark themes.
- Quizzes: multiple choice, multiple response, true/false, fill in the blank, results slide.
- Player: menu, navigation, seekbar, resume, keyboard-accessible course objects.
- Publishing: SCORM 1.2 zip, standalone HTML, .scrim project files.
- Windows launcher (Launch.bat + Start.ps1, PowerShell 5.1 TcpListener on 127.0.0.1).
- Built on the FleetHacker UI Kit v0.2.2.
