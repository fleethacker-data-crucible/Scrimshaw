// Scrimshaw course model. A course is plain JSON: it is saved to IndexedDB, written to
// .scrim files, and embedded in published packages. Bump SCHEMA_VERSION and add a step to
// migrate() in schema.ts whenever a stored shape changes.

export const SCHEMA_VERSION = 1;

export type ID = string;
export type Value = string | number | boolean;

export interface Course {
  schema: number;
  id: ID;
  title: string;
  author: string;
  description: string;
  /** Slide size in CSS pixels; the player scales it to fit. */
  size: { w: number; h: number };
  scenes: Scene[];
  /** Slide master: its base-layer objects are drawn beneath every slide that uses the master.
   *  Never part of the play order. Its objects are display-only (no triggers). */
  master: Slide;
  variables: Variable[];
  /** First slide the player shows. Falls back to the first slide of the first scene. */
  startSlideId: ID | null;
  player: PlayerSettings;
  quiz: QuizSettings;
  /** Embedded media, referenced from objects as src "asset:<id>". Kept out of undo history. */
  assets: Record<ID, Asset>;
  created: string;
  modified: string;
}

export interface Asset {
  id: ID;
  name: string;
  mime: string;
  /** data: URL */
  data: string;
}

export interface PlayerSettings {
  showMenu: boolean;
  showNav: boolean;
  showSeekbar: boolean;
  showTitle: boolean;
  /** Links shown in the player's Resources panel (http, https or mailto). */
  resources: { title: string; url: string }[];
  /** Terms shown in the player's Glossary panel. */
  glossary: { term: string; definition: string }[];
  /** Player chrome accent (buttons, seekbar). Empty: the UI kit default. */
  accent: string;
  /** Free: learners can open any slide from the menu. Restricted: only slides already visited. */
  navigation: 'free' | 'restricted';
  resume: boolean;
}

export interface QuizSettings {
  passPercent: number;
  /** How the LMS hears about completion. */
  reporting: 'passed-failed' | 'completed-incomplete';
  /** When reporting completed-incomplete, the course completes on reaching this slide (or the last slide). */
  completionSlideId: ID | null;
}

export interface Scene {
  id: ID;
  name: string;
  slides: Slide[];
  /** Question bank: shuffle this scene's question slides and/or draw only some of them. Redrawn on retry. */
  bank: { shuffle: boolean; draw: number } | null;
}

export interface Slide {
  id: ID;
  title: string;
  notes: string;
  background: string;
  /** Timeline length in seconds. */
  duration: number;
  /** auto: go to the next slide when the timeline ends. user: wait for the learner. */
  advance: 'auto' | 'user';
  /** layers[0] is the base layer and is always present. */
  layers: Layer[];
  /** Slide-level triggers (timeline, keys, variable changes). */
  triggers: Trigger[];
  question: Question | null;
  /** Whether this slide shows in the player menu. */
  inMenu: boolean;
  /** Draw the slide master's objects beneath this slide. */
  useMaster: boolean;
}

export interface Layer {
  id: ID;
  name: string;
  base: boolean;
  /** When shown, hide every other non-base layer. */
  hideOthers: boolean;
  /** When shown, dim and block the base layer (modal). */
  modal: boolean;
  objects: SlideObject[];
  /** Layer-level triggers (mainly timeline-start / timeline-end of the layer). */
  triggers: Trigger[];
}

export type ObjectKind = 'text' | 'shape' | 'image' | 'button' | 'hotspot' | 'input' | 'choice' | 'video' | 'audio' | 'slider';
export type ShapeKind = 'rect' | 'round' | 'ellipse' | 'triangle' | 'arrow' | 'line';

export interface Style {
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  color: string;
  fontSize: number;
  fontWeight: number;
  fontFamily: 'sans' | 'mono';
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  padding: number;
  opacity: number;
  shadow: boolean;
  lineHeight: number;
}

export type AnimationType = 'none' | 'fade' | 'fly-left' | 'fly-right' | 'fly-up' | 'fly-down' | 'zoom' | 'wipe';
export interface Animation { type: AnimationType; duration: number }

export interface SlideObject {
  id: ID;
  kind: ObjectKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  style: Style;
  /** Text content for text, shape, button, choice; placeholder for input. Supports %Variable% references. */
  text: string;
  shape: ShapeKind;
  /** Image or video: "asset:<id>" for embedded media, or a relative/absolute URL. */
  src: string;
  alt: string;
  /** Hidden from the accessibility tree (decorative). */
  decorative: boolean;
  /** Starts in the Hidden state. */
  initiallyHidden: boolean;
  /** Timeline: seconds from slide start when the object appears. */
  start: number;
  /** Timeline: seconds when it disappears; null = until the end of the slide. */
  end: number | null;
  enter: Animation;
  exit: Animation;
  /** Motion path: a straight move by (dx, dy). Starts at `at` seconds on the timeline, or only when a trigger plays it. */
  motion: { dx: number; dy: number; duration: number; start: 'timeline' | 'trigger'; at: number; easing: 'linear' | 'ease' } | null;
  states: ObjectState[];
  triggers: Trigger[];
  /** input: the text or number variable it writes to. slider: the number variable it controls. */
  variableId: ID | null;
  /** input: a multi-line box (essays). */
  multiline: boolean;
  /** slider: range and step. */
  min: number;
  max: number;
  step: number;
  /** choice: grading info for question slides. */
  correct: boolean;
  /** choice: 'radio' = one answer in the group, 'check' = many. */
  choiceMode: 'radio' | 'check';
  /** Drag and drop: the learner can drag this object onto a drop target. */
  draggable: boolean;
  /** Drag and drop: draggable objects snap onto this one when dropped over it. */
  dropTarget: boolean;
  /** Drag and drop: the drop target this object belongs on, for grading. */
  correctTargetId: ID | null;
  /** video and audio: play when the object appears on the timeline. */
  autoplay: boolean;
  /** video: show the browser controls. audio: show a play/pause button to learners. */
  controls: boolean;
  /** video and audio: start again from the beginning when finished. */
  loop: boolean;
  /** video and audio: WebVTT captions, "asset:<id>" or a URL ('' for none). */
  captions: string;
  locked: boolean;
  /** Objects sharing a group id select and move together in the editor. */
  groupId: ID | null;
  /** Editor only: hidden on the canvas while editing. Ignored by the player. */
  editorHidden: boolean;
}

export const BUILTIN_STATES = ['Normal', 'Hover', 'Down', 'Selected', 'Visited', 'Disabled', 'Hidden'] as const;
export type BuiltinState = (typeof BUILTIN_STATES)[number];

export interface ObjectState {
  id: ID;
  /** One of BUILTIN_STATES or a custom name. "Normal" is never stored: it is the object's own style. */
  name: string;
  style: Partial<Style>;
  /** Replaces the object's text while in this state; null keeps it. */
  text: string | null;
}

export type TriggerEvent =
  | { type: 'click' }
  | { type: 'hover-enter' }
  | { type: 'hover-leave' }
  | { type: 'timeline-start' }
  | { type: 'timeline-end' }
  | { type: 'timeline-reaches'; time: number }
  | { type: 'variable-change'; variableId: ID }
  | { type: 'key'; key: string }
  | { type: 'state-change'; objectId: ID; state: string }
  | { type: 'drop'; targetId: ID | 'any' };

export type VariableOp = 'set' | 'add' | 'subtract' | 'multiply' | 'divide' | 'toggle' | 'assign';

export type Action =
  | { type: 'jump-slide'; slideId: ID }
  | { type: 'next-slide' }
  | { type: 'prev-slide' }
  | { type: 'jump-scene'; sceneId: ID }
  | { type: 'lightbox-slide'; slideId: ID }
  | { type: 'close-lightbox' }
  | { type: 'show-layer'; layerId: ID }
  | { type: 'hide-layer'; layerId: ID | 'this' }
  | { type: 'set-state'; objectId: ID | 'this'; state: string }
  | { type: 'adjust-variable'; variableId: ID; op: VariableOp; value: Value; fromVariableId?: ID | null }
  | { type: 'submit-interaction' }
  | { type: 'reset-results' }
  | { type: 'open-url'; url: string }
  | { type: 'play-motion'; objectId: ID | 'this' }
  | { type: 'reverse-motion'; objectId: ID | 'this' }
  | { type: 'play-media'; objectId: ID }
  | { type: 'pause-media'; objectId: ID }
  | { type: 'pause-timeline' }
  | { type: 'resume-timeline' }
  | { type: 'restart-course' }
  | { type: 'exit-course' };

export type ConditionOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'contains' | 'not-contains' | 'empty' | 'not-empty';

export type Condition =
  | { kind: 'variable'; variableId: ID; op: ConditionOp; value: Value; compareVariableId?: ID | null }
  | { kind: 'state'; objectId: ID; is: boolean; state: string };

export interface Trigger {
  id: ID;
  event: TriggerEvent;
  action: Action;
  conditions: Condition[];
  join: 'and' | 'or';
  enabled: boolean;
}

export type VariableType = 'text' | 'number' | 'boolean';
export interface Variable {
  id: ID;
  name: string;
  type: VariableType;
  initial: Value;
}

export type QuestionKind = 'multiple-choice' | 'multiple-response' | 'true-false' | 'fill-in' | 'drag-drop' | 'hotspot' | 'numeric' | 'essay';

export interface Question {
  kind: QuestionKind;
  points: number;
  /** Attempts allowed. 0 = unlimited. */
  attempts: number;
  /** Graded questions count toward the result; survey questions do not. */
  graded: boolean;
  /** Shuffle the order of choice objects each time the slide opens (choice questions). */
  shuffle: boolean;
  /** fill-in: accepted answers, compared case-insensitively after trimming. */
  accepted: string[];
  /** numeric: the accepted range, inclusive. */
  numMin: number;
  numMax: number;
  /** fill-in and numeric: the input object holding the learner's answer. */
  inputObjectId: ID | null;
  correctLayerId: ID | null;
  incorrectLayerId: ID | null;
  tryAgainLayerId: ID | null;
}

/** Built-in read-only variables the player computes. Usable in text as %Results.ScorePercent% etc. */
export const BUILTIN_VARIABLES = [
  'Results.ScorePoints',
  'Results.MaxPoints',
  'Results.ScorePercent',
  'Results.PassPercent',
  'Results.Passed',
  'Results.Answered',
  'Results.Correct',
  'Project.SlideNumber',
  'Project.TotalSlides',
  'Project.SlideTitle',
  'Project.CourseTitle',
] as const;
