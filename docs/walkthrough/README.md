# Scrimshaw walkthrough

Build an interactive course from slides, triggers and a quiz, preview it, and publish it as SCORM or a web page.

> **Status: skeleton.** The screenshots below are placeholders. Zombie Admin captures them with demo data, and the Chief of Staff scans them for sensitive content before they are added (team directive 10). Until then the image links do not resolve.

## Before you start

- Windows PowerShell 5.1 (part of Windows). No administrator rights and no installer.
- Microsoft Edge or Google Chrome.
- Launch: Double-click `Launch.bat` (or open `dist/index.html` directly in Edge or Chrome).

## Steps

### 1. First launch

Scrimshaw opens on its welcome screen, *Carve a course worth remembering*.

![Scrimshaw welcome screen, Carve a course worth remembering, with the New course and Open sample options.](../assets/walkthrough/01-first-launch.png)

### 2. Open the sample

Select **Open sample**. The editor shows the slide list, the canvas and the Inspector.

![Scrimshaw editor with the sample course open, showing the slide list, slide canvas and Inspector.](../assets/walkthrough/02-sample-course.png)

### 3. Edit an object

Select an object on the canvas and change it in the **Inspector**.

![Scrimshaw editor with a text object selected on the canvas and its properties in the Inspector.](../assets/walkthrough/03-edit-object.png)

### 4. Add a trigger

Triggers are described in plain English. Pick an action, an event and any conditions.

![Scrimshaw trigger editor showing a button trigger described in plain English.](../assets/walkthrough/04-triggers.png)

### 5. Time the slide

The **Timeline** sets when each object appears and disappears.

![Scrimshaw Timeline panel with appear and disappear bars for the objects on the slide.](../assets/walkthrough/05-timeline.png)

### 6. Preview

Preview the course in the player, including the quiz.

![Scrimshaw preview of the sample course quiz slide in the player.](../assets/walkthrough/06-preview.png)

### 7. Publish

**Publish** builds a SCORM 1.2 or 2004, xAPI, cmi5 or web package after checking for broken references and missing alt text.

![Scrimshaw Publish dialog with SCORM 2004 selected and the publish-time checks passing.](../assets/walkthrough/07-publish.png)

## About these images

Images live in [`docs/assets/walkthrough/`](../assets/walkthrough/), named `NN-<screen>.png` after the step they belong to. They are 1440x900 at 100% scale in the Dark theme, and show demo data only.
