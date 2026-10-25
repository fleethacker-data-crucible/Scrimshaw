# Contributing to Scrimshaw

Thanks for helping. A few rules keep the project consistent with the Edge-Ops suite.

## Ground rules

- **TechStack**: React 19 + TypeScript, Tailwind CSS 4, CVA, Lucide icons, PowerShell 5.1 local
  server. Bundle every dependency; no CDNs and no runtime network calls (published xAPI/cmi5 packages
  talk only to the LRS the LMS names at launch).
- **UI kit**: use the FleetHacker UI Kit (`vendor/ui-kit/`) classes and tokens. Don't hard-code
  colours in app chrome; course content colours are the author's data and are fine.
- **Accessibility**: WCAG 2.1 AA. Every control has a name, focus is visible, dialogs are native
  `<dialog>`, menus and tabs follow the WAI-ARIA APG patterns, and no native `alert()`, `confirm()` or
  `prompt()` (use `useUi().confirm` / `prompt`).
- **Voice**: sentence case, plain words, American spelling to match most of the suite.

## Workflow

```sh
npm install
npm run watch        # rebuilds dist/index.html on change; open it in the browser
npm test             # unit tests (Node's test runner, no browser)
npm run typecheck
npm run test:e2e     # Playwright + axe-core
npm run build        # before committing: dist/ is committed
```

CI (on the self-hosted Windows build PC) fails when `dist/` doesn't match the source, so always run
`npm run build` and commit `dist/` with your change.

## Where things go

| Change | Files |
| --- | --- |
| New course data | `src/model/types.ts`, defaults in `factory.ts`, loading in `schema.ts` (old files must still load) |
| Player behaviour | `src/engine/runtime.ts` (pure, with a test in `tests/engine.test.ts`) |
| How objects look | `src/render/SlideView.tsx` (shared by canvas, thumbnails, player) |
| Editing | `src/store/ops.ts` for operations, `src/editor/*` for UI; every change goes through `edit()` so it can be undone |
| Publishing | `src/export/*` |

Engine changes need unit tests. UI changes that affect a learner or author flow need a step in
`tools/e2e.mjs`.

## Course format compatibility

`.scrim` files are JSON with a `schema` number. When a stored shape changes, bump `SCHEMA_VERSION`
and teach `normalizeCourse()` to read the old shape. Never break opening an older file.
