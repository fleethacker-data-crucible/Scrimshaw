import {
  SCHEMA_VERSION,
  type Action,
  type Course,
  type ID,
  type Layer,
  type ObjectKind,
  type Question,
  type QuestionKind,
  type Scene,
  type Slide,
  type SlideObject,
  type Style,
  type Trigger,
  type TriggerEvent,
  type Variable,
  type VariableType,
} from './types.ts';

let counter = 0;
/** Short, sortable, collision-resistant ids. */
export function uid(prefix = ''): ID {
  counter = (counter + 1) % 1679616;
  const rand = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return prefix + Date.now().toString(36) + counter.toString(36).padStart(4, '0') + rand;
}

export const SLIDE_W = 960;
export const SLIDE_H = 540;

/** Colours here are slide content, not app chrome, so they are literal values the author edits. */
export const PALETTE = ['#ffffff', '#1a1a19', '#2f74c8', '#e8c15a', '#287a4c', '#c93b3b', '#b38ae6', '#f08a3c', '#9a988f', '#f4f4f2'];

export function baseStyle(over: Partial<Style> = {}): Style {
  return {
    fill: 'transparent', stroke: 'transparent', strokeWidth: 0, radius: 0,
    color: '#1a1a19', fontSize: 20, fontWeight: 400, fontFamily: 'sans', italic: false, underline: false,
    align: 'left', valign: 'top', padding: 8, opacity: 1, shadow: false, lineHeight: 1.35,
    ...over,
  };
}

const KIND_DEFAULTS: Record<ObjectKind, () => Partial<SlideObject>> = {
  text: () => ({ name: 'Text', w: 360, h: 60, text: 'Double-click to edit text', style: baseStyle() }),
  shape: () => ({ name: 'Rectangle', w: 200, h: 120, text: '', shape: 'rect', style: baseStyle({ fill: '#2f74c8', color: '#ffffff', align: 'center', valign: 'middle' }) }),
  image: () => ({ name: 'Image', w: 320, h: 200, style: baseStyle({ padding: 0 }) }),
  button: () => ({
    name: 'Button', w: 160, h: 48, text: 'Continue', shape: 'round',
    style: baseStyle({ fill: '#2f74c8', color: '#ffffff', radius: 6, fontWeight: 600, fontSize: 18, align: 'center', valign: 'middle' }),
  }),
  hotspot: () => ({ name: 'Hotspot', w: 160, h: 120, style: baseStyle({ padding: 0 }) }),
  input: () => ({
    name: 'Text entry', w: 360, h: 48, text: 'Type your answer',
    style: baseStyle({ fill: '#ffffff', stroke: '#7a7872', strokeWidth: 1, radius: 4, fontSize: 18, valign: 'middle' }),
  }),
  choice: () => ({ name: 'Choice', w: 560, h: 44, text: 'Answer option', style: baseStyle({ fontSize: 18, valign: 'middle' }) }),
  video: () => ({ name: 'Video', w: 480, h: 270, controls: true, style: baseStyle({ fill: '#000000', padding: 0 }) }),
  slider: () => ({ name: 'Slider', w: 360, h: 40, min: 0, max: 10, step: 1, style: baseStyle({ fill: '#2f74c8', padding: 0 }) }),
  audio: () => ({ name: 'Audio', w: 48, h: 48, autoplay: true, controls: false, style: baseStyle({ fill: '#2f74c8', color: '#ffffff', radius: 24, padding: 0, align: 'center', valign: 'middle' }) }),
};

export function newObject(kind: ObjectKind, over: Partial<SlideObject> = {}): SlideObject {
  const d = KIND_DEFAULTS[kind]();
  const o: SlideObject = {
    id: uid('o'), kind, name: kind, x: 80, y: 80, w: 200, h: 100, rotation: 0,
    style: baseStyle(), text: '', shape: 'rect', src: '', alt: '', decorative: false,
    initiallyHidden: false, start: 0, end: null,
    enter: { type: 'none', duration: 0.5 }, exit: { type: 'none', duration: 0.5 },
    states: [], triggers: [], variableId: null, min: 0, max: 10, step: 1, correct: false, choiceMode: 'radio',
    draggable: false, dropTarget: false, correctTargetId: null,
    autoplay: false, controls: true, loop: false, locked: false, editorHidden: false,
    ...d,
    ...over,
  };
  if (kind === 'button' && !over.states) {
    o.states = [
      { id: uid('st'), name: 'Hover', style: { fill: '#3f85d9' }, text: null },
      { id: uid('st'), name: 'Down', style: { fill: '#245c9f' }, text: null },
      { id: uid('st'), name: 'Disabled', style: { fill: '#9a988f', opacity: 0.6 }, text: null },
    ];
  }
  if (kind === 'choice' && !over.states) {
    o.states = [{ id: uid('st'), name: 'Selected', style: { fontWeight: 600 }, text: null }];
  }
  return o;
}

export function newLayer(name: string, base = false): Layer {
  return { id: uid('l'), name, base, hideOthers: true, modal: false, objects: [], triggers: [] };
}

export function newSlide(title = 'Untitled slide', over: Partial<Slide> = {}): Slide {
  return {
    id: uid('s'), title, notes: '', background: '#ffffff', duration: 5, advance: 'user',
    layers: [newLayer('Base layer', true)], triggers: [], question: null, inMenu: true,
    ...over,
  };
}

export function newScene(name = 'Scene', slides: Slide[] = [newSlide()]): Scene {
  return { id: uid('sc'), name, slides, bank: null };
}

export function newTrigger(event: TriggerEvent, action: Action, over: Partial<Trigger> = {}): Trigger {
  return { id: uid('t'), event, action, conditions: [], join: 'and', enabled: true, ...over };
}

export function newVariable(name: string, type: VariableType, initial?: Variable['initial']): Variable {
  const init = initial ?? (type === 'number' ? 0 : type === 'boolean' ? false : '');
  return { id: uid('v'), name, type, initial: init };
}

export function newCourse(title = 'Untitled course'): Course {
  const now = new Date().toISOString();
  const first = newSlide('Title slide');
  first.layers[0].objects.push(
    newObject('text', { name: 'Title', x: 80, y: 190, w: 800, h: 80, text: title, style: baseStyle({ fontSize: 44, fontWeight: 600, align: 'center' }) }),
    newObject('text', { name: 'Subtitle', x: 80, y: 280, w: 800, h: 50, text: 'Add a subtitle', style: baseStyle({ fontSize: 22, color: '#52514e', align: 'center' }) }),
  );
  return {
    schema: SCHEMA_VERSION, id: uid('c'), title, author: '', description: '',
    size: { w: SLIDE_W, h: SLIDE_H },
    scenes: [newScene('Scene 1', [first])],
    variables: [],
    startSlideId: null,
    player: { showMenu: true, showNav: true, showSeekbar: true, showTitle: true, accent: '', navigation: 'free', resume: true },
    quiz: { passPercent: 80, reporting: 'passed-failed', completionSlideId: null },
    assets: {},
    created: now, modified: now,
  };
}

function feedbackLayer(name: string, message: string, color: string, action: Action, buttonText: string): Layer {
  const layer = newLayer(name);
  layer.hideOthers = true;
  layer.modal = true;
  const box = newObject('shape', {
    name: `${name} box`, x: 230, y: 150, w: 500, h: 240, shape: 'round',
    style: baseStyle({ fill: '#ffffff', stroke: color, strokeWidth: 3, radius: 10, shadow: true }),
  });
  const text = newObject('text', {
    name: `${name} message`, x: 260, y: 185, w: 440, h: 90, text: message,
    style: baseStyle({ fontSize: 26, fontWeight: 600, color, align: 'center', valign: 'middle' }),
  });
  const btn = newObject('button', { name: buttonText, x: 400, y: 300, w: 160, h: 48, text: buttonText });
  btn.triggers.push(newTrigger({ type: 'click' }, action));
  layer.objects.push(box, text, btn);
  return layer;
}

/** A complete question slide in the style of Storyline's form-based questions. */
export function newQuestionSlide(kind: QuestionKind): Slide {
  const titles: Record<QuestionKind, string> = {
    'multiple-choice': 'Multiple choice', 'multiple-response': 'Multiple response',
    'true-false': 'True / false', 'fill-in': 'Fill in the blank', 'drag-drop': 'Drag and drop',
  };
  const slide = newSlide(titles[kind]);
  const base = slide.layers[0];
  base.objects.push(newObject('text', {
    name: 'Question', x: 60, y: 40, w: 840, h: 80,
    text: kind === 'true-false' ? 'Enter a statement the learner judges true or false.'
      : kind === 'fill-in' ? 'Enter the question. The learner types the answer.'
      : kind === 'drag-drop' ? 'Drag each item onto where it belongs.' : 'Enter the question.',
    style: baseStyle({ fontSize: 26, fontWeight: 600 }),
  }));
  const q: Question = {
    kind, points: 10, attempts: 1, graded: true, shuffle: false, accepted: [], inputObjectId: null,
    correctLayerId: null, incorrectLayerId: null, tryAgainLayerId: null,
  };
  if (kind === 'drag-drop') {
    ['Item A', 'Item B', 'Item C'].forEach((label, i) => {
      const target = newObject('shape', {
        name: `Target ${i + 1}`, x: 400, y: 140 + i * 100, w: 500, h: 80, shape: 'round', text: `Target ${i + 1}`, dropTarget: true,
        style: baseStyle({ fill: '#f4f4f2', stroke: '#9a988f', strokeWidth: 2, radius: 8, color: '#52514e', align: 'left', valign: 'middle', padding: 14, fontSize: 18 }),
      });
      const item = newObject('shape', {
        name: label, x: 60, y: 150 + i * 100, w: 180, h: 60, shape: 'round', text: label, draggable: true, correctTargetId: target.id,
        style: baseStyle({ fill: '#2f74c8', color: '#ffffff', radius: 8, fontWeight: 600, align: 'center', valign: 'middle' }),
      });
      base.objects.push(target, item);
    });
  } else if (kind === 'fill-in') {
    const input = newObject('input', { name: 'Answer entry', x: 60, y: 160, w: 480, h: 52 });
    base.objects.push(input);
    q.inputObjectId = input.id;
    q.accepted = ['answer'];
  } else {
    const labels = kind === 'true-false' ? ['True', 'False'] : ['Option A', 'Option B', 'Option C', 'Option D'];
    const mode = kind === 'multiple-response' ? 'check' : 'radio';
    labels.forEach((label, i) => {
      base.objects.push(newObject('choice', {
        name: `Choice ${i + 1}`, x: 60, y: 150 + i * 60, w: 700, h: 48, text: label,
        choiceMode: mode, correct: i === 0,
      }));
    });
  }
  const submit = newObject('button', { name: 'Submit', x: 740, y: 450, w: 160, h: 48, text: 'Submit' });
  submit.triggers.push(newTrigger({ type: 'click' }, { type: 'submit-interaction' }));
  base.objects.push(submit);

  const correct = feedbackLayer('Correct', "That's right!", '#287a4c', { type: 'next-slide' }, 'Continue');
  const incorrect = feedbackLayer('Incorrect', "That's not quite right.", '#c93b3b', { type: 'next-slide' }, 'Continue');
  const tryAgain = feedbackLayer('Try again', 'Not quite. Try again.', '#8a6d0c', { type: 'hide-layer', layerId: 'this' }, 'Try again');
  slide.layers.push(correct, incorrect, tryAgain);
  q.correctLayerId = correct.id;
  q.incorrectLayerId = incorrect.id;
  q.tryAgainLayerId = tryAgain.id;
  slide.question = q;
  return slide;
}

export function newResultsSlide(): Slide {
  const slide = newSlide('Results');
  slide.inMenu = true;
  const base = slide.layers[0];
  base.objects.push(
    newObject('text', { name: 'Heading', x: 80, y: 60, w: 800, h: 70, text: 'Your results', style: baseStyle({ fontSize: 40, fontWeight: 600, align: 'center' }) }),
    newObject('text', {
      name: 'Score', x: 180, y: 160, w: 600, h: 140,
      text: 'You scored %Results.ScorePercent%% (%Results.ScorePoints% of %Results.MaxPoints% points).\nPassing score: %Results.PassPercent%%',
      style: baseStyle({ fontSize: 24, align: 'center', valign: 'middle' }),
    }),
  );
  const pass = newLayer('Passed');
  pass.objects.push(newObject('text', { name: 'Passed message', x: 180, y: 320, w: 600, h: 60, text: 'Congratulations, you passed!', style: baseStyle({ fontSize: 28, fontWeight: 600, color: '#287a4c', align: 'center' }) }));
  const fail = newLayer('Failed');
  const failText = newObject('text', { name: 'Failed message', x: 180, y: 320, w: 600, h: 60, text: 'You did not pass this time.', style: baseStyle({ fontSize: 28, fontWeight: 600, color: '#c93b3b', align: 'center' }) });
  const retry = newObject('button', { name: 'Retry quiz', x: 400, y: 400, w: 160, h: 48, text: 'Retry quiz' });
  retry.triggers.push(newTrigger({ type: 'click' }, { type: 'reset-results' }));
  fail.objects.push(failText, retry);
  slide.layers.push(pass, fail);
  slide.triggers.push(
    newTrigger({ type: 'timeline-start' }, { type: 'show-layer', layerId: pass.id }, {
      conditions: [{ kind: 'variable', variableId: 'Results.Passed', op: '==', value: true }],
    }),
    newTrigger({ type: 'timeline-start' }, { type: 'show-layer', layerId: fail.id }, {
      conditions: [{ kind: 'variable', variableId: 'Results.Passed', op: '==', value: false }],
    }),
  );
  return slide;
}

/** The starter course shown on first run: it exercises layers, states, triggers, variables and a quiz. */
export function sampleCourse(): Course {
  const c = newCourse('Scrimshaw: a sailor’s craft');
  c.author = 'Scrimshaw';
  c.description = 'A short sample course that shows slides, layers, states, triggers, variables and a quiz.';
  const name = newVariable('LearnerName', 'text', '');
  const explored = newVariable('ToolsExplored', 'number', 0);
  c.variables.push(name, explored);

  const title = c.scenes[0].slides[0];
  title.background = '#0f2236';
  title.layers[0].objects[0].text = 'Scrimshaw';
  title.layers[0].objects[0].style.color = '#ffffff';
  title.layers[0].objects[0].enter = { type: 'fade', duration: 0.8 };
  title.layers[0].objects[1].text = 'The art sailors carved during long voyages';
  title.layers[0].objects[1].style.color = '#e8c15a';
  title.layers[0].objects[1].start = 0.6;
  title.layers[0].objects[1].enter = { type: 'fly-up', duration: 0.6 };
  const nameIn = newObject('input', { name: 'Name entry', x: 300, y: 370, w: 360, h: 48, text: 'Your first name', variableId: name.id });
  const start = newObject('button', { name: 'Start', x: 400, y: 440, w: 160, h: 48, text: 'Start', start: 1 });
  start.triggers.push(newTrigger({ type: 'click' }, { type: 'next-slide' }));
  title.layers[0].objects.push(nameIn, start);

  const tools = newSlide('Tools of the trade');
  tools.layers[0].objects.push(
    newObject('text', { name: 'Heading', x: 60, y: 30, w: 840, h: 60, text: 'Welcome aboard, %LearnerName%. Click each tool.', style: baseStyle({ fontSize: 28, fontWeight: 600 }) }),
    newObject('text', { name: 'Counter', x: 60, y: 470, w: 500, h: 40, text: 'Tools explored: %ToolsExplored% of 3', style: baseStyle({ fontSize: 18, color: '#52514e' }) }),
  );
  const toolInfo: [string, string][] = [
    ['Needle', 'A sail needle or knife scratched the design into the surface.'],
    ['Ink', 'Soot or lamp-black was rubbed into the lines so they stood out.'],
    ['Tooth', 'Sperm whale teeth and bone were the usual canvas.'],
  ];
  toolInfo.forEach(([label, info], i) => {
    const layer = newLayer(label);
    layer.objects.push(
      newObject('shape', { name: `${label} card`, x: 520, y: 130, w: 380, h: 280, shape: 'round', style: baseStyle({ fill: '#f4f4f2', stroke: '#dddcd6', strokeWidth: 1, radius: 10 }) }),
      newObject('text', { name: `${label} title`, x: 545, y: 150, w: 330, h: 50, text: label, style: baseStyle({ fontSize: 26, fontWeight: 600 }) }),
      newObject('text', { name: `${label} info`, x: 545, y: 205, w: 330, h: 180, text: info, style: baseStyle({ fontSize: 19 }), enter: { type: 'fade', duration: 0.4 } }),
    );
    tools.layers.push(layer);
    const btn = newObject('button', { name: `${label} button`, x: 60, y: 130 + i * 90, w: 380, h: 64, text: label });
    btn.states.push({ id: uid('st'), name: 'Visited', style: { fill: '#287a4c' }, text: `${label} ✓` });
    btn.triggers.push(
      newTrigger({ type: 'click' }, { type: 'adjust-variable', variableId: explored.id, op: 'add', value: 1 }, {
        conditions: [{ kind: 'state', objectId: btn.id, is: false, state: 'Visited' }],
      }),
      newTrigger({ type: 'click' }, { type: 'show-layer', layerId: layer.id }),
    );
    tools.layers[0].objects.push(btn);
  });
  const next = newObject('button', { name: 'Next', x: 740, y: 460, w: 160, h: 48, text: 'Next', initiallyHidden: true });
  next.triggers.push(newTrigger({ type: 'click' }, { type: 'next-slide' }));
  tools.layers[0].objects.push(next);
  tools.triggers.push(newTrigger({ type: 'variable-change', variableId: explored.id }, { type: 'set-state', objectId: next.id, state: 'Normal' }, {
    conditions: [{ kind: 'variable', variableId: explored.id, op: '>=', value: 3 }],
  }));

  const quizScene = newScene('Knowledge check', []);
  const q1 = newQuestionSlide('multiple-choice');
  q1.title = 'What was scrimshaw carved on?';
  q1.layers[0].objects[0].text = 'What was scrimshaw usually carved on?';
  const q1Choices = q1.layers[0].objects.filter((o) => o.kind === 'choice');
  ['Whale teeth and bone', 'Driftwood', 'Sailcloth', 'Copper plates'].forEach((t, i) => { q1Choices[i].text = t; q1Choices[i].correct = i === 0; });
  const q2 = newQuestionSlide('true-false');
  q2.title = 'Ink in the lines';
  q2.layers[0].objects[0].text = 'Sailors rubbed soot or ink into the carved lines to make them visible.';
  const q3 = newQuestionSlide('drag-drop');
  q3.title = 'Match each tool';
  q3.layers[0].objects[0].text = 'Drag each tool onto its job.';
  const jobs = ['Carves the design', 'Darkens the lines', 'The surface it is carved on'];
  const tools3 = ['Needle', 'Ink', 'Tooth'];
  const t3 = q3.layers[0].objects.filter((o) => o.dropTarget);
  const i3 = q3.layers[0].objects.filter((o) => o.draggable);
  t3.forEach((t, i) => { t.text = jobs[i]; t.name = `Job: ${jobs[i]}`; });
  i3.forEach((it, i) => { it.text = tools3[i]; it.name = `Tool: ${tools3[i]}`; });
  q3.question!.shuffle = true;
  const results = newResultsSlide();
  quizScene.slides.push(q1, q2, q3, results);
  c.scenes[0].slides.push(tools);
  c.scenes.push(quizScene);
  c.quiz.completionSlideId = results.id;
  return c;
}
