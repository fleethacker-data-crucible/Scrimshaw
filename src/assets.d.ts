// Images imported from src/assets are inlined by esbuild as data: URLs.
declare module '*.webp' { const url: string; export default url; }
declare module '*.png' { const url: string; export default url; }
