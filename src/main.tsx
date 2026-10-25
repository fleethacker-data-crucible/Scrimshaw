// Entry point. The same bundle is the editor and, when a course is embedded in the page,
// the published player.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { connectLms, type Lms } from './export/scorm.ts';
import { connectCmi5, connectXapi } from './export/xapi.ts';
import { captureShell, embeddedCourseJson } from './export/publish.ts';
import { normalizeCourse } from './model/schema.ts';
import { Player } from './player/Player.tsx';
import { EditorRoot } from './editor/EditorShell.tsx';
import { applyTheme, loadSettings } from './store/persist.ts';
import { UiProvider } from './ui/kit.tsx';

captureShell(document);

const rootEl = document.getElementById('root')!;
const root = createRoot(rootEl);
const embedded = embeddedCourseJson(document);

function fatal(message: string) {
  rootEl.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'notice err';
  box.setAttribute('role', 'alert');
  box.style.margin = '40px auto';
  box.style.maxWidth = '560px';
  box.textContent = message;
  rootEl.appendChild(box);
}

if (embedded !== null) {
  // Published player.
  try {
    const course = normalizeCourse(JSON.parse(embedded));
    applyTheme('system', false);
    document.title = course.title;
    const transport = (url: string, init: RequestInit) => fetch(url, { ...init, credentials: 'omit' });
    const search = location.search;
    const xapi = new URLSearchParams(search).has('fetch') ? connectCmi5(course, search, transport) : connectXapi(course, search, transport);
    void xapi.catch(() => null).then((x) => {
      const lms: Lms = x ?? connectLms(window);
      root.render(
        <StrictMode>
          <UiProvider><Player course={course} lms={lms} /></UiProvider>
        </StrictMode>,
      );
    });
  } catch (e) {
    fatal(`This course could not be loaded: ${(e as Error).message}`);
  }
} else {
  const s = loadSettings();
  applyTheme(s.theme, s.reducedMotion);
  root.render(
    <StrictMode>
      <UiProvider><EditorRoot /></UiProvider>
    </StrictMode>,
  );
}
