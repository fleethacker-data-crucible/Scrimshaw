# Scrimshaw author guide

This guide walks through building an interactive course. Open the sample course (File › Projects ›
Open the sample course) beside it: every idea below appears there.

## The pieces

| Piece | What it is | Where |
| --- | --- | --- |
| **Scene** | A group of slides, such as a chapter or a quiz | Slides panel, scene headings |
| **Slide** | One screen. Has a timeline, layers and triggers | Slides panel |
| **Layer** | A set of objects on a slide that can be shown and hidden, such as a pop-up or feedback | Layers panel (bottom right) |
| **Object** | Text, shape, image, video, audio, button, hotspot, text entry, choice or slider | Insert ribbon |
| **State** | A look an object can switch to: Hover, Down, Visited, Selected, Disabled, Hidden or your own | Inspector › States |
| **Trigger** | “Do this action when this happens, if these conditions hold” | Inspector › Triggers |
| **Variable** | A value the course remembers: text, number or true/false | Ribbon › Variables |
| **Slide master** | Objects drawn under every slide: a logo, a footer, slide numbers | Top of the Slides panel |

## Building a slide

1. **Insert objects** from the ribbon. Drag to move, drag handles to resize (Shift keeps the shape),
   drag the round handle to rotate (Shift snaps to 15°). Pink guides show when edges and centres line up.
2. **Edit text** by double-clicking it. Format inline: `**bold**`, `*italic*`, `__underline__`,
   `~~strike~~`, `[a link](https://example.com)`, and lines starting `- ` become bullets.
   Ctrl+B, Ctrl+I and Ctrl+U wrap the selected text for you.
3. **Show variables** in any text with `%Name%`. Built-ins include `%Results.ScorePercent%`,
   `%Project.SlideNumber%` and `%Project.TotalSlides%`.
4. **Time it** in the timeline: drag a bar to change when an object appears, drag its ends to trim it,
   and drag the gold line to change the slide's length. Entrance, exit animations and motion paths
   are in Inspector › Timing.

## Making it interactive

Every interaction is a trigger. Select an object, open **Triggers** and choose **New trigger**:

- **Action**: what happens (show a layer, change a state, jump to a slide, set a variable, play media…).
- **When**: the event (user clicks, timeline starts or ends, a variable changes, the user drops an item…).
- **Conditions** (optional): only when, say, `Score is greater than 70` or `Button is not Visited`.

Triggers run top to bottom; an action that moves to another slide stops the ones below it. A few
patterns from the sample course:

| Pattern | How |
| --- | --- |
| Click-to-reveal | A layer per item; each button's trigger shows its layer. Layers hide each other by default. |
| Count what was explored | On click, “Add 1 to Explored” if “this button is not Visited”. Give the button a Visited state. |
| Unlock Next | Make Next start hidden (States tab). A slide trigger “when Explored changes, if Explored ≥ 3” changes Next to Normal. |
| Pop-up | A layer with “Dim and block the base layer”; its Close button runs “Hide this layer”. |
| Side trip | “Open slide as a lightbox” shows another slide over this one; Close returns. |

## Quizzes

Insert a question slide from **Slide ▾**: multiple choice, multiple response, true/false, fill in the
blank, drag and drop, hotspot, numeric, essay or a Likert scale. Each comes with a Submit button and
Correct, Incorrect and Try again layers. In the slide's **Question** tab set points, attempts, shuffling
and the correct answers.

- **Results slide**: shows the score and a Passed or Failed layer; Retry quiz resets every question.
- **Question bank**: a scene's ⋯ menu › Question bank… shuffles its questions and/or draws a few at random
  for each attempt.
- **Passing score and reporting**: File › Course settings.

## Checking and publishing

- **Preview** (F5 from the current slide, Shift+F5 from the start) runs the real player.
- **Story view** (the flow icon in the top bar) shows where every slide's triggers lead.
- **Publish** checks for broken triggers, questions without answers, images without alt text and media
  without captions, then builds:

| Output | Use it for |
| --- | --- |
| SCORM 1.2 zip | Most LMSs. Reports completion, pass/fail, score and time; resumes where the learner left off. |
| SCORM 2004 zip | LMSs that prefer SCORM 2004 (3rd Edition). |
| xAPI (Tin Can) or cmi5 zip | LMSs with a learning record store. Sends a statement for each answer. |
| Web page | One HTML file: a file share, an intranet page, or email. Works offline. |
| Storyboard | A printable review copy with every slide, layer, trigger, answer and note. |

Test SCORM packages in your LMS's preview or in [SCORM Cloud](https://cloud.scorm.com) before release.

## Saving and sharing

Projects save automatically in your browser. Use **File › Save to file** for a `.scrim` backup to
move between computers or share with another author, and **File › Open a .scrim file** to load one.
For translation, **File › Export text for translation** writes a CSV; fill in its *translation* column
and import it back.

## Accessibility checklist

- Give every image alt text, or mark it decorative.
- Add captions (.vtt) to video and audio with speech.
- Keep text contrast at 4.5:1 or more; the course settings warn if the player accent fails.
- Learners can reach every button, choice and draggable item with Tab and use it with Enter or Space;
  drag and drop works with Enter on the item, then Enter on a target.
- Animations are skipped for learners who prefer reduced motion.
