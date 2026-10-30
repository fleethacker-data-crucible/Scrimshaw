# Scrimshaw brand files

| File | Use |
| --- | --- |
| `scrimshaw-logo.png` | Full logo with wordmark, 1254 px master |
| `scrimshaw-logo-640.png` | Full logo on its cream backdrop, 640 px |
| `scrimshaw-emblem.png` | The emblem alone (no wordmark), 1000 px square, for icons and small spaces |

The README uses `assets/brand/emblem-{light,dark}-transparent.png` (README-STANDARD section 3, option 2): 1024 px cuts of `scrimshaw-logo.png` with the backdrop removed. There is no dark original, so the dark copy also turns the wordmark letters ivory (UNIFIED-UI 8), the same as `src/assets/logo-dark.webp`.

The app uses copies made from these: `src/assets/favicon.png` (64 px, browser tab and taskbar) and
`src/assets/emblem.webp` (192 px, the editor's top bar and the Projects dialog), both with the backdrop made transparent so they suit either theme, and
`src/assets/logo-{light,dark}.webp` (512 px, the Welcome view): `scrimshaw-logo.png` with the backdrop
made transparent; the dark copy has its wordmark in ivory, per the Fleet brand rules (docs/UNIFIED-UI.md 8).

Colours drawn from the logo: navy `#031424`, ivory `#fbfaf2`, gold `#a8885c`.
