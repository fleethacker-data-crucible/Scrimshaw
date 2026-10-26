// Landing view shown when Scrimshaw opens: the full logo large, one headline and the ways in
// (UNIFIED-UI 6, .fl-empty). Once per browser tab, so a reload goes straight back to the editor.
import logoDark from '../assets/logo-dark.webp';
import logoLight from '../assets/logo-light.webp';
import { ArrowRight, FileBraces, FilePlus, FolderOpen } from '../ui/icons.tsx';
import { Button } from '../ui/kit.tsx';

const SEEN_KEY = 'scrimshaw-welcome-seen';

export function welcomeSeen(): boolean {
  try { return sessionStorage.getItem(SEEN_KEY) === '1'; } catch { return false; }
}

export function markWelcomeSeen(): void {
  try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* storage unavailable: the view shows again next load */ }
}

/** The full Scrimshaw logo (docs/brand/scrimshaw-logo.png with its backdrop made transparent), one per theme. */
export function BrandLogo({ size, className }: { size: number; className?: string }) {
  return (
    <>
      <img className={`only-light ${className ?? ''}`} src={logoLight} alt="Scrimshaw" width={size} height={size} />
      <img className={`only-dark ${className ?? ''}`} src={logoDark} alt="Scrimshaw" width={size} height={size} />
    </>
  );
}

export function Welcome({ courseTitle, onContinue, onNew, onProjects, onOpenFile }: {
  courseTitle: string; onContinue: () => void; onNew: () => void; onProjects: () => void; onOpenFile: () => void;
}) {
  return (
    <main className="welcome" aria-labelledby="welcome-title">
      <BrandLogo size={380} className="welcome-logo" />
      <h1 id="welcome-title">Carve a course worth remembering.</h1>
      <p>Build slides, layers and triggers, then publish a SCORM, xAPI or cmi5 package. Your work stays in this browser until you export it.</p>
      <div className="welcome-actions">
        <Button variant="primary" onClick={onContinue} autoFocus><ArrowRight />Continue “{courseTitle || 'Untitled'}”</Button>
        <Button onClick={onNew}><FilePlus />New course</Button>
        <Button onClick={onProjects}><FolderOpen />Projects…</Button>
        <Button onClick={onOpenFile}><FileBraces />Open a .scrim file</Button>
      </div>
    </main>
  );
}
