// Inventory of what a person can do in the editor, each mapped to the command that does the same, or to an
// explicit gap with a reason (Fleet CLI parity, rollout step 1 and requirement 8). The parity test reads the File menu
// in src/editor/EditorShell.tsx and fails if a menu label is missing here, so a new GUI action cannot ship unlisted.
// Covers the File menu and the Publish dialog; the in-editor authoring tools (objects, triggers, layers) are
// listed as one gap until their operations in src/store/ops.ts get commands.

export interface GuiAction {
  /** The menu or button label exactly as the editor shows it. */
  label: string;
  where: 'File menu' | 'Publish dialog' | 'Editor';
  /** A command name from the registry, or null for a gap. */
  command: string | null;
  /** Why there is no command yet (required when command is null). */
  gap?: string;
}

export const GUI_ACTIONS: GuiAction[] = [
  { label: 'Projects…', where: 'File menu', command: null, gap: 'Projects live in browser storage (IndexedDB); the CLI works on .scrim files instead.' },
  { label: 'New course', where: 'File menu', command: 'course new' },
  { label: 'Open a .scrim file…', where: 'File menu', command: 'course info' },
  { label: 'Save now', where: 'File menu', command: null, gap: 'Autosave to browser storage; a CLI call writes its --out file directly.' },
  { label: 'Save to file (.scrim)', where: 'File menu', command: null, gap: 'A CLI call reads and writes .scrim files directly, so there is no unsaved state; a command that edits a course in place is the missing piece.' },
  { label: 'Course settings…', where: 'File menu', command: null, gap: 'Needs a "course set" command that edits a .scrim file.' },
  { label: 'Find and replace…', where: 'File menu', command: null, gap: 'Needs a "course replace" command.' },
  { label: 'Storyboard for review (printable HTML)', where: 'File menu', command: null, gap: 'src/export/storyboard.tsx renders with React; needs a string renderer first.' },
  { label: 'Draft with the router…', where: 'File menu', command: null, gap: 'Needs a "course draft" command that calls Fairlead (opt-in, loopback only, key from the environment, never a file); the parsers and converters in src/ai/router.ts are already pure.' },
  { label: 'Export text for translation (.csv)', where: 'File menu', command: 'course export-texts' },
  { label: 'Import translated text (.csv)…', where: 'File menu', command: null, gap: 'Needs a "course import-texts" command (applyTexts exists in src/model/texts.ts).' },
  { label: 'Web (standalone HTML)', where: 'Publish dialog', command: 'course publish' },
  { label: 'SCORM 1.2', where: 'Publish dialog', command: 'course publish' },
  { label: 'SCORM 2004', where: 'Publish dialog', command: 'course publish' },
  { label: 'xAPI', where: 'Publish dialog', command: 'course publish' },
  { label: 'cmi5', where: 'Publish dialog', command: 'course publish' },
  { label: 'Course file (.scrim)', where: 'Publish dialog', command: null, gap: 'Same as Save to file: the .scrim file is already the CLI input.' },
  { label: 'Publish check (problems list)', where: 'Publish dialog', command: 'course validate' },
  { label: 'Authoring: slides, layers, objects, states, triggers, variables, quizzes', where: 'Editor', command: null, gap: 'Operations exist in src/store/ops.ts but have no commands yet; an agent can edit the open .scrim JSON meanwhile.' },
];
