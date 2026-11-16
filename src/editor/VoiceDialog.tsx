// TalkForge narration for the open slide, and a storyboard drafted from a recording (issue 14).
import { useEffect, useRef, useState } from 'react';
import { chat, loadRouterSettings, parseStoryboard, saveRouterSettings, storyboardToScene, type RouterSettings } from '../ai/router.ts';
import { DEFAULT_VOICE, narrationAssets, narrationText, placeNarration, speak, transcribe, type VoiceError } from '../ai/voice.ts';
import { isLocalServer } from '../lifecycle.ts';
import { findSlide } from '../model/query.ts';
import type { Scene } from '../model/types.ts';
import { Button, Dialog, Field, useUi } from '../ui/kit.tsx';
import { pickFile, withAsset } from './assets.ts';
import { useEditor } from './context.tsx';

export function VoiceDialog({ mode, onClose }: { mode: 'narrate' | 'transcript'; onClose: () => void }) {
  const { course, state, edit, select } = useEditor();
  const { toast } = useUi();
  const slide = findSlide(course, state.sel.slideId);
  const onServer = typeof window !== 'undefined' && isLocalServer(window.location);
  const [settings, setSettings] = useState<RouterSettings>(() => loadRouterSettings());
  const [key, setKey] = useState('');
  const [voice, setVoice] = useState(DEFAULT_VOICE);
  const [script, setScript] = useState(() => (slide ? narrationText(slide) : ''));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [scene, setScene] = useState<Scene | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const change = (s: RouterSettings) => { setSettings(s); saveRouterSettings(s); };
  const call = () => ({ settings, key: onServer ? undefined : (key || undefined), viaProxy: onServer, signal: abort.current?.signal });

  const narrate = async () => {
    if (!slide) return;
    setBusy(true); setError('');
    abort.current = new AbortController();
    try {
      const audio = await speak(script, voice, call());
      const assets = narrationAssets(script, audio.bytes, audio.mime);
      edit('Narrate slide', (c) => {
        const target = findSlide(c, slide.id);
        if (!target) return;
        withAsset(c, assets.audio);
        withAsset(c, assets.captions);
        placeNarration(target, assets.audio, assets.captions);
      });
      toast('Narration added. Listen to it before you publish.', 'ok');
      onClose();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as VoiceError).message);
    } finally { setBusy(false); }
  };

  const draft = async () => {
    if (!file) return;
    setBusy(true); setError(''); setScene(null);
    abort.current = new AbortController();
    try {
      const transcript = await transcribe(file, file.name, call());
      const text = await chat('storyboard', transcript, call());
      setScene(storyboardToScene(parseStoryboard(text)));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as VoiceError).message);
    } finally { setBusy(false); }
  };

  const add = () => {
    if (!scene) return;
    edit('Add storyboard from a recording', (c) => { c.scenes.push(scene); });
    select({ slideId: scene.slides[0].id, objectIds: [] });
    toast(`Added "${scene.name}" with ${scene.slides.length} slide${scene.slides.length === 1 ? '' : 's'}. Review it before publishing.`, 'ok');
    onClose();
  };

  const title = mode === 'narrate' ? 'Narrate this slide' : 'Storyboard from a recording';
  return (
    <Dialog title={title} onClose={onClose} wide={640} footer={
      <>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {mode === 'narrate'
          ? <Button variant="primary" disabled={!settings.enabled || busy || script.trim().length < 1 || !slide} onClick={() => { void narrate(); }}>{busy ? 'Speaking…' : 'Add narration'}</Button>
          : scene
            ? <Button variant="primary" onClick={add}>Add to course</Button>
            : <Button variant="primary" disabled={!settings.enabled || busy || !file} onClick={() => { void draft(); }}>{busy ? 'Drafting…' : 'Transcribe and draft'}</Button>}
      </>
    }>
      <p className="muted text-[13px]">TalkForge speaks and listens through Fairlead on this computer. Nothing is sent until you turn this on, and the key stays on the server when Scrimshaw is serving this page.</p>
      <label className="check"><input type="checkbox" checked={settings.enabled} onChange={(e) => change({ ...settings, enabled: e.target.checked })} /> Use the router for voice</label>
      <fieldset className="grid gap-2" disabled={!settings.enabled}>
        <label className="check"><input type="checkbox" checked={settings.localOnly} onChange={(e) => change({ ...settings, localOnly: e.target.checked })} /> Keep voice on this computer (local models only)</label>
        {mode === 'narrate' ? (
          <>
            <Field label="Voice" hint="A TalkForge voice id. An unknown name uses TalkForge's default."><input value={voice} onChange={(e) => setVoice(e.target.value)} spellCheck={false} /></Field>
            <Field label="Words to speak" hint="Starts from the slide notes, or the title and text when the notes are empty."><textarea rows={6} value={script} onChange={(e) => setScript(e.target.value)} /></Field>
          </>
        ) : (
          <>
            <Field label="Recording"><Button variant="ghost" onClick={() => { void pickFile('audio/*').then((f) => { setFile(f); setScene(null); }); }}>{file ? file.name : 'Choose an audio file…'}</Button></Field>
            {scene && (
              <div role="status">
                <p className="text-[13px]">Draft ready: {scene.name} ({scene.slides.length} slides)</p>
                <ul className="grid gap-1 max-h-48 overflow-auto text-[13px]" aria-label="Drafted slides">{scene.slides.map((s) => <li key={s.id}>{s.title}</li>)}</ul>
              </div>
            )}
          </>
        )}
        {!onServer && <Field label="Client key (kept for this session only)"><input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Only when this page is not served by Scrimshaw" /></Field>}
      </fieldset>
      {error && <p className="text-[13px]" role="alert">{error}</p>}
    </Dialog>
  );
}
