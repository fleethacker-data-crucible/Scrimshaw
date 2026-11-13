# GHAS alert triage (sprint 2026-11)

Open code-scanning alerts as of 2026-11-13. Alerts were not dismissed on GitHub.

| Alert | Rule | Path | Disposition | Reason |
| --- | --- | --- | --- | --- |
| code-scanning 1 | `js/incomplete-multi-character-sanitization` | `src/render/vtt.ts` | fixed | Cue markup is removed by a scan from `<` to the next `>`, and an unclosed `<script`, `<style`, or `<iframe` is dropped; a bare `<` such as `x < y` stays. Caption text is rendered as text. |
| code-scanning 2 | `js/incomplete-multi-character-sanitization` | `tests/docx.test.ts` | fixed | The "no stray `<`" check walks the handout tag grammar, so a nested `<` is kept and fails the check instead of being swallowed by one `/<[^>]*>/` pass. |
| code-scanning 3 | `js/incomplete-multi-character-sanitization` | `tests/docx.test.ts` | fixed | Visible handout text is read with that same walk, and `<w:br/>` still becomes a newline. |

No alert was accepted. No GitHub dismissal reason is recommended.

Alert URLs:

- https://github.com/fleethacker-data-crucible/Scrimshaw/security/code-scanning/1
- https://github.com/fleethacker-data-crucible/Scrimshaw/security/code-scanning/2
- https://github.com/fleethacker-data-crucible/Scrimshaw/security/code-scanning/3
