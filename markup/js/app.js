/*
 * Redline Markup Studio — application: document model, canvas view, tools,
 * properties panel, sheets, file I/O (.redline), export (PNG/JPG/PDF).
 */
(function () {
  'use strict';
  const RL = window.RL;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const FORMAT_ID = 'redline';
  const FORMAT_VERSION = 1;
  const EXT = '.redline';
  // PDF.js 3.11.174 is bundled in lib/ so PDF import works offline; the CDN is a fallback.
  const PDFJS_SOURCES = ['lib/pdfjs/', 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/'];
  const PDF_IMPORT_DPI = 150;
  const MAX_DIM = 12000;

  /* =====================================================================
   * Tool defaults. Size values are "nominal" and get multiplied by the
   * sheet's size factor so markup is legible on large drawings.
   * ===================================================================== */
  const RED = '#e53935';
  const SCALED = ['width', 'fontSize', 'r', 'arc', 'block', 'radius'];
  const today = () => new Date().toISOString().slice(0, 10);
  const toolStyles = {
    arrow: { stroke: RED, width: 3, opacity: 1, dash: 'solid', heads: 'end' },
    line: { stroke: RED, width: 3, opacity: 1, dash: 'solid', heads: 'none' },
    rect: { stroke: RED, fill: 'none', width: 3, opacity: 1, dash: 'solid', radius: 0 },
    ellipse: { stroke: RED, fill: 'none', width: 3, opacity: 1, dash: 'solid' },
    cloud: { stroke: RED, fill: 'none', width: 2.5, opacity: 1, arc: 22 },
    pen: { stroke: RED, width: 3, opacity: 1 },
    highlight: { stroke: '#ffeb3b', width: 22, opacity: 0.5 },
    text: { stroke: RED, fill: 'none', fontSize: 22, bold: false, border: false, opacity: 1 },
    callout: { stroke: RED, fill: '#ffffff', width: 2, fontSize: 18, bold: false, opacity: 1, dash: 'solid', tipEnd: 'arrow' },
    balloon: { stroke: RED, fill: '#ffffff', width: 2, r: 16, shape: 'circle', opacity: 1, tipEnd: 'arrow' },
    dimension: { stroke: '#1565c0', fill: 'none', width: 1.5, fontSize: 16, opacity: 1, precision: 2 },
    stamp: { stroke: '#c62828', fill: 'none', width: 3, fontSize: 34, opacity: 0.85, text: 'APPROVED', sub: '' },
    blur: { mode: 'pixelate', block: 12, fill: '#000000', opacity: 1 },
  };
  const TOOL_NAMES = {
    select: 'Select', pan: 'Pan', arrow: 'Arrow', line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse', cloud: 'Revision cloud',
    pen: 'Pen', highlight: 'Highlighter', text: 'Text', callout: 'Callout', balloon: 'Balloon', dimension: 'Dimension',
    stamp: 'Stamp', blur: 'Blur / redact', crop: 'Crop / extend', calibrate: 'Calibrate',
  };
  const TYPE_NAMES = { line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse', cloud: 'Revision cloud', pen: 'Pen', highlight: 'Highlight', text: 'Text', callout: 'Callout', balloon: 'Balloon', dimension: 'Dimension', stamp: 'Stamp', blur: 'Blur / redact' };
  const TOOL_HINTS = {
    select: 'Click to select · Shift+click to add · drag empty space to box-select · double-click to edit text',
    pan: 'Drag to pan · Ctrl+wheel to zoom',
    arrow: 'Drag to draw · Shift snaps to 15°', line: 'Drag to draw · Shift snaps to 15°',
    rect: 'Drag to draw · Shift for square', ellipse: 'Drag to draw · Shift for circle',
    cloud: 'Drag to wrap a revision cloud around a change', pen: 'Draw freehand · Shift for straight line',
    highlight: 'Drag to highlight · Shift for straight line', text: 'Click to place text · Ctrl+Enter to finish',
    callout: 'Drag from the point of interest to where the note goes', balloon: 'Click to place · drag from a feature to add a leader · numbers auto-increment',
    dimension: 'Drag between two points · drag the middle handle to offset', stamp: 'Click to place the stamp',
    blur: 'Drag over the area to obscure', crop: 'Drag a region — outside the sheet extends the canvas · Enter to apply',
    calibrate: 'Draw a line over a feature of known length',
  };
  const TOOL_KEYS = { v: 'select', h: 'pan', a: 'arrow', l: 'line', r: 'rect', e: 'ellipse', k: 'cloud', p: 'pen', g: 'highlight', t: 'text', c: 'callout', b: 'balloon', d: 'dimension', s: 'stamp', u: 'blur', x: 'crop', m: 'calibrate' };
  const SWATCHES = ['#e53935', '#fb8c00', '#fdd835', '#ffeb3b', '#43a047', '#1e88e5', '#1565c0', '#8e24aa', '#d81b60', '#000000', '#616161', '#ffffff'];

  /* =====================================================================
   * State
   * ===================================================================== */
  const images = new Map(); // id -> { src, img }
  const state = {
    doc: null,
    cur: 0,
    tool: 'select',
    sel: new Set(),
    view: { zoom: 1, x: 0, y: 0 },
    fileHandle: null,
    fileName: 'Untitled' + EXT,
    dirty: false,
    crop: null,
  };
  let drag = null;
  let editing = null;
  let spaceDown = false;
  let clipboard = null;
  let hover = null;
  const history = { stack: [], idx: -1 };

  const newDoc = () => ({ id: RL.uid('doc'), title: 'Untitled', created: new Date().toISOString(), sheets: [] });
  const sheet = () => state.doc.sheets[state.cur] || null;
  const objs = () => (sheet() ? sheet().objects : []);
  const selected = () => objs().filter((o) => state.sel.has(o.id));
  const sizeFactor = (s) => (s ? clamp(Math.round((Math.max(s.width, s.height) / 1600) * 2) / 2, 1, 10) : 1);

  /* =====================================================================
   * DOM
   * ===================================================================== */
  const stage = $('#stage');
  const canvas = $('#canvas');
  const ctx = canvas.getContext('2d');
  let dpr = 1;

  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    canvas.style.width = r.width + 'px';
    canvas.style.height = r.height + 'px';
    if (!state.view.fitted && sheet()) fit();
    render();
  }
  new ResizeObserver(resize).observe(stage);

  function toDoc(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    return { x: (clientX - r.left - state.view.x) / state.view.zoom, y: (clientY - r.top - state.view.y) / state.view.zoom };
  }
  function toScreen(x, y) {
    return { x: x * state.view.zoom + state.view.x, y: y * state.view.zoom + state.view.y };
  }

  /* =====================================================================
   * History (undo/redo) — JSON snapshots of the sheets. Images are held
   * separately by id, so snapshots stay small.
   * ===================================================================== */
  function snapshot() { return JSON.stringify({ sheets: state.doc.sheets, cur: state.cur }); }
  function commit() {
    const s = snapshot();
    if (history.stack[history.idx] === s) return;
    history.stack.length = history.idx + 1;
    history.stack.push(s);
    if (history.stack.length > 300) history.stack.shift();
    history.idx = history.stack.length - 1;
    setDirty(true);
    scheduleThumb();
    scheduleAutosave();
    updateUndoButtons();
  }
  function resetHistory() {
    history.stack = [snapshot()];
    history.idx = 0;
    updateUndoButtons();
  }
  function restore(s) {
    const d = JSON.parse(s);
    const prevCount = state.doc.sheets.length;
    state.doc.sheets = d.sheets;
    state.cur = clamp(d.cur, 0, Math.max(0, d.sheets.length - 1));
    state.sel.clear();
    state.crop = null;
    setDirty(true);
    renderTray();
    if (prevCount !== d.sheets.length) fit();
    refresh();
    scheduleAutosave();
    updateUndoButtons();
  }
  function undo() { cancelEdit(); if (history.idx > 0) { history.idx--; restore(history.stack[history.idx]); } }
  function redo() { cancelEdit(); if (history.idx < history.stack.length - 1) { history.idx++; restore(history.stack[history.idx]); } }
  function updateUndoButtons() {
    $('[data-cmd=undo]').disabled = history.idx <= 0;
    $('[data-cmd=redo]').disabled = history.idx >= history.stack.length - 1;
  }

  function setDirty(v) {
    state.dirty = v;
    $('#dirtyDot').classList.toggle('on', v && state.doc.sheets.length > 0);
    $('#docName').textContent = state.fileName;
    document.title = (v ? '• ' : '') + state.fileName.replace(/\.redline$/i, '') + ' — Redline Markup Studio';
  }

  /* =====================================================================
   * Rendering
   * ===================================================================== */
  let raf = 0;
  function render() { if (!raf) raf = requestAnimationFrame(draw); }
  function refresh() { render(); updatePanel(); updateStatus(); }

  function envFor(s, extra) {
    const bg = s.background ? images.get(s.background) : null;
    return Object.assign({ bgImage: bg ? bg.img : null, bgX: s.bgX || 0, bgY: s.bgY || 0, bgColor: s.bgColor || '#ffffff', scale: s.scale }, extra);
  }
  function drawSheet(c, s, extra) {
    const env = envFor(s, extra);
    c.save();
    c.beginPath(); c.rect(0, 0, s.width, s.height); c.clip();
    c.fillStyle = env.bgColor;
    c.fillRect(0, 0, s.width, s.height);
    if (env.bgImage) c.drawImage(env.bgImage, env.bgX, env.bgY);
    for (const o of s.objects) RL.drawObject(c, o, env);
    if (extra && extra.draft) RL.drawObject(c, extra.draft, env);
    c.restore();
  }

  function draw() {
    raf = 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = sheet();
    $('#welcome').hidden = !!s;
    if (!s) return;
    const z = state.view.zoom;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * state.view.x, dpr * state.view.y);
    // drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 18 * dpr;
    ctx.shadowOffsetY = 3 * dpr;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, s.width, s.height);
    ctx.restore();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = z < 1 ? 'high' : 'medium';
    drawSheet(ctx, s, { hideTextId: editing && editing.hide ? editing.obj.id : null, draft: drag && drag.draft });
    drawOverlays(s, z);
  }

  function drawOverlays(s, z) {
    const px = 1 / z;
    ctx.save();
    // hover outline
    if (hover && !state.sel.has(hover.id) && !drag) {
      const b = RL.getBounds(hover);
      ctx.strokeStyle = 'rgba(90,169,255,0.7)';
      ctx.lineWidth = px;
      ctx.setLineDash([]);
      ctx.strokeRect(b.x - 3 * px, b.y - 3 * px, b.w + 6 * px, b.h + 6 * px);
    }
    // selection
    const sel = selected();
    ctx.lineWidth = px;
    for (const o of sel) {
      const b = RL.getBounds(o);
      ctx.strokeStyle = '#1e88e5';
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.strokeRect(b.x - 4 * px, b.y - 4 * px, b.w + 8 * px, b.h + 8 * px);
    }
    ctx.setLineDash([]);
    if (sel.length === 1 && !(drag && drag.mode === 'move')) {
      for (const h of RL.getHandles(sel[0])) {
        const r = 4.5 * px;
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#1e88e5';
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        if (h.kind === 'round') ctx.arc(h.x, h.y, r * 1.1, 0, Math.PI * 2);
        else ctx.rect(h.x - r, h.y - r, r * 2, r * 2);
        ctx.fill(); ctx.stroke();
      }
    }
    // marquee
    if (drag && drag.mode === 'marquee') {
      const r = rectOf(drag.start, drag.cur);
      ctx.fillStyle = 'rgba(30,136,229,0.08)';
      ctx.strokeStyle = '#1e88e5';
      ctx.lineWidth = px;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
    }
    // crop
    const cr = drag && drag.mode === 'crop' ? rectOf(drag.start, drag.cur) : state.crop;
    if (cr) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      const big = 1e6;
      ctx.beginPath();
      ctx.rect(-big, -big, big * 2, big * 2);
      ctx.rect(cr.x, cr.y, cr.w, cr.h);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.strokeRect(cr.x, cr.y, cr.w, cr.h);
      ctx.setLineDash([]);
      // rule-of-thirds guides
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = px;
      ctx.beginPath();
      for (const f of [1 / 3, 2 / 3]) {
        ctx.moveTo(cr.x + cr.w * f, cr.y); ctx.lineTo(cr.x + cr.w * f, cr.y + cr.h);
        ctx.moveTo(cr.x, cr.y + cr.h * f); ctx.lineTo(cr.x + cr.w, cr.y + cr.h * f);
      }
      ctx.stroke();
    }
    // calibrate line
    if (drag && drag.mode === 'calibrate') {
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([8 * px, 4 * px]);
      ctx.beginPath(); ctx.moveTo(drag.start.x, drag.start.y); ctx.lineTo(drag.cur.x, drag.cur.y); ctx.stroke();
      ctx.setLineDash([]);
      for (const p of [drag.start, drag.cur]) {
        ctx.beginPath(); ctx.moveTo(p.x - 8 * px, p.y); ctx.lineTo(p.x + 8 * px, p.y); ctx.moveTo(p.x, p.y - 8 * px); ctx.lineTo(p.x, p.y + 8 * px); ctx.stroke();
      }
      const L = RL.geo.dist(drag.start.x, drag.start.y, drag.cur.x, drag.cur.y);
      ctx.font = `${13 * px}px system-ui, sans-serif`;
      ctx.fillStyle = '#00e5ff';
      ctx.fillText(`${L.toFixed(1)} px`, drag.cur.x + 10 * px, drag.cur.y - 10 * px);
    }
    ctx.restore();
  }
  function rectOf(a, b) {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  /* =====================================================================
   * View: zoom / pan / fit
   * ===================================================================== */
  function fit() {
    const s = sheet();
    if (!s) return;
    const r = stage.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const pad = 36;
    const z = Math.min((r.width - pad * 2) / s.width, (r.height - pad * 2) / s.height, 2);
    state.view.zoom = Math.max(0.02, z);
    state.view.x = (r.width - s.width * state.view.zoom) / 2;
    state.view.y = (r.height - s.height * state.view.zoom) / 2;
    state.view.fitted = true;
    updateZoomLabel();
    render();
  }
  function zoomAt(newZoom, sx, sy) {
    const r = stage.getBoundingClientRect();
    if (sx == null) { sx = r.width / 2; sy = r.height / 2; }
    const z0 = state.view.zoom;
    const z1 = clamp(newZoom, 0.02, 32);
    state.view.x = sx - (sx - state.view.x) * (z1 / z0);
    state.view.y = sy - (sy - state.view.y) * (z1 / z0);
    state.view.zoom = z1;
    updateZoomLabel();
    positionEditor();
    render();
  }
  const ZOOM_STEPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16];
  function zoomStep(dir) {
    const z = state.view.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z * 1.01) : [...ZOOM_STEPS].reverse().find((s) => s < z * 0.99);
    zoomAt(next || z);
  }
  function updateZoomLabel() { $('#zoomLabel').textContent = Math.round(state.view.zoom * 100) + '%'; }

  /* =====================================================================
   * Object creation
   * ===================================================================== */
  function styleFor(tool) {
    const st = clone(toolStyles[tool] || {});
    const k = sizeFactor(sheet());
    for (const key of SCALED) if (typeof st[key] === 'number') st[key] = Math.round(st[key] * k * 10) / 10;
    return st;
  }
  function makeObj(tool, p) {
    const st = styleFor(tool);
    const id = RL.uid();
    switch (tool) {
      case 'arrow': case 'line':
        return Object.assign({ id, type: 'line', x1: p.x, y1: p.y, x2: p.x, y2: p.y }, st);
      case 'rect': case 'ellipse': case 'cloud': case 'blur':
        return Object.assign({ id, type: tool, x: p.x, y: p.y, w: 0, h: 0 }, st);
      case 'callout': {
        const w = st.fontSize * 11, h = st.fontSize * 3.2;
        return Object.assign({ id, type: 'callout', tx: p.x, ty: p.y, x: p.x - w / 2, y: p.y - h / 2, w, h, text: '' }, st);
      }
      case 'dimension':
        return Object.assign({ id, type: 'dimension', x1: p.x, y1: p.y, x2: p.x, y2: p.y, offset: 0, text: '' }, st);
      case 'pen': case 'highlight':
        return Object.assign({ id, type: tool, points: [[p.x, p.y]] }, st);
      case 'text':
        return Object.assign({ id, type: 'text', x: p.x, y: p.y - st.fontSize * 0.7, text: '' }, st);
      case 'stamp':
        return Object.assign({ id, type: 'stamp', x: p.x, y: p.y }, st, { sub: st.sub || today() });
      case 'balloon':
        return Object.assign({ id, type: 'balloon', cx: p.x, cy: p.y, tx: null, ty: null, label: nextBalloonLabel(st.shape) }, st);
    }
    return null;
  }
  function nextBalloonLabel(shape) {
    const list = objs().filter((o) => o.type === 'balloon' && (o.shape === 'triangle') === (shape === 'triangle'));
    if (shape === 'triangle') {
      // revision deltas: count up numerically too, but allow letters (A, B, …)
      const letters = list.map((o) => String(o.label)).filter((l) => /^[A-Z]$/.test(l));
      if (letters.length && letters.length === list.length) {
        return String.fromCharCode(Math.max(...letters.map((l) => l.charCodeAt(0))) + 1);
      }
    }
    const nums = list.map((o) => parseInt(o.label, 10)).filter((n) => !isNaN(n));
    return String(nums.length ? Math.max(...nums) + 1 : 1);
  }
  function addObject(o, { select = true } = {}) {
    sheet().objects.push(o);
    if (select) { state.sel.clear(); state.sel.add(o.id); }
  }
  function typeToTool(o) {
    if (o.type === 'line') return o.heads && o.heads !== 'none' ? 'arrow' : 'line';
    return o.type;
  }

  /* =====================================================================
   * Hit testing helpers
   * ===================================================================== */
  function topHit(p) {
    const tol = 6 / state.view.zoom;
    const list = objs();
    for (let i = list.length - 1; i >= 0; i--) if (RL.hitTest(list[i], p.x, p.y, tol)) return list[i];
    return null;
  }
  function handleAt(p) {
    const sel = selected();
    if (sel.length !== 1) return null;
    const r = 8 / state.view.zoom;
    for (const h of RL.getHandles(sel[0])) if (Math.abs(h.x - p.x) <= r && Math.abs(h.y - p.y) <= r) return { obj: sel[0], id: h.id };
    return null;
  }

  /* =====================================================================
   * Pointer interaction
   * ===================================================================== */
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('dblclick', onDblClick);
  canvas.addEventListener('pointerleave', () => { hover = null; render(); });

  function onDown(e) {
    if (editing) { commitEdit(); }
    canvas.setPointerCapture(e.pointerId);
    const p = toDoc(e.clientX, e.clientY);
    if (e.button === 1 || e.button === 2 || spaceDown || state.tool === 'pan') {
      drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
      canvas.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const s = sheet();
    if (!s) return;
    const tool = state.tool;

    // Handles of the selected object always win (any tool)
    const h = tool !== 'crop' && tool !== 'calibrate' ? handleAt(p) : null;
    if (h) {
      drag = { mode: 'handle', obj: h.obj, id: h.id, orig: clone(h.obj), changed: false };
      return;
    }
    // Clicking the selected object while a drawing tool is active moves it
    if (tool !== 'select' && tool !== 'crop' && tool !== 'calibrate') {
      const hit = topHit(p);
      if (hit && state.sel.has(hit.id)) { beginMove(p); return; }
    }

    switch (tool) {
      case 'select': {
        const hit = topHit(p);
        if (hit) {
          if (e.shiftKey) {
            if (state.sel.has(hit.id)) { state.sel.delete(hit.id); refresh(); return; }
            state.sel.add(hit.id);
          } else if (!state.sel.has(hit.id)) {
            state.sel.clear(); state.sel.add(hit.id);
          }
          if (e.altKey) duplicateSelection(0);
          beginMove(p);
        } else {
          if (!e.shiftKey) state.sel.clear();
          drag = { mode: 'marquee', start: p, cur: p, base: new Set(state.sel) };
        }
        refresh();
        return;
      }
      case 'crop':
        state.crop = null;
        $('#cropbar').hidden = true;
        drag = { mode: 'crop', start: p, cur: p };
        return;
      case 'calibrate':
        drag = { mode: 'calibrate', start: p, cur: p };
        return;
      case 'text': {
        const hit = topHit(p);
        if (hit && EDIT_FIELD[hit.type]) {
          state.sel.clear(); state.sel.add(hit.id);
          startEdit(hit, false);
          refresh();
          return;
        }
        const o = makeObj('text', p);
        addObject(o);
        startEdit(o, true);
        refresh();
        return;
      }
      case 'stamp': {
        const o = makeObj('stamp', p);
        const b = RL.getBounds(o);
        o.x -= b.w / 2; o.y -= b.h / 2;
        addObject(o);
        commit();
        refresh();
        return;
      }
      case 'balloon':
        drag = { mode: 'create', tool, start: p, draft: makeObj('balloon', p) };
        return;
      default:
        drag = { mode: 'create', tool, start: p, draft: makeObj(tool, p) };
        state.sel.clear();
        refresh();
    }
  }
  function beginMove(p) {
    drag = { mode: 'move', start: p, origs: selected().map((o) => ({ o, orig: clone(o) })), moved: false };
  }

  function onMove(e) {
    const p = toDoc(e.clientX, e.clientY);
    updateStatus(p);
    if (!drag) { updateHover(p); return; }
    switch (drag.mode) {
      case 'pan':
        state.view.x = drag.vx + (e.clientX - drag.sx);
        state.view.y = drag.vy + (e.clientY - drag.sy);
        break;
      case 'handle':
        Object.assign(drag.obj, clone(drag.orig));
        RL.applyHandle(drag.obj, drag.orig, drag.id, p.x, p.y, e.shiftKey);
        drag.changed = true;
        break;
      case 'move': {
        let dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        for (const { o, orig } of drag.origs) {
          Object.assign(o, clone(orig));
          RL.moveBy(o, dx, dy);
        }
        if (dx || dy) drag.moved = true;
        break;
      }
      case 'marquee': {
        drag.cur = p;
        const r = rectOf(drag.start, p);
        state.sel = new Set(drag.base);
        for (const o of objs()) {
          const b = RL.getBounds(o);
          if (b.x <= r.x + r.w && b.x + b.w >= r.x && b.y <= r.y + r.h && b.y + b.h >= r.y) state.sel.add(o.id);
        }
        break;
      }
      case 'crop': case 'calibrate': {
        let q = p;
        if (drag.mode === 'calibrate' && e.shiftKey) q = RL.geo.snapAngle(drag.start.x, drag.start.y, p.x, p.y, 45);
        drag.cur = q;
        if (drag.mode === 'crop') updateCropInfo(rectOf(drag.start, q));
        break;
      }
      case 'create':
        updateDraft(drag.draft, drag.start, p, e.shiftKey);
        break;
    }
    render();
  }

  function updateDraft(o, s, p, shift) {
    switch (o.type) {
      case 'line': case 'dimension': {
        const q = shift ? RL.geo.snapAngle(s.x, s.y, p.x, p.y) : p;
        o.x2 = q.x; o.y2 = q.y;
        break;
      }
      case 'rect': case 'ellipse': case 'cloud': case 'blur': {
        let w = p.x - s.x, h = p.y - s.y;
        if (shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
        o.x = s.x; o.y = s.y; o.w = w; o.h = h;
        break;
      }
      case 'callout':
        o.tx = s.x; o.ty = s.y;
        o.x = p.x - o.w / 2; o.y = p.y - o.h / 2;
        break;
      case 'balloon':
        if (RL.geo.dist(s.x, s.y, p.x, p.y) > 6 / state.view.zoom) { o.tx = s.x; o.ty = s.y; o.cx = p.x; o.cy = p.y; }
        else { o.tx = null; o.ty = null; o.cx = s.x; o.cy = s.y; }
        break;
      case 'pen': case 'highlight': {
        if (shift) { const q = RL.geo.snapAngle(s.x, s.y, p.x, p.y); o.points = [o.points[0], [q.x, q.y]]; break; }
        const last = o.points[o.points.length - 1];
        if (RL.geo.dist(last[0], last[1], p.x, p.y) >= 1.2 / state.view.zoom) o.points.push([round1(p.x), round1(p.y)]);
        break;
      }
    }
  }
  const round1 = (v) => Math.round(v * 10) / 10;

  function onUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    const minPx = 4 / state.view.zoom;
    switch (d.mode) {
      case 'pan':
        canvas.style.cursor = '';
        break;
      case 'handle':
        if (d.changed) { RL.normalize(d.obj); commit(); }
        break;
      case 'move':
        if (d.moved) commit();
        break;
      case 'crop': {
        const r = rectOf(d.start, d.cur);
        if (r.w > minPx && r.h > minPx) {
          state.crop = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
          $('#cropbar').hidden = false;
          updateCropInfo(state.crop);
        }
        break;
      }
      case 'calibrate': {
        const L = RL.geo.dist(d.start.x, d.start.y, d.cur.x, d.cur.y);
        if (L > minPx) openCalibrate(L);
        break;
      }
      case 'create': {
        const o = d.draft;
        let keep = true;
        if (o.type === 'line' || o.type === 'dimension') keep = RL.geo.dist(o.x1, o.y1, o.x2, o.y2) > minPx;
        else if ('w' in o && o.type !== 'callout') keep = Math.abs(o.w) > minPx && Math.abs(o.h) > minPx;
        if (o.type === 'callout' && RL.geo.dist(o.tx, o.ty, o.x + o.w / 2, o.y + o.h / 2) < minPx * 2) {
          // simple click: place the note up and to the right of the point
          const off = o.h * 1.2;
          o.x = o.tx + off; o.y = o.ty - off - o.h;
        }
        if (o.type === 'dimension' && keep) {
          const off = (o.fontSize || 16) * 1.5;
          o.offset = -off; // put dimension line above/left of the measured points
        }
        if (keep) {
          RL.normalize(o);
          addObject(o);
          commit();
          if (o.type === 'callout') startEdit(o, true);
        }
        break;
      }
    }
    refresh();
  }

  function onDblClick(e) {
    const p = toDoc(e.clientX, e.clientY);
    const hit = topHit(p);
    if (hit && ['text', 'callout', 'balloon', 'stamp', 'dimension'].includes(hit.type)) {
      state.sel.clear(); state.sel.add(hit.id);
      startEdit(hit, false);
      refresh();
    }
  }

  function updateHover(p) {
    const s = sheet();
    if (!s) return;
    let cursor = '';
    const tool = state.tool;
    const h = tool !== 'crop' && tool !== 'calibrate' ? handleAt(p) : null;
    let newHover = null;
    if (spaceDown || tool === 'pan') cursor = 'grab';
    else if (h) cursor = RL.handleCursor(h.id);
    else {
      const hit = topHit(p);
      if (tool === 'select') { cursor = hit ? 'move' : 'default'; newHover = hit; }
      else if (hit && state.sel.has(hit.id)) cursor = 'move';
      else cursor = tool === 'text' ? 'text' : 'crosshair';
    }
    canvas.style.cursor = cursor;
    if (newHover !== hover) { hover = newHover; render(); }
  }

  /* Wheel: scroll pans, Ctrl/⌘+wheel (or pinch) zooms at the cursor */
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!sheet()) return;
    if (editing) commitEdit();
    const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
    if (e.ctrlKey || e.metaKey) {
      const r = canvas.getBoundingClientRect();
      zoomAt(state.view.zoom * Math.exp(-e.deltaY * unit * 0.0022), e.clientX - r.left, e.clientY - r.top);
    } else {
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
      state.view.x -= dx * unit;
      state.view.y -= dy * unit;
      render();
    }
  }, { passive: false });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* =====================================================================
   * In-place text editing
   * ===================================================================== */
  const EDIT_FIELD = { text: 'text', callout: 'text', balloon: 'label', stamp: 'text', dimension: 'text' };
  function startEdit(o, isNew) {
    cancelEdit();
    const field = EDIT_FIELD[o.type];
    if (!field) return;
    const ta = document.createElement('textarea');
    ta.className = 'text-editor';
    ta.spellcheck = true;
    ta.value = o[field] ?? '';
    const hide = o.type === 'text' || o.type === 'callout';
    if (!hide) ta.classList.add('boxed');
    if (o.type === 'callout') ta.classList.add('wrap');
    if (o.type === 'dimension') ta.placeholder = RL.formatLength(Math.hypot(o.x2 - o.x1, o.y2 - o.y1), sheet().scale, o.precision ?? 2);
    stage.appendChild(ta);
    editing = { obj: o, field, ta, isNew, hide, before: o[field] ?? '', t0: performance.now() };
    ta.addEventListener('input', () => {
      o[field] = ta.value;
      if (o.type === 'callout') RL.fitCallout(o);
      positionEditor();
      render();
    });
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      const singleLine = !hide;
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey || singleLine))) {
        e.preventDefault();
        commitEdit();
      }
    });
    ta.addEventListener('blur', () => setTimeout(() => {
      if (!editing || editing.ta !== ta) return;
      // the click that created the editor can steal focus right away — take it back
      if (performance.now() - editing.t0 < 400) { ta.focus(); return; }
      commitEdit();
    }, 0));
    positionEditor();
    render();
    ta.focus();
    ta.select();
    setTimeout(() => { if (editing && editing.ta === ta && document.activeElement !== ta) ta.focus(); }, 0);
  }
  function positionEditor() {
    if (!editing) return;
    const { obj: o, ta } = editing;
    const z = state.view.zoom;
    ta.style.color = o.stroke;
    if (o.type === 'text') {
      const m = RL.textMetrics(o);
      const p = toScreen(o.x + m.pad, o.y + m.pad);
      ta.style.left = p.x + 'px';
      ta.style.top = p.y + 'px';
      ta.style.font = `${o.bold ? 'bold ' : ''}${o.fontSize * z}px Arial, Helvetica, sans-serif`;
      ta.style.lineHeight = '1.25';
      ta.style.width = Math.max(m.w - m.pad * 2, o.fontSize) * z + o.fontSize * z + 'px';
      ta.style.height = m.lines.length * m.lineH * z + 2 + 'px';
    } else if (o.type === 'callout') {
      const m = RL.calloutMetrics(o);
      const p = toScreen(m.b.x + m.pad, m.b.y + m.pad);
      ta.style.left = p.x + 'px';
      ta.style.top = p.y + 'px';
      ta.style.font = `${o.bold ? 'bold ' : ''}${o.fontSize * z}px Arial, Helvetica, sans-serif`;
      ta.style.lineHeight = '1.25';
      ta.style.width = (m.b.w - m.pad * 2) * z + 'px';
      ta.style.height = Math.max(m.b.h - m.pad * 2, m.lineH) * z + 'px';
    } else {
      const b = RL.getBounds(o);
      const c = o.type === 'dimension' ? (() => { const g = { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 }; return g; })() : { x: (o.cx ?? b.x + b.w / 2), y: (o.cy ?? b.y + b.h / 2) };
      const p = toScreen(c.x, c.y);
      const w = 160, h = 28;
      ta.style.font = '14px system-ui, sans-serif';
      ta.style.left = p.x - w / 2 + 'px';
      ta.style.top = p.y - h / 2 + 'px';
      ta.style.width = w + 'px';
      ta.style.height = h + 'px';
    }
  }
  function commitEdit() {
    if (!editing) return;
    const { obj: o, field, ta, isNew } = editing;
    editing = null;
    o[field] = ta.value;
    ta.remove();
    if (o.type === 'callout') RL.fitCallout(o);
    if (o.type === 'text' && !o.text.trim()) {
      const s = sheet();
      s.objects = s.objects.filter((x) => x.id !== o.id);
      state.sel.delete(o.id);
      if (isNew) { refresh(); return; }
    }
    commit();
    refresh();
  }
  function cancelEdit() {
    if (!editing) return;
    commitEdit();
  }

  /* =====================================================================
   * Selection commands
   * ===================================================================== */
  function deleteSelection() {
    const s = sheet();
    if (!s || !state.sel.size) return;
    s.objects = s.objects.filter((o) => !state.sel.has(o.id));
    state.sel.clear();
    commit();
    refresh();
  }
  function duplicateSelection(offset = 20) {
    const s = sheet();
    const copies = selected().map((o) => { const c = clone(o); c.id = RL.uid(); RL.moveBy(c, offset, offset); return c; });
    if (!copies.length) return;
    s.objects.push(...copies);
    state.sel = new Set(copies.map((c) => c.id));
    if (offset) { commit(); refresh(); }
  }
  function copySelection() {
    const sel = selected();
    if (sel.length) { clipboard = clone(sel); toast(`Copied ${sel.length} annotation${sel.length > 1 ? 's' : ''}`); }
  }
  function pasteClipboard() {
    const s = sheet();
    if (!s || !clipboard) return false;
    const k = 20 * sizeFactor(s);
    const copies = clipboard.map((o) => { const c = clone(o); c.id = RL.uid(); RL.moveBy(c, k, k); return c; });
    clipboard = clone(copies);
    s.objects.push(...copies);
    state.sel = new Set(copies.map((c) => c.id));
    commit();
    refresh();
    return true;
  }
  function reorder(kind) {
    const s = sheet();
    if (!s || !state.sel.size) return;
    const list = s.objects;
    const isSel = (o) => state.sel.has(o.id);
    if (kind === 'toFront') s.objects = [...list.filter((o) => !isSel(o)), ...list.filter(isSel)];
    else if (kind === 'toBack') s.objects = [...list.filter(isSel), ...list.filter((o) => !isSel(o))];
    else if (kind === 'forward') {
      for (let i = list.length - 2; i >= 0; i--) if (isSel(list[i]) && !isSel(list[i + 1])) [list[i], list[i + 1]] = [list[i + 1], list[i]];
    } else if (kind === 'backward') {
      for (let i = 1; i < list.length; i++) if (isSel(list[i]) && !isSel(list[i - 1])) [list[i], list[i - 1]] = [list[i - 1], list[i]];
    }
    commit();
    render();
  }
  function nudge(dx, dy) {
    const sel = selected();
    if (!sel.length) return;
    sel.forEach((o) => RL.moveBy(o, dx, dy));
    commit();
    render();
  }

  /* =====================================================================
   * Tools
   * ===================================================================== */
  function setTool(t) {
    if (editing) commitEdit();
    if (t !== 'crop') { state.crop = null; $('#cropbar').hidden = true; }
    state.tool = t;
    $$('#toolrail [data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    if (t !== 'select' && t !== 'pan' && t !== 'crop' && t !== 'calibrate') state.sel.clear();
    $('#stHint').textContent = TOOL_HINTS[t] || '';
    canvas.style.cursor = t === 'pan' ? 'grab' : t === 'select' ? 'default' : 'crosshair';
    refresh();
  }
  $$('#toolrail [data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));

  /* Crop / extend canvas — non-destructive: only the sheet frame and the
   * background offset change; the original image is kept in the file. */
  function updateCropInfo(r) {
    $('#cropInfo').textContent = `${Math.round(r.w)} × ${Math.round(r.h)} px`;
  }
  function applyCrop() {
    const s = sheet(), r = state.crop;
    if (!s || !r) return;
    const w = clamp(r.w, 1, MAX_DIM), h = clamp(r.h, 1, MAX_DIM);
    s.width = w; s.height = h;
    s.bgX = (s.bgX || 0) - r.x;
    s.bgY = (s.bgY || 0) - r.y;
    s.objects.forEach((o) => RL.moveBy(o, -r.x, -r.y));
    state.crop = null;
    $('#cropbar').hidden = true;
    commit();
    fit();
    setTool('select');
    renderTray();
    toast('Canvas cropped — the original image is preserved in the .redline file');
  }
  function cancelCrop() {
    state.crop = null;
    $('#cropbar').hidden = true;
    render();
  }
  function addMargin() {
    const s = sheet();
    if (!s) return;
    const m = Math.round(Math.max(s.width, s.height) * 0.08);
    s.width = Math.min(MAX_DIM, s.width + m * 2);
    s.height = Math.min(MAX_DIM, s.height + m * 2);
    s.bgX = (s.bgX || 0) + m;
    s.bgY = (s.bgY || 0) + m;
    s.objects.forEach((o) => RL.moveBy(o, m, m));
    commit();
    fit();
    renderTray();
    refresh();
  }

  /* Scale calibration */
  let calPx = 0;
  function openCalibrate(lenPx) {
    const s = sheet();
    if (!s) return;
    calPx = lenPx || 0;
    $('#calMeasured').hidden = !calPx;
    $('#calTip').hidden = !!calPx;
    $('#calUseLine').hidden = !calPx;
    $('#calPx').textContent = `${calPx.toFixed(1)} px`;
    $('#calLen').value = '';
    $('#calDpi').value = s.dpi || 96;
    if (s.scale && s.scale.unit) $('#calUnit').value = s.scale.unit;
    const dlg = $('#calDlg');
    dlg.returnValue = '';
    dlg.showModal();
    if (calPx) setTimeout(() => $('#calLen').focus(), 0);
  }
  $('#calDlg').addEventListener('close', () => {
    const dlg = $('#calDlg');
    const s = sheet();
    if (!s) return;
    const unit = $('#calUnit').value;
    let factor = 0;
    if (dlg.returnValue === 'ok') {
      const len = parseFloat($('#calLen').value);
      if (!(len > 0) || !calPx) { toast('Enter the real length of the line', true); return; }
      factor = len / calPx;
    } else if (dlg.returnValue === 'paper') {
      const dpi = parseFloat($('#calDpi').value), ratio = parseFloat($('#calRatio').value) || 1;
      if (!(dpi > 0)) { toast('Enter the sheet DPI', true); return; }
      const inchPerPx = (1 / dpi) * ratio;
      const perInch = { mm: 25.4, cm: 2.54, m: 0.0254, in: 1, ft: 1 / 12, 'ft-in': 1 }[unit];
      factor = inchPerPx * perInch;
    } else return;
    s.scale = { factor, unit };
    commit();
    if (state.tool === 'calibrate') setTool('dimension');
    refresh();
    toast(`Scale set: 100 px = ${RL.formatLength(100, s.scale, 3)}`);
  });

  /* =====================================================================
   * Properties panel
   * ===================================================================== */
  function buildSwatches() {
    $$('.swatches').forEach((wrap) => {
      const key = wrap.dataset.swatch;
      if (wrap.dataset.none) {
        const n = document.createElement('button');
        n.className = 'sw none'; n.title = 'No fill'; n.dataset.val = 'none';
        wrap.appendChild(n);
      }
      for (const c of SWATCHES) {
        const b = document.createElement('button');
        b.className = 'sw'; b.style.background = c; b.dataset.val = c; b.title = c;
        wrap.appendChild(b);
      }
      const custom = document.createElement('input');
      custom.type = 'color'; custom.className = 'sw-custom'; custom.title = 'Custom color';
      wrap.appendChild(custom);
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('.sw');
        if (b) applyProp(key, b.dataset.val, true);
      });
      custom.addEventListener('input', () => applyProp(key, custom.value, false));
      custom.addEventListener('change', () => applyProp(key, custom.value, true));
    });
  }

  function contextTypes() {
    const sel = selected();
    if (sel.length) return { types: new Set(sel.map((o) => o.type)), src: sel[0], isSel: true };
    const t = state.tool;
    if (toolStyles[t]) {
      const type = t === 'arrow' ? 'line' : t;
      return { types: new Set([type]), src: styleFor(t), isSel: false };
    }
    return { types: new Set(), src: null, isSel: false };
  }

  function updatePanel() {
    const ctxT = contextTypes();
    const { types, src, isSel } = ctxT;
    const sel = selected();
    $('#propEmpty').hidden = types.size > 0;
    let title = 'Properties';
    if (isSel) title = sel.length === 1 ? TYPE_NAMES[sel[0].type] : `${sel.length} annotations`;
    else if (types.size) title = `${TOOL_NAMES[state.tool]} — defaults`;
    $('#propTitle').textContent = title;
    $('#fillLabel').textContent = types.has('blur') && types.size === 1 ? 'Redact color' : types.has('dimension') ? 'Label background' : 'Fill';
    for (const prop of $$('#propSection .prop')) {
      const pts = prop.dataset.types.split(',');
      const show = types.size > 0 && pts.some((t) => types.has(t)) && (!prop.dataset.selOnly || isSel);
      prop.hidden = !show;
      if (!show || !src) continue;
      for (const input of $$('[data-k]', prop)) {
        const k = input.dataset.k;
        const target = (isSel ? sel.find((o) => pts.includes(o.type) && k in o) : src) || src;
        let v = target ? target[k] : undefined;
        if (input.type === 'checkbox') input.checked = !!v;
        else if (input.tagName === 'SELECT') {
          const has = $$('option', input).some((o) => o.value === String(v));
          input.value = has ? String(v) : (input.classList.contains('stamp-presets') ? '' : input.value);
          if (!has && input.classList.contains('stamp-presets')) input.selectedIndex = -1;
        } else if (document.activeElement !== input) {
          input.value = v ?? '';
        }
        if (k === 'opacity') $('#opacityOut').textContent = Math.round((v ?? 1) * 100) + '%';
      }
      const sw = $('.swatches', prop);
      if (sw) {
        const k = sw.dataset.swatch;
        const target = (isSel ? sel.find((o) => k in o) : src) || {};
        const v = String(target[k] || '').toLowerCase();
        $$('.sw', sw).forEach((b) => b.classList.toggle('on', b.dataset.val.toLowerCase() === v));
        const custom = $('.sw-custom', sw);
        if (/^#[0-9a-f]{6}$/.test(v)) custom.value = v;
      }
    }
    $('#arrangeSection').hidden = !isSel;
    // sheet info
    const s = sheet();
    $('#sheetSection').hidden = !s;
    if (s) {
      if (document.activeElement !== $('#sheetName')) $('#sheetName').value = s.name;
      $('#sheetSize').textContent = `${s.width} × ${s.height} px`;
      $('#sheetScale').textContent = s.scale ? `100 px = ${RL.formatLength(100, s.scale, 3)}` : 'Not calibrated';
      $('#sheetBg').value = s.bgColor || '#ffffff';
    }
  }

  let propCommitTimer = 0;
  function applyProp(key, value, doCommit) {
    const sel = selected();
    const k = sizeFactor(sheet());
    if (sel.length) {
      for (const o of sel) {
        if (!(key in o) && !(key === 'fill' && ['rect', 'ellipse', 'cloud', 'text', 'callout', 'balloon', 'stamp', 'blur', 'dimension'].includes(o.type))) continue;
        o[key] = value;
        if (o.type === 'callout') RL.fitCallout(o);
        // remember as the default for this kind of annotation
        const tool = typeToTool(o);
        if (toolStyles[tool] && key in toolStyles[tool] && key !== 'text' && key !== 'label') {
          toolStyles[tool][key] = SCALED.includes(key) && typeof value === 'number' ? value / k : value;
        }
      }
      if (doCommit) commit();
      else { clearTimeout(propCommitTimer); propCommitTimer = setTimeout(commit, 600); }
      positionEditor();
    } else if (toolStyles[state.tool]) {
      toolStyles[state.tool][key] = SCALED.includes(key) && typeof value === 'number' ? value / k : value;
    }
    saveStyles();
    refresh();
  }

  $('#propSection').addEventListener('input', (e) => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    const v = readInput(el);
    if (v === undefined) return;
    applyProp(el.dataset.k, v, false);
  });
  $('#propSection').addEventListener('change', (e) => {
    const el = e.target.closest('[data-k]');
    if (!el) return;
    const v = readInput(el);
    if (v === undefined) return;
    applyProp(el.dataset.k, v, true);
  });
  function readInput(el) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'number' || el.type === 'range') {
      const n = parseFloat(el.value);
      return isNaN(n) ? undefined : n;
    }
    if (el.dataset.k === 'precision') return parseInt(el.value, 10);
    return el.value;
  }

  $('#sheetName').addEventListener('change', (e) => {
    const s = sheet();
    if (!s) return;
    s.name = e.target.value.trim() || s.name;
    commit();
    renderTray();
  });
  $('#sheetBg').addEventListener('input', (e) => { const s = sheet(); if (s) { s.bgColor = e.target.value; render(); } });
  $('#sheetBg').addEventListener('change', () => { commit(); });

  function saveStyles() {
    try { localStorage.setItem('redline.toolStyles', JSON.stringify(toolStyles)); } catch (_) { /* ignore */ }
  }
  function loadStyles() {
    try {
      const saved = JSON.parse(localStorage.getItem('redline.toolStyles') || 'null');
      if (saved) for (const t in saved) if (toolStyles[t]) Object.assign(toolStyles[t], saved[t]);
    } catch (_) { /* ignore */ }
  }

  /* =====================================================================
   * Status bar
   * ===================================================================== */
  let lastPos = null;
  function updateStatus(p) {
    if (p) lastPos = p;
    const s = sheet();
    $('#stTool').textContent = TOOL_NAMES[state.tool];
    if (s && lastPos) {
      let t = `X ${Math.round(lastPos.x)}  Y ${Math.round(lastPos.y)} px`;
      if (s.scale) t += `   (${RL.formatLength(lastPos.x, s.scale)}, ${RL.formatLength(lastPos.y, s.scale)})`;
      $('#stPos').textContent = t;
    } else $('#stPos').textContent = '';
    $('#stSheet').textContent = s ? `Sheet ${state.cur + 1}/${state.doc.sheets.length} · ${s.width}×${s.height}` : '';
  }

  /* =====================================================================
   * Sheets tray
   * ===================================================================== */
  const trayList = $('#trayList');
  function renderTray() {
    trayList.innerHTML = '';
    state.doc.sheets.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'thumb' + (i === state.cur ? ' active' : '');
      item.title = `${s.name} — double-click to rename`;
      const c = document.createElement('canvas');
      item.appendChild(c);
      const label = document.createElement('div');
      label.className = 'tname';
      label.textContent = `${i + 1}. ${s.name}`;
      item.appendChild(label);
      item.addEventListener('click', () => switchSheet(i));
      item.addEventListener('dblclick', () => {
        const n = prompt('Sheet name', s.name);
        if (n && n.trim()) { s.name = n.trim(); commit(); renderTray(); updatePanel(); }
      });
      trayList.appendChild(item);
      drawThumb(c, s);
    });
  }
  function drawThumb(c, s) {
    const k = Math.min(116 / s.width, 70 / s.height);
    c.width = Math.max(1, Math.round(s.width * k));
    c.height = Math.max(1, Math.round(s.height * k));
    const x = c.getContext('2d');
    x.scale(k, k);
    x.imageSmoothingQuality = 'high';
    drawSheet(x, s);
  }
  let thumbTimer = 0;
  function scheduleThumb() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      const c = trayList.children[state.cur] && trayList.children[state.cur].querySelector('canvas');
      const s = sheet();
      if (c && s) drawThumb(c, s);
      else renderTray();
    }, 250);
  }
  function switchSheet(i) {
    if (i === state.cur && sheet()) return;
    if (editing) commitEdit();
    state.cur = clamp(i, 0, state.doc.sheets.length - 1);
    state.sel.clear();
    state.crop = null;
    $('#cropbar').hidden = true;
    renderTray();
    fit();
    refresh();
    const el = trayList.children[state.cur];
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function addSheet(s, { switchTo = true, record = true } = {}) {
    state.doc.sheets.push(s);
    if (switchTo) state.cur = state.doc.sheets.length - 1;
    state.sel.clear();
    if (record) commit();
    renderTray();
    fit();
    refresh();
  }
  function newSheet(fields) {
    return Object.assign({
      id: RL.uid('sheet'), name: 'Sheet ' + (state.doc.sheets.length + 1), width: 1600, height: 1000,
      background: null, bgX: 0, bgY: 0, bgColor: '#ffffff', dpi: 96, scale: null, objects: [],
    }, fields);
  }
  function deleteSheet() {
    const s = sheet();
    if (!s) return;
    if (s.objects.length && !confirm(`Delete "${s.name}" and its ${s.objects.length} annotation(s)?`)) return;
    state.doc.sheets.splice(state.cur, 1);
    state.cur = clamp(state.cur, 0, Math.max(0, state.doc.sheets.length - 1));
    state.sel.clear();
    commit();
    renderTray();
    fit();
    refresh();
  }
  function duplicateSheet() {
    const s = sheet();
    if (!s) return;
    const c = clone(s);
    c.id = RL.uid('sheet');
    c.name = s.name + ' (copy)';
    c.objects.forEach((o) => (o.id = RL.uid()));
    state.doc.sheets.splice(state.cur + 1, 0, c);
    state.cur++;
    commit();
    renderTray();
    refresh();
  }
  function moveSheet(dir) {
    const i = state.cur, j = i + dir;
    const list = state.doc.sheets;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    state.cur = j;
    commit();
    renderTray();
    refresh();
  }

  /* =====================================================================
   * Importing images / PDFs
   * ===================================================================== */
  function loadImage(src) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Could not decode image'));
      img.src = src;
    });
  }
  function readAsDataURL(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.readAsDataURL(blob);
    });
  }
  async function registerImage(src, id) {
    const img = await loadImage(src);
    id = id || RL.uid('img');
    images.set(id, { src, img });
    return { id, img };
  }
  const baseName = (n) => String(n || 'Image').replace(/\.[^.]+$/, '');

  async function importImageSrc(src, name, extra = {}) {
    let { id, img } = await registerImage(src);
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > MAX_DIM || h > MAX_DIM) {
      // downscale oversize images to keep the browser responsive
      const k = MAX_DIM / Math.max(w, h);
      const c = document.createElement('canvas');
      c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      images.delete(id);
      ({ id, img } = await registerImage(c.toDataURL('image/png')));
      w = c.width; h = c.height;
      if (extra.dpi) extra.dpi *= k;
    }
    addSheet(newSheet(Object.assign({ name: baseName(name), width: w, height: h, background: id }, extra)));
  }
  async function importImageFile(file) {
    await importImageSrc(await readAsDataURL(file), file.name);
  }

  let pdfjsPromise = null;
  function loadScript(src) {
    return new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = src;
      el.onload = res;
      el.onerror = () => { el.remove(); rej(new Error('failed to load ' + src)); };
      document.head.appendChild(el);
    });
  }
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    pdfjsPromise = pdfjsPromise || (async () => {
      for (const base of PDFJS_SOURCES) {
        try {
          await loadScript(base + 'pdf.min.js');
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
          // Web Workers can't start from file:// pages, so run the worker code in-page there.
          if (location.protocol === 'file:') await loadScript(base + 'pdf.worker.min.js');
          return window.pdfjsLib;
        } catch (_) { /* try next source */ }
      }
      pdfjsPromise = null;
      throw new Error('Could not load the PDF engine (lib/pdfjs is missing and the CDN is unreachable).');
    })();
    return pdfjsPromise;
  }
  async function importPdfFile(file) {
    toast(`Loading ${file.name}…`);
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const base = baseName(file.name);
    for (let n = 1; n <= pdf.numPages; n++) {
      toast(`Rendering ${file.name}: page ${n} of ${pdf.numPages}…`);
      const page = await pdf.getPage(n);
      const vp1 = page.getViewport({ scale: 1 });
      const scale = Math.min(PDF_IMPORT_DPI / 72, MAX_DIM / Math.max(vp1.width, vp1.height), 8000 / Math.max(vp1.width, vp1.height));
      const vp = page.getViewport({ scale });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const src = c.toDataURL('image/png');
      const name = pdf.numPages > 1 ? `${base} — p${n}` : base;
      const { id } = await registerImage(src);
      state.doc.sheets.push(newSheet({ name, width: c.width, height: c.height, background: id, dpi: 72 * scale }));
      if (n === 1) state.cur = state.doc.sheets.length - 1;
      renderTray();
      if (n === 1) { fit(); refresh(); }
    }
    commit();
    refresh();
    toast(`Imported ${pdf.numPages} page${pdf.numPages > 1 ? 's' : ''} from ${file.name}`);
  }

  async function handleFiles(files) {
    const list = Array.from(files || []);
    for (const f of list) {
      const n = f.name.toLowerCase();
      try {
        if (n.endsWith(EXT) || n.endsWith('.json')) {
          if (!confirmDiscard()) return;
          await loadRedline(await f.text(), f.name, null);
        } else if (f.type === 'application/pdf' || n.endsWith('.pdf')) {
          await importPdfFile(f);
        } else if (f.type.startsWith('image/') || /\.(png|jpe?g|gif|bmp|webp|svg)$/.test(n)) {
          await importImageFile(f);
        } else {
          toast(`Unsupported file: ${f.name}`, true);
        }
      } catch (err) {
        console.error(err);
        toast(`Could not open ${f.name}: ${err.message}`, true);
      }
    }
  }

  /* =====================================================================
   * .redline files (save / open)
   * ===================================================================== */
  function serialize() {
    const used = new Set(state.doc.sheets.map((s) => s.background).filter(Boolean));
    const imgs = {};
    used.forEach((id) => { const im = images.get(id); if (im) imgs[id] = im.src; });
    const out = {
      format: FORMAT_ID,
      version: FORMAT_VERSION,
      generator: 'Redline Markup Studio',
      title: state.fileName.replace(/\.redline$/i, ''),
      created: state.doc.created,
      modified: new Date().toISOString(),
      sheets: state.doc.sheets,
      images: imgs,
    };
    return JSON.stringify(out, null, 1);
  }

  async function loadRedline(text, name, handle) {
    let d;
    try { d = JSON.parse(text); } catch (_) { throw new Error('Not a valid .redline file (bad JSON)'); }
    if (!d || d.format !== FORMAT_ID || !Array.isArray(d.sheets)) throw new Error('Not a .redline document');
    if (d.version > FORMAT_VERSION) toast('This file was made by a newer version; some features may be missing.', true);
    images.clear();
    await Promise.all(Object.entries(d.images || {}).map(([id, src]) => registerImage(src, id).catch(() => null)));
    const doc = newDoc();
    doc.created = d.created || doc.created;
    doc.sheets = d.sheets.map((s) => Object.assign(newSheet({}), s, { objects: Array.isArray(s.objects) ? s.objects : [] }));
    state.doc = doc;
    state.cur = 0;
    state.sel.clear();
    state.fileHandle = handle || null;
    state.fileName = name && /\.redline$/i.test(name) ? name : baseName(name || 'Untitled') + EXT;
    resetHistory();
    setDirty(false);
    renderTray();
    fit();
    refresh();
    clearAutosave();
    toast(`Opened ${state.fileName}`);
  }

  async function save(saveAs) {
    if (!state.doc.sheets.length) { toast('Nothing to save yet'); return; }
    if (editing) commitEdit();
    const blob = new Blob([serialize()], { type: 'application/json' });
    if (window.showSaveFilePicker) {
      try {
        if (saveAs || !state.fileHandle) {
          state.fileHandle = await window.showSaveFilePicker({
            suggestedName: state.fileName,
            types: [{ description: 'Redline markup document', accept: { 'application/json': [EXT] } }],
          });
        }
        const w = await state.fileHandle.createWritable();
        await w.write(blob);
        await w.close();
        state.fileName = state.fileHandle.name;
        setDirty(false);
        clearAutosave();
        toast(`Saved ${state.fileName}`);
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        state.fileHandle = null; // fall back to a download
      }
    }
    if (saveAs || !state.savedOnce) {
      const n = prompt('File name', state.fileName);
      if (!n) return;
      state.fileName = /\.redline$/i.test(n) ? n : n + EXT;
    }
    download(blob, state.fileName);
    state.savedOnce = true;
    setDirty(false);
    clearAutosave();
    toast(`Downloaded ${state.fileName}`);
  }

  async function openDialog() {
    if (window.showOpenFilePicker) {
      try {
        const handles = await window.showOpenFilePicker({
          multiple: true,
          types: [{ description: 'Drawings, images and markup', accept: { 'application/json': [EXT], 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'], 'application/pdf': ['.pdf'] } }],
        });
        for (const h of handles) {
          const f = await h.getFile();
          if (f.name.toLowerCase().endsWith(EXT)) {
            if (!confirmDiscard()) return;
            try { await loadRedline(await f.text(), f.name, h); } catch (err) { toast(err.message, true); }
          } else await handleFiles([f]);
        }
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    $('#fileInput').click();
  }
  $('#fileInput').addEventListener('change', async (e) => {
    await handleFiles(e.target.files);
    e.target.value = '';
  });

  function confirmDiscard() {
    return !state.dirty || !state.doc.sheets.length || confirm('Discard unsaved changes to the current document?');
  }
  function newDocument() {
    if (!confirmDiscard()) return;
    images.clear();
    state.doc = newDoc();
    state.cur = 0;
    state.sel.clear();
    state.fileHandle = null;
    state.fileName = 'Untitled' + EXT;
    state.savedOnce = false;
    resetHistory();
    setDirty(false);
    clearAutosave();
    renderTray();
    refresh();
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  /* =====================================================================
   * Export: PNG / JPG / PDF
   * ===================================================================== */
  function flatten(s, k = 1) {
    const kk = Math.min(k, 16384 / s.width, 16384 / s.height);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(s.width * kk));
    c.height = Math.max(1, Math.round(s.height * kk));
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.scale(kk, kk);
    drawSheet(x, s);
    return c;
  }
  const toBlob = (c, type, q) => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Export failed (image too large?)'))), type, q));
  const safeName = (n) => String(n).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'sheet';

  function openExport() {
    if (!state.doc.sheets.length) { toast('Open or paste an image first'); return; }
    if (editing) commitEdit();
    const dlg = $('#exportDlg');
    const f = dlg.querySelector('form');
    f.which.disabled = state.doc.sheets.length < 2;
    if (state.doc.sheets.length < 2) f.which.value = 'current';
    updateExportNote();
    dlg.returnValue = '';
    dlg.showModal();
  }
  function updateExportNote() {
    const f = $('#exportDlg form');
    const fmt = f.fmt.value;
    $('#expQualityRow').hidden = fmt !== 'jpg';
    const s = sheet();
    const k = parseFloat(f.scale.value);
    const n = f.which.value === 'all' ? state.doc.sheets.length : 1;
    let note = `${Math.round(s.width * k)} × ${Math.round(s.height * k)} px`;
    if (fmt === 'pdf') note = `${n} page${n > 1 ? 's' : ''}. Page size follows each sheet's resolution (${Math.round(s.dpi || 96)} DPI → ${(s.width / (s.dpi || 96)).toFixed(2)} × ${(s.height / (s.dpi || 96)).toFixed(2)} in).`;
    else if (n > 1) note += ` · ${n} files will be downloaded`;
    $('#expNote').textContent = note;
  }
  $('#exportDlg form').addEventListener('change', updateExportNote);
  $('#exportDlg').addEventListener('close', async () => {
    const dlg = $('#exportDlg');
    if (dlg.returnValue !== 'ok') return;
    const f = dlg.querySelector('form');
    try {
      await doExport(f.fmt.value, f.which.value, parseFloat(f.scale.value), parseFloat(f.quality.value));
    } catch (err) {
      console.error(err);
      toast(err.message, true);
    }
  });

  async function doExport(fmt, which, k, quality) {
    const sheets = which === 'all' ? state.doc.sheets : [sheet()];
    const base = safeName(state.fileName.replace(/\.redline$/i, ''));
    const multi = state.doc.sheets.length > 1;
    if (fmt === 'pdf') {
      toast('Building PDF…');
      const pages = [];
      for (const s of sheets) {
        const c = flatten(s, k);
        const jpeg = new Uint8Array(await (await toBlob(c, 'image/jpeg', 0.95)).arrayBuffer());
        const dpi = s.dpi || 96;
        pages.push({ jpeg, pxW: c.width, pxH: c.height, wPt: (s.width / dpi) * 72, hPt: (s.height / dpi) * 72 });
      }
      const blob = RL.buildPDF(pages, { title: base });
      const name = sheets.length === 1 && multi ? `${base} - ${safeName(sheets[0].name)}.pdf` : `${base}.pdf`;
      download(blob, name);
      toast(`Exported ${name}`);
      return;
    }
    const type = fmt === 'jpg' ? 'image/jpeg' : 'image/png';
    for (const s of sheets) {
      const c = flatten(s, k);
      const blob = await toBlob(c, type, fmt === 'jpg' ? quality : undefined);
      const name = multi ? `${base} - ${safeName(s.name)}.${fmt}` : `${base}.${fmt}`;
      download(blob, name);
      if (sheets.length > 1) await new Promise((r) => setTimeout(r, 350));
    }
    toast(`Exported ${sheets.length} ${fmt.toUpperCase()} file${sheets.length > 1 ? 's' : ''}`);
  }

  async function copyImage() {
    const s = sheet();
    if (!s) return;
    try {
      const blob = await toBlob(flatten(s, 1), 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Sheet copied to clipboard as an image');
    } catch (err) {
      toast('Clipboard not available here — use Export instead', true);
    }
  }

  /* =====================================================================
   * Autosave (crash recovery) via IndexedDB
   * ===================================================================== */
  const IDB = { db: null };
  function idb() {
    if (IDB.db) return Promise.resolve(IDB.db);
    return new Promise((res, rej) => {
      try {
        const r = indexedDB.open('redline-markup', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => res((IDB.db = r.result));
        r.onerror = () => rej(r.error);
      } catch (e) { rej(e); }
    });
  }
  async function idbSet(key, val) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, key); t.oncomplete = res; t.onerror = () => rej(t.error); });
  }
  async function idbGet(key) {
    const db = await idb();
    return new Promise((res, rej) => { const t = db.transaction('kv').objectStore('kv').get(key); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); });
  }
  let autosaveTimer = 0;
  function scheduleAutosave() {
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      if (!state.dirty || !state.doc.sheets.length) return;
      try { await idbSet('autosave', { when: Date.now(), name: state.fileName, data: serialize() }); } catch (_) { /* ignore */ }
    }, 2500);
  }
  function clearAutosave() { idbSet('autosave', null).catch(() => {}); }
  async function checkRecovery() {
    try {
      const rec = await idbGet('autosave');
      if (rec && rec.data) {
        $('#recoverMsg').textContent = `Unsaved work "${rec.name}" from ${new Date(rec.when).toLocaleString()} was found.`;
        $('#recover').hidden = false;
        IDB.pending = rec;
      }
    } catch (_) { /* ignore */ }
  }

  /* =====================================================================
   * Commands
   * ===================================================================== */
  async function loadSample() {
    await importImageSrc(RL.makeSampleDrawing(), 'Mounting bracket BRK-1042', { dpi: 101.6, scale: { factor: 0.25, unit: 'mm' } });
    toast('Sample drawing loaded — its scale is pre-calibrated (1 px = 0.25 mm). Try the Dimension tool (D).');
  }
  const commands = {
    new: newDocument,
    open: openDialog,
    insert: () => $('#fileInput').click(),
    save: () => save(false),
    saveAs: () => save(true),
    undo, redo,
    export: openExport,
    copyImage,
    zoomIn: () => zoomStep(1),
    zoomOut: () => zoomStep(-1),
    zoom100: () => zoomAt(1),
    fit,
    help: () => $('#helpDlg').showModal(),
    blank: () => addSheet(newSheet({})),
    sample: loadSample,
    dupSheet: duplicateSheet,
    delSheet: deleteSheet,
    sheetLeft: () => moveSheet(-1),
    sheetRight: () => moveSheet(1),
    applyCrop, cancelCrop,
    crop: () => setTool('crop'),
    addMargin,
    calibrate: () => openCalibrate(0),
    clearScale: () => { const s = sheet(); if (s && s.scale) { s.scale = null; commit(); refresh(); } },
    toFront: () => reorder('toFront'), forward: () => reorder('forward'), backward: () => reorder('backward'), toBack: () => reorder('toBack'),
    duplicate: () => duplicateSelection(),
    delete: deleteSelection,
    recover: async () => {
      $('#recover').hidden = true;
      const rec = IDB.pending;
      if (rec) {
        try { await loadRedline(rec.data, rec.name, null); setDirty(true); } catch (err) { toast(err.message, true); }
      }
    },
    discardRecover: () => { $('#recover').hidden = true; clearAutosave(); },
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (!b || b.disabled) return;
    const fn = commands[b.dataset.cmd];
    if (fn) { e.preventDefault(); Promise.resolve(fn()).catch((err) => { console.error(err); toast(err.message, true); }); }
  });

  /* =====================================================================
   * Keyboard
   * ===================================================================== */
  window.addEventListener('keydown', (e) => {
    const inField = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
    if ($('dialog[open]')) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (e.key === 'F1') { e.preventDefault(); commands.help(); return; }
    if (mod) {
      const map = {
        s: () => save(e.shiftKey), o: openDialog, e: openExport, z: () => (e.shiftKey ? redo() : undo()), y: redo,
        '0': fit, '1': () => zoomAt(1), '=': () => zoomStep(1), '+': () => zoomStep(1), '-': () => zoomStep(-1),
      };
      if (!inField) Object.assign(map, {
        d: () => duplicateSelection(), a: () => { state.sel = new Set(objs().map((o) => o.id)); setToolKeepSel('select'); },
        c: () => (e.shiftKey ? copyImage() : copySelection()), x: () => { copySelection(); deleteSelection(); },
      });
      if (map[k]) { e.preventDefault(); map[k](); }
      return;
    }
    if (inField) return;
    if (e.key === ' ') {
      if (e.target.tagName === 'BUTTON') e.target.blur();
      if (!spaceDown) { spaceDown = true; canvas.style.cursor = 'grab'; }
      e.preventDefault();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
    if (e.key === 'Escape') {
      if (state.crop) cancelCrop();
      else if (drag) { drag = null; render(); }
      else if (state.sel.size) { state.sel.clear(); refresh(); }
      else setTool('select');
      return;
    }
    if (e.key === 'Enter' && state.crop) { applyCrop(); return; }
    if (e.key === 'Enter' && state.sel.size === 1) { const o = selected()[0]; if (EDIT_FIELD[o.type]) { e.preventDefault(); startEdit(o, false); } return; }
    const arrows = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
    if (arrows[k] && state.sel.size) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      nudge(arrows[k][0] * step, arrows[k][1] * step);
      return;
    }
    if (e.key === ']') { reorder(e.shiftKey ? 'toFront' : 'forward'); return; }
    if (e.key === '[') { reorder(e.shiftKey ? 'toBack' : 'backward'); return; }
    if (e.key === '}') { reorder('toFront'); return; }
    if (e.key === '{') { reorder('toBack'); return; }
    if (TOOL_KEYS[k] && !e.altKey) { setTool(TOOL_KEYS[k]); }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { spaceDown = false; canvas.style.cursor = ''; }
  });
  function setToolKeepSel(t) {
    const keep = new Set(state.sel);
    setTool(t);
    state.sel = keep;
    refresh();
  }

  /* Clipboard paste: images become new sheets; otherwise paste annotations */
  document.addEventListener('paste', async (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const items = Array.from((e.clipboardData && e.clipboardData.items) || []);
    const imgItem = items.find((i) => i.type.startsWith('image/'));
    if (imgItem) {
      e.preventDefault();
      const file = imgItem.getAsFile();
      if (file) {
        try { await importImageSrc(await readAsDataURL(file), 'Pasted ' + new Date().toLocaleTimeString()); toast('Pasted image added as a new sheet'); }
        catch (err) { toast(err.message, true); }
      }
      return;
    }
    if (clipboard) { e.preventDefault(); pasteClipboard(); }
  });

  /* Drag & drop files */
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; $('#dropzone').classList.add('on'); e.preventDefault(); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#dropzone').classList.remove('on'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    $('#dropzone').classList.remove('on');
    if (e.dataTransfer && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

  window.addEventListener('beforeunload', (e) => {
    if (state.dirty && state.doc.sheets.length) { e.preventDefault(); e.returnValue = ''; }
  });

  /* =====================================================================
   * Toast
   * ===================================================================== */
  let toastTimer = 0;
  function toast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), isErr ? 5000 : 3000);
  }

  /* =====================================================================
   * Boot
   * ===================================================================== */
  loadStyles();
  buildSwatches();
  state.doc = newDoc();
  resetHistory();
  setDirty(false);
  renderTray();
  setTool('select');
  checkRecovery();

  // Small test/automation hook
  RL.app = { state, images, commands, serialize, loadRedline, doExport, setTool, fit, handleFiles, flatten, sheet };
})();
