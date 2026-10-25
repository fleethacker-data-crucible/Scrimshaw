// React versions of the FleetHacker UI Kit patterns (kit.js equivalents): buttons, dialogs,
// confirm, toasts, menus and tabs, following the kit's accessibility rules (native <dialog>,
// APG menu-button and tabs keyboard support, polite live region for toasts, role=alert for errors,
// destructive confirms focus Cancel).
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState,
  type ComponentProps, type KeyboardEvent, type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { twMerge } from 'tailwind-merge';
import { X } from './icons.tsx';

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

// ---------- buttons ----------

/** Variants map onto the kit's button classes, so the kit owns the look. */
export const buttonVariants = cva('', {
  variants: {
    variant: { default: '', ghost: 'ghost', primary: 'primary', danger: 'danger', go: 'go' },
    size: { default: '', small: 'small', icon: 'icon' },
  },
  defaultVariants: { variant: 'default', size: 'default' },
});

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants>;
export function Button({ variant, size, className, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...rest} />;
}

/** Icon-only button: always labelled for assistive tech, with a matching tooltip. */
export function IconButton({ label, children, variant = 'ghost', pressed, ...rest }: Omit<ButtonProps, 'size' | 'aria-label'> & { label: string; pressed?: boolean }) {
  return (
    <Button variant={variant} size="icon" aria-label={label} title={label} aria-pressed={pressed} {...rest}>
      {children}
    </Button>
  );
}

// ---------- dialog ----------

export function Dialog({ title, onClose, children, footer, wide, className }: {
  title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean | number; className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    const opener = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    const cancel = (e: Event) => { e.preventDefault(); closeRef.current(); };
    d.addEventListener('cancel', cancel);
    return () => {
      d.removeEventListener('cancel', cancel);
      if (d.open) d.close();
      opener?.focus?.();
    };
  }, []);
  const width = wide === true ? 'min(760px,94vw)' : typeof wide === 'number' ? `min(${wide}px,94vw)` : undefined;
  return (
    <dialog ref={ref} aria-labelledby={id} style={width ? { width } : undefined} className={className}>
      <header>
        <h2 id={id}>{title}</h2>
        <IconButton label="Close" onClick={onClose} className="-mr-2"><X /></IconButton>
      </header>
      <div className="body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  );
}

// ---------- toasts + confirm ----------

type Tone = 'info' | 'ok' | 'warn' | 'err';
interface Toast { id: number; message: string; tone: Tone }
interface ConfirmReq { title: string; message: ReactNode; ok: string; danger: boolean; resolve: (v: boolean) => void }
interface PromptReq { title: string; label: string; value: string; ok: string; resolve: (v: string | null) => void }

interface UiApi {
  toast: (message: string, tone?: Tone) => void;
  confirm: (o: { title: string; message: ReactNode; ok?: string; danger?: boolean }) => Promise<boolean>;
  /** Styled replacement for window.prompt (the kit retires native prompt()). Resolves null on cancel. */
  prompt: (o: { title: string; label: string; value?: string; ok?: string }) => Promise<string | null>;
}
const UiContext = createContext<UiApi>({ toast: () => {}, confirm: async () => false, prompt: async () => null });
export const useUi = () => useContext(UiContext);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmReq, setConfirmReq] = useState<ConfirmReq | null>(null);
  const [promptReq, setPromptReq] = useState<PromptReq | null>(null);
  const [promptText, setPromptText] = useState('');
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const toast = useCallback((message: string, tone: Tone = 'info') => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, message, tone }]);
    setTimeout(() => dismiss(id), tone === 'err' ? 9000 : 5000);
  }, [dismiss]);
  const confirm = useCallback<UiApi['confirm']>((o) => new Promise((resolve) => {
    setConfirmReq({ title: o.title, message: o.message, ok: o.ok ?? 'OK', danger: !!o.danger, resolve });
  }), []);
  const prompt = useCallback<UiApi['prompt']>((o) => new Promise((resolve) => {
    setPromptText(o.value ?? '');
    setPromptReq({ title: o.title, label: o.label, value: o.value ?? '', ok: o.ok ?? 'OK', resolve });
  }), []);
  const api = useMemo(() => ({ toast, confirm, prompt }), [toast, confirm, prompt]);
  const answer = (v: boolean) => { confirmReq?.resolve(v); setConfirmReq(null); };
  const answerPrompt = (v: string | null) => { promptReq?.resolve(v); setPromptReq(null); };
  return (
    <UiContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.filter((t) => t.tone !== 'err').map((t) => (
          <div key={t.id} className={cn('toast', t.tone !== 'info' && t.tone)}>
            {t.message}
            <button type="button" className="x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
          </div>
        ))}
      </div>
      <div className="toasts" style={{ top: 64 }}>
        {toasts.filter((t) => t.tone === 'err').map((t) => (
          <div key={t.id} className="toast err" role="alert">
            {t.message}
            <button type="button" className="x" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
          </div>
        ))}
      </div>
      {confirmReq && (
        <Dialog title={confirmReq.title} onClose={() => answer(false)} footer={
          <>
            <Button variant="ghost" onClick={() => answer(false)} autoFocus={confirmReq.danger}>Cancel</Button>
            <Button variant={confirmReq.danger ? 'danger' : 'default'} onClick={() => answer(true)} autoFocus={!confirmReq.danger}>{confirmReq.ok}</Button>
          </>
        }>
          <div>{confirmReq.message}</div>
        </Dialog>
      )}
      {promptReq && (
        <Dialog title={promptReq.title} onClose={() => answerPrompt(null)} footer={
          <>
            <Button variant="ghost" onClick={() => answerPrompt(null)}>Cancel</Button>
            <Button type="submit" form="kit-prompt" disabled={!promptText.trim()}>{promptReq.ok}</Button>
          </>
        }>
          <form id="kit-prompt" onSubmit={(e) => { e.preventDefault(); if (promptText.trim()) answerPrompt(promptText.trim()); }}>
            <Field label={promptReq.label}>
              <input autoFocus value={promptText} onChange={(e) => setPromptText(e.target.value)} onFocus={(e) => e.target.select()} />
            </Field>
          </form>
        </Dialog>
      )}
    </UiContext.Provider>
  );
}

// ---------- menu (APG menu button) ----------

export interface MenuItem {
  label: string;
  onSelect?: () => void;
  disabled?: boolean;
  danger?: boolean;
  shortcut?: string;
  separator?: boolean;
  icon?: ReactNode;
}

export function Menu({ label, items, children, align = 'left', buttonClass, variant = 'ghost', size, title }: {
  label: string; items: MenuItem[]; children: ReactNode; align?: 'left' | 'right'; buttonClass?: string;
  variant?: ButtonProps['variant']; size?: ButtonProps['size']; title?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const focusItem = (i: number) => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])];
    if (els.length === 0) return;
    els[(i + els.length) % els.length].focus();
  };
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away);
    requestAnimationFrame(() => focusItem(0));
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const close = (refocus = true) => { setOpen(false); if (refocus) btn.current?.focus(); };
  const onMenuKey = (e: KeyboardEvent) => {
    const els = [...(menu.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(0); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(-1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  };
  return (
    <div className="dd-wrap" ref={wrap}>
      <Button ref={btn} variant={variant} size={size} className={buttonClass} aria-haspopup="menu" aria-expanded={open} aria-controls={id} title={title}
        aria-label={typeof children === 'string' ? undefined : label}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}>
        {children}
      </Button>
      <div id={id} ref={menu} role="menu" aria-label={label} className={cn('dd-menu', open && 'open', align === 'right' && 'right')} onKeyDown={onMenuKey}>
        {items.map((it, i) => it.separator
          ? <div key={i} role="separator" className="my-1 h-px !p-0 bg-line" />
          : (
            <div key={i} role="menuitem" tabIndex={-1} aria-disabled={it.disabled || undefined}
              className={cn('flex items-center gap-2', it.danger && 'danger')}
              onClick={() => { if (it.disabled) return; close(); it.onSelect?.(); }}
              onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !it.disabled) { e.preventDefault(); close(); it.onSelect?.(); } }}>
              {it.icon}<span className="flex-1">{it.label}</span>
              {it.shortcut && <kbd className="text-[11px]">{it.shortcut}</kbd>}
            </div>
          ))}
      </div>
    </div>
  );
}

// ---------- tabs (APG) ----------

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label: string }) {
  const base = useId();
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') n = 0;
    if (e.key === 'End') n = tabs.length - 1;
    if (n >= 0) {
      e.preventDefault();
      onChange(tabs[n].id);
      requestAnimationFrame(() => document.getElementById(`${base}-${tabs[n].id}`)?.focus());
    }
  };
  return (
    <div role="tablist" aria-label={label} onKeyDown={onKey} className="px-2">
      {tabs.map((t) => (
        <button key={t.id} id={`${base}-${t.id}`} type="button" role="tab" aria-selected={t.id === value} tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}>{t.label}</button>
      ))}
    </div>
  );
}

// ---------- fields ----------

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('field', className)}>
      <span className="text-[12px]">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** A number input that keeps intermediate text ("", "-") locally and reports valid numbers live.
 *  Callers pass a mergeKey to their edit so a burst of changes is one undo step. */
export function NumberInput({ value, onChange, min, max, step = 1, label, className }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; label: string; className?: string;
}) {
  const [text, setText] = useState(String(round(value)));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(round(value))); }, [value]);
  const parse = (t: string) => {
    const n = Number(t);
    if (t.trim() === '' || !Number.isFinite(n)) return null;
    return Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
  };
  return (
    <input type="number" aria-label={label} title={label} className={className} value={text} min={min} max={max} step={step}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => {
        setText(e.target.value);
        const n = parse(e.target.value);
        if (n !== null && n !== value) onChange(n);
      }}
      onBlur={() => { focused.current = false; setText(String(round(parse(text) ?? value))); }} />
  );
}
const round = (n: number) => Math.round(n * 100) / 100;

export function Select<T extends string>({ value, onChange, options, label, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[] | readonly { value: T; label: string }[]; label: string; className?: string;
}) {
  return (
    <select aria-label={label} title={label} className={className} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

// ---------- context menu (positioned APG menu) ----------

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.min(x, innerWidth - r.width - 8), y: Math.min(y, innerHeight - r.height - 8) });
    el.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const blur = () => onClose();
    document.addEventListener('pointerdown', away, true);
    window.addEventListener('blur', blur);
    window.addEventListener('resize', blur);
    return () => { document.removeEventListener('pointerdown', away, true); window.removeEventListener('blur', blur); window.removeEventListener('resize', blur); };
  }, [onClose]);
  const focusAt = (d: number) => {
    const els = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + d + els.length) % els.length]?.focus();
  };
  // Portalled to <body> so the menu is never clipped by the canvas or the stage's scroll area.
  return createPortal(
    <div ref={ref} role="menu" aria-label="Object actions" className="dd-menu open" style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 60 }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); focusAt(1); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); focusAt(-1); }
        else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
      }}
      onContextMenu={(e) => e.preventDefault()}
      // React portals still bubble synthetic events to their React parents (the canvas): stop them here.
      onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {items.map((it, i) => it.separator
        ? <div key={i} role="separator" className="my-1 h-px !p-0 bg-line" />
        : (
          <div key={i} role="menuitem" tabIndex={-1} aria-disabled={it.disabled || undefined} className={cn('flex items-center gap-2', it.danger && 'danger')}
            onClick={() => { if (it.disabled) return; onClose(); it.onSelect?.(); }}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !it.disabled) { e.preventDefault(); onClose(); it.onSelect?.(); } }}>
            {it.icon}<span className="flex-1">{it.label}</span>{it.shortcut && <kbd className="text-[11px]">{it.shortcut}</kbd>}
          </div>
        ))}
    </div>,
    document.body,
  );
}
