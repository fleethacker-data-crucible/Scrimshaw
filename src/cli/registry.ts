// The command registry (Fleet CLI parity proposal, requirements 2, 3, 5, 7 and 8; issue 14, "Shared ground").
// Each command is written once, as a pure function over text and an `io` object, so the CLI, a future loopback API
// and an MCP server can all call the same thing. `scrimshaw commands --json` prints this registry; the parity test
// (tests/cli.test.ts) fails when a File-menu action has no entry in gui-actions.ts, when an entry names a command that
// does not exist, or when a command has no runnable example.
import { newCourse } from '../model/factory.ts';
import { validateCourse } from '../model/describe.ts';
import { allSlides } from '../model/query.ts';
import { parseCourse, serializeCourse } from '../model/schema.ts';
import { textsToCsv } from '../model/texts.ts';
import { buildPlayerHtml, buildScormZip, buildXapiZip } from '../export/publish.ts';

/** Version of the JSON every command prints. Bump when a field is removed or changes meaning. */
export const OUTPUT_SCHEMA = 1;

export interface CliIo {
  readText(path: string): string;
  exists(path: string): boolean;
  writeFile(path: string, data: string | Uint8Array): void;
}

export interface ArgDef { name: string; kind: 'positional' | 'option' | 'flag'; required?: boolean; description: string; values?: string[]; default?: string }
export type Args = Record<string, string | boolean>;
export interface CommandResult { data: Record<string, unknown>; /** 0 by default; 2 when the command found problems in the course. */ exit?: number }

export class CliError extends Error {
  readonly code: string;
  readonly exit: number;
  constructor(code: string, message: string, exit = 1) { super(message); this.code = code; this.exit = exit; }
}

export interface CommandDef {
  /** `<noun> <verb>` (the app name is the program). */
  name: string;
  summary: string;
  args: ArgDef[];
  /** Fields of `data` in the JSON output, by name. */
  output: Record<string, string>;
  /** Writes a file: honours --dry-run and refuses to replace a file without --yes. */
  writes: boolean;
  /** A runnable argv (after the command name) that the parity test executes against fixtures. */
  example: string[];
  run(args: Args, io: CliIo): Promise<CommandResult> | CommandResult;
}

const OUT: ArgDef = { name: 'out', kind: 'option', required: true, description: 'File to write (UTF-8, no BOM).' };
const FILE: ArgDef = { name: 'file', kind: 'positional', required: true, description: 'A .scrim course file.' };
const YES: ArgDef = { name: 'yes', kind: 'flag', description: 'Replace --out if it already exists.' };
const DRY: ArgDef = { name: 'dry-run', kind: 'flag', description: 'Say what would be written and write nothing.' };

function load(args: Args, io: CliIo) {
  const path = String(args.file);
  if (!io.exists(path)) throw new CliError('not-found', `File not found: ${path}`);
  try { return parseCourse(io.readText(path)); } catch (e) { throw new CliError('bad-course', (e as Error).message); }
}

function writeOut(args: Args, io: CliIo, data: string | Uint8Array): Record<string, unknown> {
  const out = String(args.out);
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
  if (args['dry-run']) return { out, bytes, written: false };
  if (io.exists(out) && !args.yes) throw new CliError('exists', `${out} already exists. Pass --yes to replace it.`);
  io.writeFile(out, data);
  return { out, bytes, written: true };
}

const FORMATS = ['html', 'scorm12', 'scorm2004', 'xapi', 'cmi5'];

export const COMMANDS: CommandDef[] = [
  {
    name: 'commands', summary: 'List every command with its inputs and outputs.', args: [],
    output: { commands: 'array of {name, summary, args, output, writes}' }, writes: false, example: [],
    run: () => ({ data: { commands: describeCommands() } }),
  },
  {
    name: 'course new', summary: 'Create an empty course file.',
    args: [{ name: 'title', kind: 'option', description: 'Course title.', default: 'Untitled course' }, OUT, YES, DRY],
    output: { out: 'path written', bytes: 'size', written: 'false for --dry-run', title: 'course title' }, writes: true, example: ['--title', 'Demo', '--out', 'new.scrim'],
    run: (a, io) => {
      const title = typeof a.title === 'string' && a.title.trim() ? a.title.trim() : 'Untitled course';
      return { data: { title, ...writeOut(a, io, serializeCourse(newCourse(title))) } };
    },
  },
  {
    name: 'course info', summary: 'Count the scenes, slides, questions and media in a course.', args: [FILE],
    output: { title: 'course title', scenes: 'count', slides: 'count', questions: 'count of question slides', graded: 'count of graded questions', assets: 'count of embedded media', variables: 'count' }, writes: false, example: ['demo.scrim'],
    run: (a, io) => {
      const c = load(a, io);
      const slides = allSlides(c);
      return { data: { title: c.title, scenes: c.scenes.length, slides: slides.length, questions: slides.filter((s) => s.question).length, graded: slides.filter((s) => s.question?.graded).length, assets: Object.keys(c.assets).length, variables: c.variables.length } };
    },
  },
  {
    name: 'course validate', summary: 'List problems that would break playback (the Publish dialog check). Exit code 2 when there are any.', args: [FILE],
    output: { valid: 'true when no problems', problems: 'array of text' }, writes: false, example: ['demo.scrim'],
    run: (a, io) => {
      const problems = validateCourse(load(a, io));
      return { data: { valid: problems.length === 0, problems }, exit: problems.length ? 2 : 0 };
    },
  },
  {
    name: 'course export-texts', summary: 'Export every text for translation as CSV with stable keys.', args: [FILE, OUT, YES, DRY],
    output: { out: 'path written', bytes: 'size', written: 'false for --dry-run' }, writes: true, example: ['demo.scrim', '--out', 'texts.csv'],
    run: (a, io) => ({ data: writeOut(a, io, textsToCsv(load(a, io))) }),
  },
  {
    name: 'course publish', summary: 'Build a standalone player or an LMS package from a course. Uses the built app in dist/index.html as the shell.',
    args: [FILE, { name: 'format', kind: 'option', required: true, description: 'Package type.', values: FORMATS }, OUT,
      { name: 'shell', kind: 'option', description: 'The built app to use as the shell.', default: 'dist/index.html' }, YES, DRY],
    output: { format: 'package type', out: 'path written', bytes: 'size', written: 'false for --dry-run' }, writes: true, example: ['demo.scrim', '--format', 'html', '--out', 'demo.html', '--shell', 'shell.html'],
    run: async (a, io) => {
      const c = load(a, io);
      const format = String(a.format);
      if (!FORMATS.includes(format)) throw new CliError('usage', `--format must be one of ${FORMATS.join(', ')}.`, 64);
      const shellPath = typeof a.shell === 'string' ? a.shell : 'dist/index.html';
      if (!io.exists(shellPath)) throw new CliError('no-shell', `The built app was not found at ${shellPath}. Run npm run build, or pass --shell.`);
      const shell = io.readText(shellPath);
      if (!shell.includes('<title>')) throw new CliError('no-shell', `${shellPath} does not look like the built app.`);
      let data: string | Uint8Array;
      if (format === 'html') data = buildPlayerHtml(c, shell);
      else {
        const blob = format === 'scorm12' ? await buildScormZip(c, shell) : format === 'scorm2004' ? await buildScormZip(c, shell, '2004')
          : await buildXapiZip(c, shell, format === 'cmi5' ? 'cmi5' : 'tincan');
        data = new Uint8Array(await blob.arrayBuffer());
      }
      return { data: { format, ...writeOut(a, io, data) } };
    },
  },
];

export function describeCommands() {
  return COMMANDS.map(({ name, summary, args, output, writes }) => ({ name, summary, args, output, writes }));
}

export function findCommand(words: string[]): { def: CommandDef; rest: string[] } | null {
  for (const n of [2, 1]) {
    const def = COMMANDS.find((c) => c.name === words.slice(0, n).join(' '));
    if (def) return { def, rest: words.slice(n) };
  }
  return null;
}

export function parseArgs(def: CommandDef, argv: string[]): Args {
  const out: Args = {};
  const positional = def.args.filter((a) => a.kind === 'positional');
  let p = 0;
  for (let i = 0; i < argv.length; i++) {
    const w = argv[i];
    if (w === '--json') { out.json = true; continue; }
    if (w.startsWith('--')) {
      const spec = def.args.find((a) => a.name === w.slice(2) && a.kind !== 'positional');
      if (!spec) throw new CliError('usage', `Unknown option ${w}.`, 64);
      if (spec.kind === 'flag') out[spec.name] = true;
      else {
        const v = argv[++i];
        if (v === undefined || v.startsWith('--')) throw new CliError('usage', `${w} needs a value.`, 64);
        out[spec.name] = v;
      }
    } else if (p < positional.length) out[positional[p++].name] = w;
    else throw new CliError('usage', `Unexpected argument "${w}".`, 64);
  }
  for (const spec of def.args) {
    if (spec.required && out[spec.name] === undefined) throw new CliError('usage', `Missing ${spec.kind === 'positional' ? spec.name : `--${spec.name}`}.`, 64);
    if (spec.values && out[spec.name] !== undefined && !spec.values.includes(String(out[spec.name]))) throw new CliError('usage', `--${spec.name} must be one of ${spec.values.join(', ')}.`, 64);
  }
  return out;
}

/** Runs one command line and returns what the program should print and exit with. Never throws. */
export async function runCli(argv: string[], io: CliIo): Promise<{ exit: number; stdout: string; stderr: string }> {
  const json = argv.includes('--json');
  const fail = (e: CliError) => json
    ? { exit: e.exit, stdout: `${JSON.stringify({ schema: OUTPUT_SCHEMA, ok: false, error: { code: e.code, message: e.message } })}\n`, stderr: '' }
    : { exit: e.exit, stdout: '', stderr: `scrimshaw: ${e.message}\n` };
  const words = argv.filter((w) => w !== '--json');
  if (words.length === 0 || words[0] === '--help' || words[0] === 'help') {
    return { exit: words.length ? 0 : 64, stdout: usage(), stderr: '' };
  }
  const found = findCommand(words);
  if (!found) return fail(new CliError('usage', `Unknown command "${words.slice(0, 2).join(' ')}". Run "scrimshaw commands".`, 64));
  try {
    const args = parseArgs(found.def, found.rest);
    const r = await found.def.run(args, io);
    const exit = r.exit ?? 0;
    if (json) return { exit, stdout: `${JSON.stringify({ schema: OUTPUT_SCHEMA, ok: exit === 0, command: found.def.name, ...r.data })}\n`, stderr: '' };
    return { exit, stdout: `${humanLine(found.def, r.data)}\n`, stderr: '' };
  } catch (e) {
    return fail(e instanceof CliError ? e : new CliError('error', (e as Error).message));
  }
}

function humanLine(def: CommandDef, data: Record<string, unknown>): string {
  if (def.name === 'commands') return (data.commands as { name: string; summary: string }[]).map((c) => `${c.name.padEnd(22)}${c.summary}`).join('\n');
  if (Array.isArray(data.problems)) return data.problems.length ? (data.problems as string[]).join('\n') : 'No problems found.';
  return Object.entries(data).map(([k, v]) => `${k}: ${String(v)}`).join('\n');
}

function usage(): string {
  return `Usage: scrimshaw <command> [options] [--json]\n\n${COMMANDS.map((c) => `  ${c.name.padEnd(22)}${c.summary}`).join('\n')}\n\nExit codes: 0 ok, 1 error, 2 course has problems, 64 bad usage.\n`;
}
