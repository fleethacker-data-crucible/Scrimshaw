import { findSlide } from '../model/query.ts';
import { addLayer, deleteLayer, duplicateLayer } from '../store/ops.ts';
import { Copy, Layers, Pencil, Plus, Trash } from '../ui/icons.tsx';
import { IconButton, useUi } from '../ui/kit.tsx';
import { useEditor } from './context.tsx';

export function LayersPanel() {
  const { slide, layer, select, edit, course } = useEditor();
  const master = slide.id === course.master.id;
  const { confirm, prompt } = useUi();
  const editSlide = (label: string, fn: (s: typeof slide) => void) => edit(label, (c, sel) => { fn(findSlide(c, sel.slideId)!); });
  return (
    <section aria-label="Slide layers" className="p-2 grid gap-1 content-start">
      <div className="flex items-center gap-1 mb-1">
        <Layers size={14} />
        <h2 className="!m-0 flex-1">Layers</h2>
        <IconButton label="New layer" disabled={master} onClick={() => edit('New layer', (c, sel) => { const l = addLayer(findSlide(c, sel.slideId)!); return { layerId: l.id, objectIds: [] }; })}><Plus /></IconButton>
      </div>
      <ul className="snav" role="listbox" aria-label="Layer being edited">
        {[...slide.layers].reverse().map((l) => (
          <li key={l.id} role="option" aria-selected={l.id === layer.id} className="flex items-center gap-1">
            <button type="button" className="flex-1 min-w-0" aria-current={l.id === layer.id ? 'page' : undefined} onClick={() => select({ layerId: l.id, objectIds: [] })}>
              <span className="truncate flex-1">{l.name}</span>
              <span className="muted text-[11px]">{l.objects.length}</span>
            </button>
            {!l.base && (
              <>
                <IconButton label={`Rename ${l.name}`} className="!h-6 !w-6" onClick={async () => {
                  const name = await prompt({ title: 'Rename layer', label: 'Layer name', value: l.name, ok: 'Rename' });
                  if (name) editSlide('Rename layer', (s) => { s.layers.find((x) => x.id === l.id)!.name = name; });
                }}><Pencil size={12} /></IconButton>
                <IconButton label={`Duplicate ${l.name}`} className="!h-6 !w-6" onClick={() => edit('Duplicate layer', (c, sel) => { const n = duplicateLayer(findSlide(c, sel.slideId)!, l.id); return n ? { layerId: n.id, objectIds: [] } : undefined; })}><Copy size={12} /></IconButton>
                <IconButton label={`Delete ${l.name}`} className="!h-6 !w-6" onClick={async () => {
                  if (!(await confirm({ title: 'Delete layer?', message: `“${l.name}”, its ${l.objects.length} object(s), and triggers that show or hide it will be deleted. You can undo this.`, ok: 'Delete', danger: true }))) return;
                  editSlide('Delete layer', (s) => deleteLayer(s, l.id));
                }}><Trash size={12} /></IconButton>
              </>
            )}
          </li>
        ))}
      </ul>
      {!layer.base && (
        <div className="grid gap-1 mt-2 border-t border-line pt-2">
          <label className="check text-[12px]"><input type="checkbox" checked={layer.hideOthers} onChange={(e) => editSlide('Layer option', (s) => { s.layers.find((x) => x.id === layer.id)!.hideOthers = e.target.checked; })} /> Hide other layers when shown</label>
          <label className="check text-[12px]"><input type="checkbox" checked={layer.modal} onChange={(e) => editSlide('Layer option', (s) => { s.layers.find((x) => x.id === layer.id)!.modal = e.target.checked; })} /> Dim and block the base layer</label>
        </div>
      )}
    </section>
  );
}
