import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { FORMATS, OBJECTS, PRESETS, S_TO_L, SCHEMES, type Format, type Kind, type Preset, type Size } from './core/catalog';
import { layout, newUid, type LayoutInput } from './core/layout';
import { matchNames } from './core/match';
import { canvasColor, itemMarkup, itemSize, itemTransform, renderSvg, type Composition, type Item } from './core/render';
import { BODIES } from './bodies';

const nameOf = (slug: string) => OBJECTS.find((o) => o.slug === slug)?.nameRu ?? slug;

const ItemLayer = memo(function ItemLayer(p: { item: Item; size: Size; scheme: string; transform: string; selected: boolean }) {
  const html = useMemo(
    () => itemMarkup(p.item, { size: p.size, scheme: p.scheme }, BODIES, p.item.uid),
    [p.item.slug, p.item.kind, p.item.uid, p.size, p.scheme],
  );
  return (
    <g
      data-uid={p.item.uid}
      data-slug={p.item.slug}
      data-kind={p.item.kind}
      className={p.selected ? 'item selected' : 'item'}
      transform={p.transform}
      fill="none"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export function App() {
  const [comp, setComp] = useState<Composition>({ format: FORMATS[1], size: 'L', scheme: SCHEMES[0].id, scale: 1, items: [] });
  const [preset, setPreset] = useState<Preset>('assembled');
  const [selected, setSelected] = useState<string | null>(null);
  const [metaphor, setMetaphor] = useState('');
  const [names, setNames] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ uid: string; dx: number; dy: number } | null>(null);

  const sel = comp.items.find((i) => i.uid === selected) ?? null;
  const update = (fn: (c: Composition) => Composition) => setComp((c) => fn(c));
  const updateItem = (uid: string, patch: Partial<Item>) =>
    update((c) => ({ ...c, items: c.items.map((i) => (i.uid === uid ? { ...i, ...patch } : i)) }));

  function relayout(inputs: LayoutInput[], p = preset, c: Pick<Composition, 'size' | 'format'> = comp) {
    const { scale, items } = layout(inputs, c.size, c.format, p);
    setComp((prev) => ({ ...prev, ...c, scale, items }));
    setSelected(null);
  }

  async function fromMetaphor() {
    if (!metaphor.trim()) return;
    setBusy(true);
    setStatus('Подбираю объекты…');
    try {
      const res = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: metaphor }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const r = (await res.json()) as { slugs: string[]; preset: Preset; source: string; model?: string; reason?: string };
      setPreset(r.preset);
      relayout(r.slugs.map((slug) => ({ slug, kind: 'main' as Kind })), r.preset);
      const how =
        r.source === 'llm' ? `LLM (${r.model})` : r.source === 'keywords' ? 'поиск по ключевым словам (LLM недоступна)' : 'базовый набор: совпадений не найдено';
      setStatus(`${r.slugs.map(nameOf).join(', ')} — ${how}${r.reason ? `. ${r.reason}` : ''}`);
    } catch (e) {
      setStatus(`Ошибка запроса: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function fromNames() {
    const { slugs, unknown } = matchNames(names, OBJECTS);
    if (!slugs.length) return setStatus(`Не нашёл объектов${unknown.length ? `: ${unknown.join(', ')}` : ''}`);
    relayout(slugs.map((slug) => ({ slug, kind: 'main' as Kind })));
    setStatus(`${slugs.map(nameOf).join(', ')}${unknown.length ? ` · не распознано: ${unknown.join(', ')}` : ''}`);
  }

  function addObject(slug: string) {
    if (!comp.items.length) return relayout([{ slug, kind: 'main' }]);
    const item: Item = { uid: newUid(), slug, kind: 'main', cx: comp.format.w / 2, cy: comp.format.h / 2, rotation: 0 };
    update((c) => ({ ...c, items: [...c.items, item] }));
    setSelected(item.uid);
  }

  const inputs = () => comp.items.map(({ slug, kind }) => ({ slug, kind }));
  const setFormat = (f: Format) => (comp.items.length ? relayout(inputs(), preset, { ...comp, format: f }) : update((c) => ({ ...c, format: f })));
  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (comp.items.length) relayout(inputs(), p);
  };
  // S нарисованы в 1:2 к L: меняем набор элементов и компенсируем общий масштаб, центры объектов остаются на месте
  const setSize = (size: Size) =>
    size !== comp.size && update((c) => ({ ...c, size, scale: c.scale * (size === 'S' ? S_TO_L : 1 / S_TO_L) }));
  const zoom = (factor: number) =>
    update((c) => ({
      ...c,
      scale: c.scale * factor,
      items: c.items.map((i) => ({ ...i, cx: c.format.w / 2 + (i.cx - c.format.w / 2) * factor, cy: c.format.h / 2 + (i.cy - c.format.h / 2) * factor })),
    }));

  function move(uid: string, dir: 'up' | 'down' | 'top' | 'bottom') {
    update((c) => {
      const items = [...c.items];
      const i = items.findIndex((x) => x.uid === uid);
      const [it] = items.splice(i, 1);
      const j = dir === 'top' ? items.length : dir === 'bottom' ? 0 : Math.max(0, Math.min(items.length, i + (dir === 'up' ? 1 : -1)));
      items.splice(j, 0, it);
      return { ...c, items };
    });
  }
  function duplicate(uid: string) {
    const src = comp.items.find((i) => i.uid === uid)!;
    const copy = { ...src, uid: newUid(), cx: src.cx + 30, cy: src.cy + 30 };
    update((c) => ({ ...c, items: [...c.items, copy] }));
    setSelected(copy.uid);
  }
  const remove = (uid: string) => {
    update((c) => ({ ...c, items: c.items.filter((i) => i.uid !== uid) }));
    setSelected(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selected || (e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'Delete' || e.key === 'Backspace') remove(selected);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toCanvas = (e: React.PointerEvent) => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return { x: pt.x, y: pt.y };
  };
  function onPointerDown(e: React.PointerEvent) {
    const g = (e.target as Element).closest('[data-uid]');
    if (!g) return setSelected(null);
    const uid = g.getAttribute('data-uid')!;
    const it = comp.items.find((i) => i.uid === uid)!;
    const p = toCanvas(e);
    drag.current = { uid, dx: p.x - it.cx, dy: p.y - it.cy };
    setSelected(uid);
    svgRef.current!.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const p = toCanvas(e);
    updateItem(drag.current.uid, { cx: p.x - drag.current.dx, cy: p.y - drag.current.dy });
  }

  function exportSvg() {
    const blob = new Blob([renderSvg(comp, BODIES)], { type: 'image/svg+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `composition-${comp.format.id}-${comp.size}-${comp.scheme}.svg`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const selBox = sel && itemSize(sel, comp);

  return (
    <div className="app">
      <aside className="panel">
        <h1>SVG Composer</h1>

        <section>
          <h2>А. Метафора или заголовок</h2>
          <textarea data-testid="metaphor" value={metaphor} onChange={(e) => setMetaphor(e.target.value)} placeholder="Например: «Как накопить на мечту»" rows={2} />
          <button data-testid="metaphor-go" disabled={busy} onClick={fromMetaphor}>Собрать по смыслу</button>
        </section>

        <section>
          <h2>Б. Названия объектов</h2>
          <input data-testid="names" value={names} onChange={(e) => setNames(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fromNames()} placeholder="лампа, наушники, книга" />
          <button data-testid="names-go" onClick={fromNames}>Собрать из объектов</button>
        </section>

        <p className="status" data-testid="status" aria-live="polite">{status}</p>

        <section>
          <h2>Библиотека</h2>
          <div className="library">
            {OBJECTS.map((o) => (
              <button key={o.slug} data-testid={`add-${o.slug}`} onClick={() => addObject(o.slug)} title="Добавить на холст">{o.nameRu}</button>
            ))}
          </div>
        </section>

        {sel && (
          <section className="selected-panel" data-testid="selected-panel">
            <h2>Объект: {nameOf(sel.slug)}</h2>
            <div className="row">
              <button className={sel.kind === 'main' ? 'on' : ''} onClick={() => updateItem(sel.uid, { kind: 'main' })}>Главный</button>
              <button data-testid="kind-bg" className={sel.kind === 'bg' ? 'on' : ''} onClick={() => updateItem(sel.uid, { kind: 'bg' })}>Фоновый</button>
            </div>
            <label>
              Поворот {Math.round(sel.rotation)}°
              <input data-testid="rotate" type="range" min={-180} max={180} value={sel.rotation} onChange={(e) => updateItem(sel.uid, { rotation: Number(e.target.value) })} />
            </label>
            <div className="row">
              <button onClick={() => move(sel.uid, 'top')} title="На передний план">⤒</button>
              <button onClick={() => move(sel.uid, 'up')} title="Выше">↑</button>
              <button onClick={() => move(sel.uid, 'down')} title="Ниже">↓</button>
              <button onClick={() => move(sel.uid, 'bottom')} title="На задний план">⤓</button>
              <button data-testid="duplicate" onClick={() => duplicate(sel.uid)}>Дублировать</button>
              <button data-testid="delete" onClick={() => remove(sel.uid)}>Удалить</button>
            </div>
          </section>
        )}

        <section>
          <h2>Слои</h2>
          <ol className="layers" data-testid="layers">
            {[...comp.items].reverse().map((i) => (
              <li key={i.uid} className={i.uid === selected ? 'on' : ''} onClick={() => setSelected(i.uid)}>
                {nameOf(i.slug)} {i.kind === 'bg' ? '(фон.)' : ''}
              </li>
            ))}
          </ol>
        </section>
      </aside>

      <main className="stage">
        <div className="toolbar">
          <div className="group" role="group" aria-label="Формат">
            {FORMATS.map((f) => (
              <button key={f.id} data-testid={`format-${f.id}`} className={comp.format.id === f.id ? 'on' : ''} onClick={() => setFormat(f)}>{f.w}×{f.h}</button>
            ))}
          </div>
          <div className="group" role="group" aria-label="Размер">
            {(['S', 'L'] as Size[]).map((s) => (
              <button key={s} data-testid={`size-${s}`} className={comp.size === s ? 'on' : ''} onClick={() => setSize(s)}>{s}</button>
            ))}
          </div>
          <div className="group" role="group" aria-label="Цветовая схема">
            {SCHEMES.map((s) => (
              <button key={s.id} data-testid={`scheme-${s.id}`} className={comp.scheme === s.id ? 'on' : ''} onClick={() => update((c) => ({ ...c, scheme: s.id }))}>
                <span className="swatch" style={{ background: s.colors.bg1, borderColor: s.colors.bg3 }} />{s.name}
              </button>
            ))}
          </div>
          <div className="group" role="group" aria-label="Пресет раскладки">
            {PRESETS.map((p) => (
              <button key={p.id} data-testid={`preset-${p.id}`} className={preset === p.id ? 'on' : ''} onClick={() => choosePreset(p.id)}>{p.name}</button>
            ))}
          </div>
          <div className="group" role="group" aria-label="Масштаб композиции">
            <button onClick={() => zoom(1 / 1.1)} title="Уменьшить всю композицию">−</button>
            <button onClick={() => zoom(1.1)} title="Увеличить всю композицию">+</button>
          </div>
          <button data-testid="export" className="primary" disabled={!comp.items.length} onClick={exportSvg}>Скачать SVG</button>
        </div>

        <div className="canvas-wrap">
          <svg
            ref={svgRef}
            data-testid="canvas"
            viewBox={`0 0 ${comp.format.w} ${comp.format.h}`}
            style={{ aspectRatio: `${comp.format.w} / ${comp.format.h}` }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
          >
            <rect width={comp.format.w} height={comp.format.h} fill={canvasColor(comp.scheme)} />
            {comp.items.map((i) => (
              <ItemLayer key={i.uid} item={i} size={comp.size} scheme={comp.scheme} transform={itemTransform(i, comp)} selected={i.uid === selected} />
            ))}
            {sel && selBox && (
              <rect
                className="selection"
                x={-selBox.w / 2}
                y={-selBox.h / 2}
                width={selBox.w}
                height={selBox.h}
                transform={`translate(${sel.cx} ${sel.cy}) rotate(${sel.rotation})`}
              />
            )}
          </svg>
          {!comp.items.length && <p className="hint">Введите метафору или названия объектов слева либо добавьте объект из библиотеки.</p>}
        </div>
      </main>
    </div>
  );
}
