import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useReducedMotion, type AnimationPlaybackControls } from 'motion/react';
import { AlertCircle, ArrowDown, ChevronDown, Eraser, Undo2, ArrowDownToLine, ArrowUp, ArrowUpToLine, Copy, Download, Loader2, Minus, Plus, Trash2, Upload } from 'lucide-react';
import { DECORS, FORMATS, OBJECTS, PRESETS, S_TO_L, SCHEMES, getAsset, type Format, type Kind, type Preset, type Size } from './core/catalog';
import { layout, newUid, type LayoutInput } from './core/layout';
import { matchNames } from './core/match';
import { OWN_ROLES, addSchemes, customSchemes, parsePalettes, uiAccent } from './core/palette';
import { canvasColor, decorMarkup, itemMarkup, itemSize, itemTransform, renderSvg, type Composition, type Item } from './core/render';
import { BODIES } from './bodies';

const nameOf = (slug: string) => OBJECTS.find((o) => o.slug === slug)?.nameRu ?? slug;

const lerpMatrix = (m: DOMMatrix, t: number) =>
  `matrix(${[m.a, m.b, m.c, m.d, m.e, m.f].map((v, i) => v + ([1, 0, 0, 1, 0, 0][i] - v) * t).join(',')})`;

/**
 * Объект на холсте. Внешний <g data-uid transform> — как в экспорте; анимируются только внутренние обёртки:
 * .flip — плавный переход позиций при смене пресета/формата (FLIP), motion.g — появление и удаление.
 */
const ItemLayer = memo(function ItemLayer(p: {
  item: Item; size: Size; scheme: string; transform: string; selected: boolean; delay: number; lift: number; flipKey: number;
}) {
  const html = useMemo(
    () => itemMarkup(p.item, { size: p.size, scheme: p.scheme }, BODIES, p.item.uid),
    [p.item.slug, p.item.kind, p.item.uid, p.size, p.scheme],
  );
  const reduce = useReducedMotion();
  const outer = useRef<SVGGElement>(null);
  const flip = useRef<SVGGElement>(null);
  const last = useRef<{ m: DOMMatrix; key: number } | null>(null);
  const anim = useRef<AnimationPlaybackControls | null>(null);

  useLayoutEffect(() => {
    const m = outer.current!.transform.baseVal.consolidate()?.matrix;
    if (!m) return;
    const prev = last.current;
    last.current = { m: DOMMatrix.fromMatrix(m), key: p.flipKey };
    if (!prev || prev.key === p.flipKey || reduce) return;
    // смещение «новое → старое» в локальных координатах объекта, затем к единичной матрице
    const d = DOMMatrix.fromMatrix(m).inverse().multiply(prev.m);
    const el = flip.current!;
    anim.current?.stop();
    anim.current = animate(0, 1, {
      duration: 0.3,
      ease: [0.4, 0, 0.2, 1],
      onUpdate: (t) => (el.style.transform = lerpMatrix(d, t)),
      onComplete: () => (el.style.transform = ''),
    });
  }, [p.transform, p.flipKey]);

  return (
    <g ref={outer} data-uid={p.item.uid} data-slug={p.item.slug} data-kind={p.item.kind} className={p.selected ? 'item selected' : 'item'} transform={p.transform} fill="none">
      <g ref={flip}>
        <motion.g
          initial={reduce ? false : { opacity: 0, scale: 0.92, y: p.lift }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduce ? undefined : { opacity: 0, scale: 0.96, transition: { duration: 0.16, ease: 'easeIn' } }}
          transition={{ duration: 0.22, ease: 'easeOut', delay: p.delay }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </g>
    </g>
  );
});

/** Миниатюра для библиотеки: настоящий SVG объекта (размер S) нужного вида в текущей схеме. */
const Thumb = memo(function Thumb({ slug, kind, scheme }: { slug: string; kind: Kind; scheme: string }) {
  const { w, h } = getAsset(slug, 'S', kind).bbox;
  const html = useMemo(() => itemMarkup({ slug, kind } as Item, { size: 'S', scheme }, BODIES, `t-${slug}-${kind}`), [slug, kind, scheme]);
  return <svg viewBox={`0 0 ${w} ${h}`} fill="none" aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
});

const withBackground = (slugs: string[], background: string[]): LayoutInput[] => [
  ...slugs.map((slug) => ({ slug, kind: 'main' as Kind })),
  ...background.map((slug) => ({ slug, kind: 'bg' as Kind })),
];
const listing = (slugs: string[], background: string[]) =>
  [slugs.map(nameOf).join(', '), background.length ? `фон: ${background.map(nameOf).join(', ')}` : ''].filter(Boolean).join(' · ');

// загруженные палитры помним в браузере зрителя; без доступа к localStorage они живут до перезагрузки
const PALETTES_KEY = 'custom-palettes';
function restorePalettes() {
  try {
    const saved = localStorage.getItem(PALETTES_KEY);
    if (saved) addSchemes(parsePalettes(saved));
  } catch {
    // нет доступа или старая запись не проходит проверку — работаем со встроенными схемами
  }
}
function savePalettes() {
  try {
    const schemes = customSchemes().map(({ id, name, colors }) => ({ id, name, colors: Object.fromEntries(OWN_ROLES.map((r) => [r, colors[r]])) }));
    localStorage.setItem(PALETTES_KEY, JSON.stringify({ schemes }));
  } catch {
    // приватный режим и т. п.
  }
}

export function App() {
  useState(restorePalettes); // до первого рендера панели палитр
  const [comp, setComp] = useState<Composition>({ format: FORMATS[1], size: 'L', scheme: SCHEMES[0].id, scale: 1, items: [], decor: 'confetti' });
  const [preset, setPreset] = useState<Preset>('assembled');
  // подсветка пресета: true, пока расстановка сделана пресетом (А/Б, кнопка пресета, смена формата); ручные правки её гасят
  const [arranged, setArranged] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [metaphor, setMetaphor] = useState('');
  const [names, setNames] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [libKind, setLibKind] = useState<Kind>('main');
  // свёрнута ли библиотека — помним между визитами; без доступа к localStorage просто открыта
  const [libOpen, setLibOpen] = useState(() => {
    try {
      return localStorage.getItem('library-open') !== '0';
    } catch {
      return true;
    }
  });
  const toggleLibrary = () => {
    setLibOpen(!libOpen);
    try {
      localStorage.setItem('library-open', libOpen ? '0' : '1');
    } catch {
      // приватный режим и т. п. — состояние просто не сохранится
    }
  };
  const [flipKey, setFlipKey] = useState(0);
  const svgRef = useRef<SVGSVGElement>(null);
  // перетаскивание объекта или ручки поворота над рамкой выделения
  const drag = useRef<{ uid: string; dx: number; dy: number; rotate?: boolean } | null>(null);
  // задержка появления по uid: каскад при сборке композиции
  const enterDelay = useRef<Record<string, number>>({});

  const sel = comp.items.find((i) => i.uid === selected) ?? null;
  const scheme = SCHEMES.find((s) => s.id === comp.scheme)!;
  const update = (fn: (c: Composition) => Composition) => setComp((c) => fn(c));
  const updateItem = (uid: string, patch: Partial<Item>) =>
    update((c) => ({ ...c, items: c.items.map((i) => (i.uid === uid ? { ...i, ...patch } : i)) }));
  const say = (text: string, isError = false) => {
    setStatus(text);
    setError(isError);
    setCleared(null);
  };
  // «Очистить» без подтверждения, но с возвратом: последняя очищенная композиция до следующего действия
  const [cleared, setCleared] = useState<Composition | null>(null);
  function clearCanvas() {
    say('Холст очищен');
    setCleared(comp);
    update((c) => ({ ...c, items: [] }));
    setSelected(null);
    setArranged(false);
  }
  function restoreCanvas() {
    if (!cleared) return;
    update((c) => ({ ...c, scale: cleared.scale, items: cleared.items }));
    say('Холст возвращён');
  }
  const decorHtml = useMemo(() => decorMarkup(comp, BODIES), [comp.decor, comp.format, comp.scheme]);

  /** keep: та же композиция в другом пресете/формате — объекты сохраняют uid и плавно переезжают. */
  function relayout(inputs: LayoutInput[], p = preset, c: Pick<Composition, 'size' | 'format'> = comp, keep = false) {
    const res = layout(inputs, c.size, c.format, p);
    const pool = [...comp.items];
    const items = keep
      ? res.items.map((it) => {
          const j = pool.findIndex((o) => o.slug === it.slug && o.kind === it.kind);
          return j < 0 ? it : { ...it, uid: pool.splice(j, 1)[0].uid };
        })
      : res.items;
    if (keep) setFlipKey((k) => k + 1);
    else items.forEach((it, i) => (enterDelay.current[it.uid] = i * 0.04));
    setComp((prev) => ({ ...prev, ...c, scale: res.scale, items }));
    setSelected(null);
    setArranged(true);
  }

  async function fromMetaphor() {
    if (!metaphor.trim()) return;
    setBusy(true);
    say('Подбираю объекты…');
    try {
      const res = await fetch('/api/compose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: metaphor }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const r = (await res.json()) as { slugs: string[]; background?: string[]; preset: Preset; source: string; model?: string; reason?: string; rateLimited?: boolean };
      const background = r.background ?? [];
      setPreset(r.preset);
      relayout(withBackground(r.slugs, background), r.preset);
      const why = r.rateLimited ? 'слишком много запросов к LLM, повторите через минуту' : 'LLM недоступна';
      const how =
        r.source === 'llm' ? `LLM (${r.model})` : r.source === 'keywords' ? `поиск по ключевым словам (${why})` : `базовый набор: совпадений не найдено (${why})`;
      say(`${listing(r.slugs, background)} — ${how}${r.reason ? `. ${r.reason}` : ''}`);
    } catch (e) {
      say(`Ошибка запроса: ${(e as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  function fromNames() {
    const { slugs, background, unknown } = matchNames(names, OBJECTS);
    if (!slugs.length && !background.length) return say(`Не нашёл объектов${unknown.length ? `: ${unknown.join(', ')}` : ''}`, true);
    relayout(withBackground(slugs, background));
    say(`${listing(slugs, background)}${unknown.length ? ` · не распознано: ${unknown.join(', ')}` : ''}`);
  }

  // объект из библиотеки сразу встраивается в композицию; первый объект включает «Собранно»
  function addObject(slug: string, kind: Kind) {
    say(''); // прежнее сообщение («Холст очищен», список из Б) к новой композиции уже не относится
    const p = comp.items.length ? preset : 'assembled';
    setPreset(p);
    // новый фоновый — самым нижним слоем
    relayout(kind === 'bg' ? [{ slug, kind }, ...inputs()] : [...inputs(), { slug, kind }], p, comp, true);
  }

  const inputs = () => comp.items.map(({ slug, kind }) => ({ slug, kind }));
  const setFormat = (f: Format) =>
    comp.items.length ? relayout(inputs(), preset, { ...comp, format: f }, true) : update((c) => ({ ...c, format: f }));
  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (comp.items.length) relayout(inputs(), p, comp, true);
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
    setArranged(false);
  }
  const remove = (uid: string) => {
    update((c) => ({ ...c, items: c.items.filter((i) => i.uid !== uid) }));
    setSelected(null);
    setArranged(false);
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
    if (sel && (e.target as Element).closest('[data-handle=rotate]')) {
      drag.current = { uid: sel.uid, dx: 0, dy: 0, rotate: true };
      svgRef.current!.setPointerCapture(e.pointerId);
      return;
    }
    const g = (e.target as Element).closest('[data-uid]');
    const it = g && comp.items.find((i) => i.uid === g.getAttribute('data-uid'));
    if (!it) return setSelected(null); // пустое место или объект, который сейчас исчезает
    const p = toCanvas(e);
    drag.current = { uid: it.uid, dx: p.x - it.cx, dy: p.y - it.cy };
    setSelected(it.uid);
    svgRef.current!.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const p = toCanvas(e);
    if (drag.current.rotate) {
      const it = comp.items.find((i) => i.uid === drag.current!.uid);
      if (!it) return;
      // ручка над объектом: угол 0° — ручка строго сверху; с Shift — шаг 15°
      const deg = (Math.atan2(p.y - it.cy, p.x - it.cx) * 180) / Math.PI + 90;
      const snapped = e.shiftKey ? Math.round(deg / 15) * 15 : Math.round(deg);
      updateItem(it.uid, { rotation: ((((snapped + 180) % 360) + 360) % 360) - 180 });
    } else updateItem(drag.current.uid, { cx: p.x - drag.current.dx, cy: p.y - drag.current.dy });
    setArranged(false);
  }

  const paletteFile = useRef<HTMLInputElement>(null);
  async function importPalette(file: File) {
    try {
      if (file.size > 64_000) throw new Error('файл больше 64 КБ');
      const list = parsePalettes(await file.text());
      addSchemes(list);
      savePalettes();
      update((c) => ({ ...c, scheme: list[0].id }));
      say(`Палитра «${list[0].name}» загружена${list.length > 1 ? ` (и ещё ${list.length - 1})` : ''}: объекты и фон перекрашены по ролям цветов`);
    } catch (e) {
      say(`Палитра не загружена: ${(e as Error).message}. Пример формата — /palette-example.json`, true);
    }
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
  // сдвиг при появлении — 8 экранных пикселей, пересчитанные в локальные единицы объекта
  const pxPerUnit = (svgRef.current?.clientWidth || comp.format.w) / comp.format.w;
  const lift = 8 / (comp.scale * pxPerUnit);
  const { w: W, h: H } = comp.format;
  const accents = { '--accent': uiAccent(scheme), '--sticker': scheme.colors.bg1 } as React.CSSProperties;

  return (
    <div className="app" style={accents}>
      <aside className="panel">
        <header className="brand">
          <h1>SVG Composer</h1>
          <p>Векторные композиции из библиотеки объектов</p>
        </header>

        <section>
          <h2>Создать</h2>
          <div className="field">
            <label htmlFor="metaphor"><span className="step">А</span>Метафора или заголовок</label>
            <textarea id="metaphor" data-testid="metaphor" value={metaphor} onChange={(e) => setMetaphor(e.target.value)} placeholder="«Как накопить на мечту»" rows={2} />
            <button data-testid="metaphor-go" className={comp.items.length ? 'secondary' : 'primary'} disabled={busy} aria-busy={busy} onClick={fromMetaphor}>
              {busy && <Loader2 className="spin" size={16} aria-hidden="true" />}
              {busy ? 'Подбираю…' : 'Собрать по смыслу'}
            </button>
          </div>
          <p className="or" aria-hidden="true">или</p>
          <div className="field">
            <label htmlFor="names"><span className="step">Б</span>Названия объектов</label>
            <input id="names" data-testid="names" value={names} onChange={(e) => setNames(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && fromNames()} placeholder="лампа, наушники, книга" />
            <button data-testid="names-go" className="secondary" onClick={fromNames}>Собрать из объектов</button>
          </div>
          <p className={error ? 'status error' : 'status'} data-testid="status" aria-live="polite">
            {error && <AlertCircle size={16} aria-hidden="true" />}
            {status}
            {cleared && !comp.items.length && (
              <button className="ghost undo" data-testid="restore" onClick={restoreCanvas}>
                <Undo2 size={16} aria-hidden="true" />Вернуть
              </button>
            )}
          </p>
        </section>

        <section className={libOpen ? '' : 'collapsed'}>
          <h2>
            <button className="h-toggle" data-testid="library-toggle" aria-expanded={libOpen} aria-controls="library" onClick={toggleLibrary}>
              Библиотека <span className="h-sub">{OBJECTS.length}</span>
              <ChevronDown className="chevron" size={16} aria-hidden />
            </button>
          </h2>
          <div className="collapsible" id="library" inert={!libOpen}>
            {/* одна обёртка: сворачивается только единственная строка сетки .collapsible */}
            <div>
            <div className="segmented lib-kind" role="group" aria-label="Вид объектов в библиотеке">
              <button data-testid="lib-kind-main" className={libKind === 'main' ? 'on' : ''} aria-pressed={libKind === 'main'} onClick={() => setLibKind('main')}>Главные</button>
              <button data-testid="lib-kind-bg" className={libKind === 'bg' ? 'on' : ''} aria-pressed={libKind === 'bg'} onClick={() => setLibKind('bg')}>Фоновые</button>
            </div>
            <div className="library">
              {OBJECTS.map((o) => (
                <button key={o.slug} className="card" data-testid={`add-${o.slug}`} onClick={() => addObject(o.slug, libKind)} title={`Добавить на холст: ${o.nameRu}${libKind === 'bg' ? ' (фоновый)' : ''}`}>
                  <span className="thumb"><Thumb slug={o.slug} kind={libKind} scheme={comp.scheme} /></span>
                  <span className="card-name">{o.nameRu}</span>
                </button>
              ))}
            </div>
            </div>
          </div>
        </section>

        {sel && (
          <section className="selected-panel" data-testid="selected-panel">
            <h2>Объект <span className="h-sub">{nameOf(sel.slug)}</span></h2>
            <div className="segmented" role="group" aria-label="Вид объекта">
              <button className={sel.kind === 'main' ? 'on' : ''} aria-pressed={sel.kind === 'main'} onClick={() => updateItem(sel.uid, { kind: 'main' })}>Главный</button>
              <button data-testid="kind-bg" className={sel.kind === 'bg' ? 'on' : ''} aria-pressed={sel.kind === 'bg'} onClick={() => updateItem(sel.uid, { kind: 'bg' })}>Фоновый</button>
            </div>
            <label className="range">
              <span>Поворот <output>{Math.round(sel.rotation)}°</output></span>
              <input data-testid="rotate" type="range" min={-180} max={180} value={sel.rotation} onChange={(e) => updateItem(sel.uid, { rotation: Number(e.target.value) })} />
            </label>
            <div className="segmented" role="group" aria-label="Порядок слоя">
              <button className="icon" onClick={() => move(sel.uid, 'top')} title="На передний план" aria-label="На передний план"><ArrowUpToLine size={16} /></button>
              <button className="icon" onClick={() => move(sel.uid, 'up')} title="Выше" aria-label="Выше"><ArrowUp size={16} /></button>
              <button className="icon" onClick={() => move(sel.uid, 'down')} title="Ниже" aria-label="Ниже"><ArrowDown size={16} /></button>
              <button className="icon" onClick={() => move(sel.uid, 'bottom')} title="На задний план" aria-label="На задний план"><ArrowDownToLine size={16} /></button>
            </div>
            <div className="actions">
              <button data-testid="duplicate" onClick={() => duplicate(sel.uid)}><Copy size={16} aria-hidden="true" />Дублировать</button>
              <button data-testid="delete" className="danger" onClick={() => remove(sel.uid)}><Trash2 size={16} aria-hidden="true" />Удалить</button>
            </div>
          </section>
        )}

        <section>
          <h2>Слои <span className="h-sub">{comp.items.length || ''}</span></h2>
          <ol className="layers" data-testid="layers">
            {[...comp.items].reverse().map((i) => (
              <li key={i.uid}>
                <button className={i.uid === selected ? 'on' : ''} aria-pressed={i.uid === selected} onClick={() => setSelected(i.uid)}>
                  {nameOf(i.slug)}
                  {i.kind === 'bg' && <span className="tag">фон</span>}
                </button>
              </li>
            ))}
          </ol>
          {!comp.items.length && <p className="muted">Объекты появятся здесь</p>}
        </section>
      </aside>

      <main className="stage">
        <div className="toolbar">
          <div className="settings">
            <div className="tool">
              <label className="tool-label" htmlFor="format">Формат</label>
              <select id="format" data-testid="format" value={comp.format.id} onChange={(e) => setFormat(FORMATS.find((f) => f.id === e.target.value)!)}>
                {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.w}×{f.h}</option>)}
              </select>
            </div>
            <div className="tool">
              <span className="tool-label" id="l-size">Размер объектов</span>
              <div className="segmented" role="group" aria-labelledby="l-size">
                {(['S', 'L'] as Size[]).map((s) => (
                  <button key={s} data-testid={`size-${s}`} className={comp.size === s ? 'on' : ''} aria-pressed={comp.size === s} onClick={() => setSize(s)}>{s}</button>
                ))}
              </div>
            </div>
            <div className="tool">
              <span className="tool-label" id="l-scheme">Палитра</span>
              <div className="row">
                <div className="segmented" role="group" aria-labelledby="l-scheme">
                  {SCHEMES.map((s) => (
                    <button
                      key={s.id}
                      data-testid={`scheme-${s.id}`}
                      className={comp.scheme === s.id ? 'on swatch-btn' : 'swatch-btn'}
                      aria-pressed={comp.scheme === s.id}
                      aria-label={s.name}
                      title={s.name}
                      onClick={() => update((c) => ({ ...c, scheme: s.id }))}
                    >
                      <span className="swatch" style={{ background: `linear-gradient(90deg, ${s.colors.bg1} 0 34%, ${s.colors.bg2} 0 67%, ${s.colors.bg3} 0)` }} />
                    </button>
                  ))}
                </div>
                {/* загрузка — действие, а не вариант выбора: отдельной кнопкой рядом с образцами */}
                <button
                  className="icon secondary"
                  data-testid="palette-upload"
                  onClick={() => paletteFile.current?.click()}
                  aria-label="Загрузить свою палитру (JSON)"
                  title="Загрузить палитру: JSON с цветами фона bg1–bg3 и объектов obj1–obj3, пример — /palette-example.json"
                >
                  <Upload size={16} />
                </button>
                <input
                  ref={paletteFile}
                  data-testid="palette-file"
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = ''; // тот же файл можно загрузить повторно после правки
                    if (f) importPalette(f);
                  }}
                />
              </div>
            </div>
            <div className="tool">
              <label className="tool-label" htmlFor="decor">Фон</label>
              <select id="decor" data-testid="decor" value={comp.decor ?? ''} onChange={(e) => update((c) => ({ ...c, decor: DECORS.find((d) => d.id === e.target.value)?.id }))}>
                <option value="">Без декора</option>
                {DECORS.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div className="tool">
              <label className="tool-label" htmlFor="preset">Раскладка</label>
              {/* после ручной правки пресет не показан — «Вручную»; выбор того же пресета снова расставляет объекты */}
              <select id="preset" data-testid="preset" value={arranged || !comp.items.length ? preset : ''} onChange={(e) => choosePreset(e.target.value as Preset)}>
                <option value="" disabled hidden>Вручную</option>
                {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <button data-testid="export" className={comp.items.length ? 'primary export' : 'secondary export'} disabled={!comp.items.length} onClick={exportSvg}>
            <Download size={16} aria-hidden="true" />Скачать SVG
          </button>
        </div>

        <div className="canvas-wrap" aria-busy={busy}>
          <svg
            ref={svgRef}
            data-testid="canvas"
            viewBox={`0 0 ${W} ${H}`}
            style={{ aspectRatio: `${W} / ${H}`, '--ratio': W / H } as React.CSSProperties}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
          >
            <rect width={W} height={H} fill={canvasColor(comp.scheme)} />
            {decorHtml && <g className="decor" pointerEvents="none" dangerouslySetInnerHTML={{ __html: decorHtml }} />}
            <AnimatePresence>
              {comp.items.map((i) => (
                <ItemLayer
                  key={i.uid}
                  item={i}
                  size={comp.size}
                  scheme={comp.scheme}
                  transform={itemTransform(i, comp)}
                  selected={i.uid === selected}
                  delay={enterDelay.current[i.uid] ?? 0}
                  lift={lift}
                  flipKey={flipKey}
                />
              ))}
            </AnimatePresence>
            {sel && selBox && (
              <g transform={`translate(${sel.cx} ${sel.cy}) rotate(${sel.rotation})`}>
                <rect className="selection" x={-selBox.w / 2} y={-selBox.h / 2} width={selBox.w} height={selBox.h} />
                {/* ручка поворота: 22 экранных пикселя над рамкой, радиус 7 px */}
                <line className="rotate-stem" x1={0} y1={-selBox.h / 2} x2={0} y2={-selBox.h / 2 - 22 / pxPerUnit} />
                <g data-handle="rotate">
                  <circle className="rotate-hit" cx={0} cy={-selBox.h / 2 - 22 / pxPerUnit} r={22 / pxPerUnit} />
                  <circle className="rotate-handle" data-testid="rotate-handle" cx={0} cy={-selBox.h / 2 - 22 / pxPerUnit} r={7 / pxPerUnit}>
                    <title>Повернуть (Shift — шаг 15°)</title>
                  </circle>
                </g>
              </g>
            )}
            {busy && (
              <g className="skeleton" aria-hidden="true">
                {[-1, 0, 1].map((k) => (
                  <rect key={k} x={W / 2 + k * W * 0.22 - W * 0.09} y={H / 2 - H * 0.16 + (k % 2) * H * 0.06} width={W * 0.18} height={H * 0.32} rx={Math.min(W, H) * 0.02} />
                ))}
              </g>
            )}
          </svg>
          {!comp.items.length && !busy && (
            <div className="empty">
              <p className="empty-title">Холст пуст</p>
              <p>Опишите идею (А), перечислите объекты (Б) или выберите объект в библиотеке.</p>
            </div>
          )}
        </div>

        <div className="canvas-tools">
          <div className="segmented" role="group" aria-label="Масштаб">
            <button className="icon" disabled={!comp.items.length} onClick={() => zoom(1 / 1.1)} title="Уменьшить всю композицию" aria-label="Уменьшить всю композицию"><Minus size={16} /></button>
            <button className="icon" disabled={!comp.items.length} onClick={() => zoom(1.1)} title="Увеличить всю композицию" aria-label="Увеличить всю композицию"><Plus size={16} /></button>
          </div>
          <button data-testid="clear" className="secondary" disabled={!comp.items.length} onClick={clearCanvas} title="Убрать все объекты с холста">
            <Eraser size={16} aria-hidden="true" />Очистить
          </button>
        </div>
      </main>
    </div>
  );
}
