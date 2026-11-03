/*
 * Redline Markup Studio — shape engine.
 * Every annotation is a plain JSON object (see FORMAT.md). This file knows how
 * to draw, hit-test, bound, move and resize each annotation type. All
 * coordinates are in sheet (image) pixels.
 */
(function () {
  'use strict';
  const RL = (window.RL = window.RL || {});
  const mctx = document.createElement('canvas').getContext('2d');
  const TAU = Math.PI * 2;

  RL.uid = (p = 'o') =>
    p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

  /* ---------------- geometry helpers ---------------- */
  const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
  function distToSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return dist(px, py, x1 + t * dx, y1 + t * dy);
  }
  function box(o) {
    let { x, y, w, h } = o;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    return { x, y, w, h };
  }
  function normalize(o) {
    if ('w' in o && o.type !== 'text' && o.type !== 'stamp') {
      const b = box(o);
      Object.assign(o, b);
    }
    return o;
  }
  function inBox(px, py, b, pad = 0) {
    return px >= b.x - pad && px <= b.x + b.w + pad && py >= b.y - pad && py <= b.y + b.h + pad;
  }
  function snapAngle(x0, y0, x, y, stepDeg = 15) {
    const a = Math.atan2(y - y0, x - x0);
    const step = (stepDeg * Math.PI) / 180;
    const s = Math.round(a / step) * step;
    const L = dist(x0, y0, x, y);
    return { x: x0 + Math.cos(s) * L, y: y0 + Math.sin(s) * L };
  }
  RL.geo = { dist, distToSeg, box, inBox, snapAngle };
  RL.normalize = normalize;

  /* ---------------- style helpers ---------------- */
  const FONT = 'Arial, Helvetica, sans-serif';
  const font = (o, size, bold) =>
    `${(bold ?? o.bold) ? 'bold ' : ''}${size ?? o.fontSize}px ${o.fontFamily || FONT}`;
  const hasFill = (o) => o.fill && o.fill !== 'none';

  function setDash(ctx, o) {
    const w = Math.max(1, o.width || 1);
    if (o.dash === 'dashed') ctx.setLineDash([w * 4, w * 2.5]);
    else if (o.dash === 'dotted') ctx.setLineDash([0.01, w * 2.2]);
    else if (o.dash === 'center') ctx.setLineDash([w * 8, w * 2, w * 1.5, w * 2]);
    else ctx.setLineDash([]);
  }
  function applyStroke(ctx, o, dash = true) {
    ctx.strokeStyle = o.stroke;
    ctx.lineWidth = o.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (dash) setDash(ctx, o); else ctx.setLineDash([]);
  }
  const headLen = (w) => Math.max(9, w * 3.4 + 7);

  /** Draw a terminator at (tx,ty) for a segment coming from (fx,fy). Returns inset length. */
  function terminator(ctx, fx, fy, tx, ty, w, color, kind = 'arrow') {
    if (kind === 'none') return 0;
    ctx.save();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath();
    if (kind === 'dot') {
      ctx.arc(tx, ty, Math.max(2.5, w * 1.6), 0, TAU);
      ctx.fill();
      ctx.restore();
      return 0;
    }
    const s = headLen(w);
    const a = Math.atan2(ty - fy, tx - fx);
    const spread = Math.PI / 7.5;
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - s * Math.cos(a - spread), ty - s * Math.sin(a - spread));
    ctx.lineTo(tx - s * Math.cos(a + spread), ty - s * Math.sin(a + spread));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    return s * 0.8;
  }

  /** Line from a→b, shortened under terminators, then terminators drawn. */
  function leader(ctx, o, ax, ay, bx, by, endA, endB) {
    const L = dist(ax, ay, bx, by) || 1;
    const ux = (bx - ax) / L, uy = (by - ay) / L;
    const ia = endA === 'arrow' && L > headLen(o.width) ? headLen(o.width) * 0.8 : 0;
    const ib = endB === 'arrow' && L > headLen(o.width) ? headLen(o.width) * 0.8 : 0;
    ctx.beginPath();
    ctx.moveTo(ax + ux * ia, ay + uy * ia);
    ctx.lineTo(bx - ux * ib, by - uy * ib);
    ctx.stroke();
    if (endB && endB !== 'none') terminator(ctx, ax, ay, bx, by, o.width, o.stroke, endB);
    if (endA && endA !== 'none') terminator(ctx, bx, by, ax, ay, o.width, o.stroke, endA);
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r || 0, w / 2, h / 2));
    ctx.beginPath();
    if (!r) { ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function wrapLines(text, maxW, f) {
    mctx.font = f;
    const out = [];
    for (const para of String(text || '').split('\n')) {
      if (!para) { out.push(''); continue; }
      let line = '';
      for (const word of para.split(' ')) {
        const test = line ? line + ' ' + word : word;
        if (line && mctx.measureText(test).width > maxW) { out.push(line); line = word; }
        else line = test;
      }
      out.push(line);
    }
    return out;
  }

  /* ---------------- per-type metrics ---------------- */
  function textMetrics(o) {
    const lines = String(o.text || '').split('\n');
    mctx.font = font(o);
    const lineH = o.fontSize * 1.25;
    const pad = hasFill(o) || o.border ? o.fontSize * 0.35 : o.fontSize * 0.12;
    let maxW = 0;
    for (const l of lines) maxW = Math.max(maxW, mctx.measureText(l).width);
    maxW = Math.max(maxW, o.fontSize * 0.5);
    return { lines, lineH, pad, w: maxW + pad * 2, h: lines.length * lineH + pad * 2 };
  }
  function calloutMetrics(o) {
    const b = box(o);
    const pad = Math.max(4, o.fontSize * 0.45);
    const lines = wrapLines(o.text, Math.max(10, b.w - pad * 2), font(o));
    const lineH = o.fontSize * 1.25;
    return { b, pad, lines, lineH, needH: lines.length * lineH + pad * 2 };
  }
  function calloutAnchor(b, tx, ty) {
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    const sx = dx ? b.w / 2 / Math.abs(dx) : Infinity;
    const sy = dy ? b.h / 2 / Math.abs(dy) : Infinity;
    const s = Math.min(sx, sy);
    if (s >= 1) return null; // tip inside the box: no leader
    return [cx + dx * s, cy + dy * s];
  }
  function stampMetrics(o) {
    const fs = o.fontSize;
    mctx.font = font(o, fs, true);
    const tw = mctx.measureText(o.text || '').width;
    let sw = 0;
    if (o.sub) { mctx.font = font(o, fs * 0.38, true); sw = mctx.measureText(o.sub).width; }
    const padX = fs * 0.55;
    const w = Math.max(tw, sw) + padX * 2;
    const h = fs * 1.25 + (o.sub ? fs * 0.55 : 0) + fs * 0.25;
    return { w, h, fs };
  }
  function balloonR(o) { return o.shape === 'triangle' ? o.r * 1.45 : o.shape === 'diamond' ? o.r * 1.3 : o.r; }
  function balloonPath(ctx, o) {
    const { cx, cy, r } = o;
    ctx.beginPath();
    const poly = (n, R, start) => {
      for (let k = 0; k < n; k++) {
        const a = start + (k * TAU) / n;
        const x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
    };
    switch (o.shape) {
      case 'triangle': poly(3, r * 1.45, -Math.PI / 2); break;
      case 'square': ctx.rect(cx - r, cy - r, r * 2, r * 2); break;
      case 'diamond': poly(4, r * 1.3, -Math.PI / 2); break;
      case 'hexagon': poly(6, r * 1.1, 0); break;
      default: ctx.arc(cx, cy, r, 0, TAU);
    }
  }
  function dimGeom(o) {
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1;
    const L = Math.hypot(dx, dy) || 1e-9;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const off = o.offset || 0;
    const a = [o.x1 + nx * off, o.y1 + ny * off];
    const b = [o.x2 + nx * off, o.y2 + ny * off];
    return { L: Math.hypot(dx, dy), ux, uy, nx, ny, a, b, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
  }
  function formatLength(px, scale, precision = 2) {
    if (scale && scale.factor > 0) {
      const v = px * scale.factor;
      if (scale.unit === 'ft-in') {
        const totalIn = v;
        const ft = Math.floor(totalIn / 12);
        const inch = totalIn - ft * 12;
        return `${ft}'-${inch.toFixed(Math.max(0, precision - 1))}"`;
      }
      return `${v.toFixed(precision)} ${scale.unit}`;
    }
    return `${Math.round(px)} px`;
  }
  RL.formatLength = formatLength;
  function dimLabel(o, env) {
    if (o.text) return o.text;
    return formatLength(dimGeom(o).L, env && env.scale, o.precision ?? 2);
  }

  /* ---------------- rotation (text, stamp, image) ---------------- */
  const ROT = new Set(['text', 'stamp', 'image']);
  RL.ROTATABLE = ROT;
  function localBox(o) {
    if (o.type === 'text') { const m = textMetrics(o); return { x: o.x, y: o.y, w: m.w, h: m.h }; }
    if (o.type === 'stamp') { const m = stampMetrics(o); return { x: o.x, y: o.y, w: m.w, h: m.h }; }
    return box(o);
  }
  function rotPt(px, py, cx, cy, a) {
    const c = Math.cos(a), s = Math.sin(a), dx = px - cx, dy = py - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  }
  const rad = (o) => ((o.rotation || 0) * Math.PI) / 180;
  /** Unrotated box + center + angle for rotatable objects, else null. */
  RL.getFrame = function (o) {
    if (!ROT.has(o.type)) return null;
    const b = localBox(o);
    return { x: b.x, y: b.y, w: b.w, h: b.h, cx: b.x + b.w / 2, cy: b.y + b.h / 2, a: rad(o) };
  };
  RL.rotPt = rotPt;

  /* ---------------- drawing ---------------- */
  const drawers = {
    line(ctx, o) {
      applyStroke(ctx, o);
      const h = o.heads || 'none';
      leader(ctx, o, o.x1, o.y1, o.x2, o.y2,
        h === 'start' || h === 'both' ? 'arrow' : 'none',
        h === 'end' || h === 'both' ? 'arrow' : 'none');
    },
    rect(ctx, o) {
      const b = box(o);
      roundRectPath(ctx, b.x, b.y, b.w, b.h, o.radius);
      if (hasFill(o)) { ctx.fillStyle = o.fill; ctx.fill(); }
      if (o.width > 0) { applyStroke(ctx, o); ctx.stroke(); }
    },
    ellipse(ctx, o) {
      const b = box(o);
      ctx.beginPath();
      ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, TAU);
      if (hasFill(o)) { ctx.fillStyle = o.fill; ctx.fill(); }
      if (o.width > 0) { applyStroke(ctx, o); ctx.stroke(); }
    },
    cloud(ctx, o) {
      const b = box(o);
      const arc = Math.max(4, o.arc || 20);
      const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const [px, py] = pts[i], [qx, qy] = pts[(i + 1) % 4];
        const len = dist(px, py, qx, qy);
        const n = Math.max(1, Math.round(len / arc));
        const s = len / n;
        const th = Math.atan2(qy - py, qx - px);
        for (let k = 0; k < n; k++) {
          const mx = px + ((qx - px) * (k + 0.5)) / n, my = py + ((qy - py) * (k + 0.5)) / n;
          ctx.arc(mx, my, s / 2, th + Math.PI, th + TAU, false);
        }
      }
      ctx.closePath();
      if (hasFill(o)) { ctx.fillStyle = o.fill; ctx.fill(); }
      applyStroke(ctx, o, false);
      ctx.stroke();
    },
    pen(ctx, o) {
      const p = o.points;
      if (!p || !p.length) return;
      applyStroke(ctx, o, false);
      ctx.beginPath();
      ctx.moveTo(p[0][0], p[0][1]);
      if (p.length === 1) ctx.lineTo(p[0][0] + 0.01, p[0][1]);
      else if (p.length === 2) ctx.lineTo(p[1][0], p[1][1]);
      else {
        for (let i = 1; i < p.length - 1; i++) {
          const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
          ctx.quadraticCurveTo(p[i][0], p[i][1], mx, my);
        }
        const l = p[p.length - 1];
        ctx.lineTo(l[0], l[1]);
      }
      ctx.stroke();
    },
    highlight(ctx, o) {
      ctx.globalCompositeOperation = 'multiply';
      drawers.pen(ctx, Object.assign({}, o));
    },
    text(ctx, o, env) {
      const m = textMetrics(o);
      if (hasFill(o)) { ctx.fillStyle = o.fill; ctx.fillRect(o.x, o.y, m.w, m.h); }
      if (o.border) {
        ctx.strokeStyle = o.stroke; ctx.lineWidth = Math.max(1, o.fontSize / 14); ctx.setLineDash([]);
        ctx.strokeRect(o.x, o.y, m.w, m.h);
      }
      if (env && env.hideTextId === o.id) return;
      ctx.fillStyle = o.stroke;
      ctx.font = font(o);
      ctx.textBaseline = 'middle';
      m.lines.forEach((ln, i) => ctx.fillText(ln, o.x + m.pad, o.y + m.pad + i * m.lineH + m.lineH / 2));
    },
    callout(ctx, o, env) {
      const m = calloutMetrics(o);
      const b = m.b;
      const anc = calloutAnchor(b, o.tx, o.ty);
      applyStroke(ctx, o, false);
      if (anc) leader(ctx, o, anc[0], anc[1], o.tx, o.ty, 'none', o.tipEnd || 'arrow');
      roundRectPath(ctx, b.x, b.y, b.w, b.h, o.radius ?? Math.min(8, o.fontSize * 0.3));
      if (hasFill(o)) { ctx.fillStyle = o.fill; ctx.fill(); }
      applyStroke(ctx, o);
      ctx.stroke();
      if (env && env.hideTextId === o.id) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      ctx.fillStyle = o.stroke;
      ctx.font = font(o);
      ctx.textBaseline = 'middle';
      m.lines.forEach((ln, i) => ctx.fillText(ln, b.x + m.pad, b.y + m.pad + i * m.lineH + m.lineH / 2));
      ctx.restore();
    },
    balloon(ctx, o) {
      applyStroke(ctx, o, false);
      if (o.tx != null) {
        const R = balloonR(o);
        const d = dist(o.cx, o.cy, o.tx, o.ty);
        if (d > R) {
          const ax = o.cx + ((o.tx - o.cx) / d) * R, ay = o.cy + ((o.ty - o.cy) / d) * R;
          leader(ctx, o, ax, ay, o.tx, o.ty, 'none', o.tipEnd || 'arrow');
        }
      }
      balloonPath(ctx, o);
      if (hasFill(o)) { ctx.fillStyle = o.fill; ctx.fill(); }
      ctx.stroke();
      const label = String(o.label ?? '');
      const fs = o.r * (label.length > 2 ? 0.72 : label.length > 1 ? 0.95 : 1.1);
      ctx.fillStyle = o.stroke;
      ctx.font = font(o, fs, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const yOff = o.shape === 'triangle' ? o.r * 0.22 : 0;
      ctx.fillText(label, o.cx, o.cy + yOff + fs * 0.04);
      ctx.textAlign = 'start';
    },
    dimension(ctx, o, env) {
      const g = dimGeom(o);
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = o.width;
      ctx.setLineDash([]);
      ctx.lineCap = 'butt';
      const off = o.offset || 0;
      if (Math.abs(off) > 0.5) {
        const sg = Math.sign(off);
        const gap = Math.min(Math.abs(off) * 0.25, o.fontSize * 0.3);
        const ext = o.fontSize * 0.4;
        ctx.beginPath();
        for (const [px, py, qx, qy] of [[o.x1, o.y1, g.a[0], g.a[1]], [o.x2, o.y2, g.b[0], g.b[1]]]) {
          ctx.moveTo(px + g.nx * sg * gap, py + g.ny * sg * gap);
          ctx.lineTo(qx + g.nx * sg * ext, qy + g.ny * sg * ext);
        }
        ctx.stroke();
      }
      leader(ctx, o, g.a[0], g.a[1], g.b[0], g.b[1], 'arrow', 'arrow');
      if (env && env.hideTextId === o.id) return;
      const label = dimLabel(o, env);
      ctx.save();
      ctx.translate(g.mid[0], g.mid[1]);
      let ang = Math.atan2(g.uy, g.ux);
      if (ang > Math.PI / 2 || ang <= -Math.PI / 2) ang += Math.PI;
      ctx.rotate(ang);
      ctx.font = font(o, o.fontSize, true);
      const tw = ctx.measureText(label).width;
      const padX = o.fontSize * 0.25;
      ctx.fillStyle = hasFill(o) ? o.fill : 'rgba(255,255,255,0.88)';
      ctx.fillRect(-tw / 2 - padX, -o.fontSize * 0.62, tw + padX * 2, o.fontSize * 1.24);
      ctx.fillStyle = o.stroke;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, o.fontSize * 0.04);
      ctx.restore();
    },
    stamp(ctx, o) {
      const m = stampMetrics(o);
      const lw = Math.max(1, o.width);
      ctx.setLineDash([]);
      ctx.strokeStyle = o.stroke;
      ctx.lineWidth = lw;
      roundRectPath(ctx, o.x, o.y, m.w, m.h, m.fs * 0.18);
      if (hasFill(o)) { ctx.fillStyle = o.fill; ctx.fill(); }
      ctx.stroke();
      const ins = lw * 2.2;
      ctx.lineWidth = Math.max(0.75, lw * 0.45);
      roundRectPath(ctx, o.x + ins, o.y + ins, m.w - ins * 2, m.h - ins * 2, m.fs * 0.12);
      ctx.stroke();
      ctx.fillStyle = o.stroke;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = font(o, m.fs, true);
      const cx = o.x + m.w / 2;
      ctx.fillText(o.text || '', cx, o.y + m.fs * 0.14 + m.fs * 0.66);
      if (o.sub) {
        ctx.font = font(o, m.fs * 0.38, true);
        ctx.fillText(o.sub, cx, o.y + m.fs * 1.38 + m.fs * 0.12);
      }
      ctx.textAlign = 'start';
    },
    image(ctx, o, env) {
      const b = box(o);
      const im = env && env.images && env.images.get(o.src);
      if (o.shadow) {
        ctx.save();
        const blur = Math.max(6, Math.min(b.w, b.h) * 0.035);
        ctx.shadowColor = 'rgba(0,0,0,0.38)';
        ctx.shadowBlur = blur;
        ctx.shadowOffsetX = ctx.shadowOffsetY = blur * 0.35;
        ctx.fillStyle = '#fff';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.restore();
      }
      if (im && im.img) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(im.img, b.x, b.y, b.w, b.h);
      } else {
        ctx.fillStyle = '#eee'; ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = '#999'; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + b.w, b.y + b.h); ctx.moveTo(b.x + b.w, b.y); ctx.lineTo(b.x, b.y + b.h); ctx.stroke();
      }
      if (o.width > 0) {
        ctx.strokeStyle = o.stroke; ctx.lineWidth = o.width; ctx.setLineDash([]); ctx.lineJoin = 'miter';
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
    },
    blur(ctx, o, env) {
      const b = box(o);
      if (b.w < 1 || b.h < 1) return;
      if (o.mode === 'redact') {
        ctx.fillStyle = hasFill(o) ? o.fill : '#000';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        return;
      }
      const block = Math.max(3, o.block || 12);
      const sw = Math.max(1, Math.ceil(b.w / block)), sh = Math.max(1, Math.ceil(b.h / block));
      const c = RL._tmp || (RL._tmp = document.createElement('canvas'));
      c.width = sw; c.height = sh;
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.fillStyle = (env && env.bgColor) || '#fff';
      cx.fillRect(0, 0, sw, sh);
      const img = env && env.bgImage;
      if (img) {
        const ox = env.bgX || 0, oy = env.bgY || 0;
        const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
        // intersect region with image extent (in image coords)
        const sx0 = Math.max(0, b.x - ox), sy0 = Math.max(0, b.y - oy);
        const sx1 = Math.min(iw, b.x + b.w - ox), sy1 = Math.min(ih, b.y + b.h - oy);
        if (sx1 > sx0 && sy1 > sy0) {
          const kx = sw / b.w, ky = sh / b.h;
          cx.drawImage(img, sx0, sy0, sx1 - sx0, sy1 - sy0,
            (sx0 + ox - b.x) * kx, (sy0 + oy - b.y) * ky, (sx1 - sx0) * kx, (sy1 - sy0) * ky);
        }
      }
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(c, 0, 0, sw, sh, b.x, b.y, b.w, b.h);
      ctx.restore();
    },
  };

  RL.drawObject = function (ctx, o, env) {
    const fn = drawers[o.type];
    if (!fn) return;
    ctx.save();
    ctx.globalAlpha = o.opacity ?? 1;
    if (o.rotation && ROT.has(o.type)) {
      const f = RL.getFrame(o);
      ctx.translate(f.cx, f.cy);
      ctx.rotate(f.a);
      ctx.translate(-f.cx, -f.cy);
    }
    fn(ctx, o, env);
    ctx.restore();
  };

  /* ---------------- bounds ---------------- */
  function bbox(xs, ys) {
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  RL.getBounds = function (o) {
    if (o.rotation && ROT.has(o.type)) {
      const f = RL.getFrame(o);
      const pts = [[f.x, f.y], [f.x + f.w, f.y], [f.x + f.w, f.y + f.h], [f.x, f.y + f.h]].map(([x, y]) => rotPt(x, y, f.cx, f.cy, f.a));
      return bbox(pts.map((p) => p[0]), pts.map((p) => p[1]));
    }
    switch (o.type) {
      case 'image': return box(o);
      case 'line': return bbox([o.x1, o.x2], [o.y1, o.y2]);
      case 'dimension': {
        const g = dimGeom(o);
        return bbox([o.x1, o.x2, g.a[0], g.b[0]], [o.y1, o.y2, g.a[1], g.b[1]]);
      }
      case 'rect': case 'ellipse': case 'cloud': case 'blur': return box(o);
      case 'callout': { const b = box(o); return bbox([b.x, b.x + b.w, o.tx], [b.y, b.y + b.h, o.ty]); }
      case 'text': { const m = textMetrics(o); return { x: o.x, y: o.y, w: m.w, h: m.h }; }
      case 'stamp': { const m = stampMetrics(o); return { x: o.x, y: o.y, w: m.w, h: m.h }; }
      case 'balloon': {
        const R = balloonR(o);
        const xs = [o.cx - R, o.cx + R], ys = [o.cy - R, o.cy + R];
        if (o.tx != null) { xs.push(o.tx); ys.push(o.ty); }
        return bbox(xs, ys);
      }
      case 'pen': case 'highlight': {
        if (!o.points.length) return { x: 0, y: 0, w: 0, h: 0 };
        const b = bbox(o.points.map((p) => p[0]), o.points.map((p) => p[1]));
        const pad = o.width / 2;
        return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
      }
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  };

  /* ---------------- hit testing ---------------- */
  RL.hitTest = function (o, x, y, tol) {
    const w2 = (o.width || 0) / 2;
    if (ROT.has(o.type)) {
      const f = RL.getFrame(o);
      const [lx, ly] = f.a ? rotPt(x, y, f.cx, f.cy, -f.a) : [x, y];
      return inBox(lx, ly, f, tol + w2);
    }
    switch (o.type) {
      case 'line': return distToSeg(x, y, o.x1, o.y1, o.x2, o.y2) <= tol + w2;
      case 'dimension': {
        const g = dimGeom(o);
        if (distToSeg(x, y, g.a[0], g.a[1], g.b[0], g.b[1]) <= tol + o.fontSize * 0.6) return true;
        return distToSeg(x, y, o.x1, o.y1, g.a[0], g.a[1]) <= tol || distToSeg(x, y, o.x2, o.y2, g.b[0], g.b[1]) <= tol;
      }
      case 'rect': case 'cloud': {
        const b = box(o);
        const pad = tol + w2 + (o.type === 'cloud' ? (o.arc || 20) / 2 : 0);
        if (hasFill(o)) return inBox(x, y, b, pad);
        return inBox(x, y, b, pad) && !inBox(x, y, { x: b.x + pad, y: b.y + pad, w: b.w - pad * 2, h: b.h - pad * 2 });
      }
      case 'ellipse': {
        const b = box(o);
        const rx = b.w / 2, ry = b.h / 2;
        if (rx < 1 || ry < 1) return inBox(x, y, b, tol);
        const nx = (x - b.x - rx) / rx, ny = (y - b.y - ry) / ry;
        const r = Math.hypot(nx, ny);
        if (hasFill(o)) return r <= 1 + (tol + w2) / Math.min(rx, ry);
        return Math.abs(r - 1) * Math.min(rx, ry) <= tol + w2;
      }
      case 'blur': return inBox(x, y, box(o), tol);
      case 'callout': {
        const b = box(o);
        if (inBox(x, y, b, tol)) return true;
        const anc = calloutAnchor(b, o.tx, o.ty);
        return !!anc && distToSeg(x, y, anc[0], anc[1], o.tx, o.ty) <= tol + w2;
      }
      case 'text': case 'stamp': return inBox(x, y, RL.getBounds(o), tol);
      case 'balloon': {
        if (dist(x, y, o.cx, o.cy) <= balloonR(o) + tol) return true;
        return o.tx != null && distToSeg(x, y, o.cx, o.cy, o.tx, o.ty) <= tol + w2;
      }
      case 'pen': case 'highlight': {
        const p = o.points;
        if (p.length === 1) return dist(x, y, p[0][0], p[0][1]) <= tol + w2;
        for (let i = 1; i < p.length; i++) {
          if (distToSeg(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= tol + w2) return true;
        }
        return false;
      }
    }
    return false;
  };

  /* ---------------- move / handles ---------------- */
  RL.moveBy = function (o, dx, dy) {
    if ('x' in o) { o.x += dx; o.y += dy; }
    if ('x1' in o) { o.x1 += dx; o.y1 += dy; o.x2 += dx; o.y2 += dy; }
    if ('cx' in o) { o.cx += dx; o.cy += dy; }
    if (o.tx != null) { o.tx += dx; o.ty += dy; }
    if (o.points) o.points = o.points.map((p) => [p[0] + dx, p[1] + dy]);
  };

  function boxHandles(b) {
    const { x, y, w, h } = b;
    return [
      { id: 'nw', x, y }, { id: 'n', x: x + w / 2, y }, { id: 'ne', x: x + w, y },
      { id: 'e', x: x + w, y: y + h / 2 }, { id: 'se', x: x + w, y: y + h },
      { id: 's', x: x + w / 2, y: y + h }, { id: 'sw', x, y: y + h }, { id: 'w', x, y: y + h / 2 },
    ];
  }
  /** @param hs world units per screen pixel (1/zoom) so the rotate handle keeps a fixed screen offset */
  RL.getHandles = function (o, hs = 1) {
    if (ROT.has(o.type)) {
      const f = RL.getFrame(o);
      const local = o.type === 'image' ? boxHandles(f) : [{ id: 'fs', x: f.x + f.w, y: f.y + f.h }];
      local.push({ id: 'rot', x: f.cx, y: f.y - 26 * hs, kind: 'rot' });
      return local.map((h) => {
        const [x, y] = rotPt(h.x, h.y, f.cx, f.cy, f.a);
        return Object.assign({}, h, { x, y });
      });
    }
    switch (o.type) {
      case 'line': return [{ id: 'p1', x: o.x1, y: o.y1 }, { id: 'p2', x: o.x2, y: o.y2 }];
      case 'dimension': {
        const g = dimGeom(o);
        return [{ id: 'p1', x: o.x1, y: o.y1 }, { id: 'p2', x: o.x2, y: o.y2 }, { id: 'off', x: g.mid[0], y: g.mid[1], kind: 'round' }];
      }
      case 'rect': case 'ellipse': case 'cloud': case 'blur': return boxHandles(box(o));
      case 'callout': return [...boxHandles(box(o)), { id: 'tip', x: o.tx, y: o.ty, kind: 'round' }];
      case 'balloon': {
        const hs = [{ id: 'r', x: o.cx + balloonR(o), y: o.cy }];
        if (o.tx != null) hs.push({ id: 'tip', x: o.tx, y: o.ty, kind: 'round' });
        return hs;
      }
      case 'text': case 'stamp': {
        const b = RL.getBounds(o);
        return [{ id: 'fs', x: b.x + b.w, y: b.y + b.h }];
      }
    }
    return [];
  };
  RL.handleCursor = function (id) {
    return { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', fs: 'nwse-resize', r: 'ew-resize', rot: 'grab' }[id] || 'crosshair';
  };
  RL.applyHandle = function (o, orig, id, x, y, shift) {
    if (ROT.has(orig.type)) return applyRotatableHandle(o, orig, id, x, y, shift);
    switch (id) {
      case 'p1': { const p = shift ? snapAngle(orig.x2, orig.y2, x, y) : { x, y }; o.x1 = p.x; o.y1 = p.y; return; }
      case 'p2': { const p = shift ? snapAngle(orig.x1, orig.y1, x, y) : { x, y }; o.x2 = p.x; o.y2 = p.y; return; }
      case 'off': { const g = dimGeom(orig); o.offset = (x - orig.x1) * g.nx + (y - orig.y1) * g.ny; return; }
      case 'tip': o.tx = x; o.ty = y; return;
      case 'r': o.r = Math.max(5, (dist(x, y, o.cx, o.cy) * orig.r) / balloonR(orig)); return;
      case 'fs': {
        const b = RL.getBounds(orig);
        const ratio = Math.max(0.1, Math.max((x - b.x) / b.w, (y - b.y) / b.h));
        o.fontSize = Math.max(4, Math.min(600, Math.round(orig.fontSize * ratio * 2) / 2));
        return;
      }
    }
    const b = box(orig);
    let x1 = b.x, y1 = b.y, x2 = b.x + b.w, y2 = b.y + b.h;
    if (id.includes('w')) x1 = x;
    if (id.includes('e')) x2 = x;
    if (id.includes('n')) y1 = y;
    if (id.includes('s')) y2 = y;
    o.x = x1; o.y = y1; o.w = x2 - x1; o.h = y2 - y1;
  };

  function applyRotatableHandle(o, orig, id, x, y, shift) {
    const f = RL.getFrame(orig);
    if (id === 'rot') {
      let deg = (Math.atan2(y - f.cy, x - f.cx) * 180) / Math.PI + 90;
      if (shift) deg = Math.round(deg / 15) * 15;
      deg = ((deg % 360) + 540) % 360 - 180; // (-180, 180]
      o.rotation = Math.round(deg * 10) / 10;
      return;
    }
    const [lx, ly] = rotPt(x, y, f.cx, f.cy, -f.a);
    const placeKeepingCenter = (nb) => {
      // nb is the new box in the old local frame; map its center back to the world
      const [wx, wy] = rotPt(nb.x + nb.w / 2, nb.y + nb.h / 2, f.cx, f.cy, f.a);
      o.x = wx - nb.w / 2; o.y = wy - nb.h / 2;
      if ('w' in o) { o.w = nb.w; o.h = nb.h; }
    };
    if (id === 'fs') {
      const ratio = Math.max(0.1, Math.max((lx - f.x) / f.w, (ly - f.y) / f.h));
      o.fontSize = Math.max(4, Math.min(600, Math.round(orig.fontSize * ratio * 2) / 2));
      const nb = localBox(Object.assign({}, o, { x: f.x, y: f.y }));
      placeKeepingCenter({ x: f.x, y: f.y, w: nb.w, h: nb.h }); // top-left corner stays put
      return;
    }
    // image box handles; corners keep the aspect ratio unless Shift is held
    let x1 = f.x, y1 = f.y, x2 = f.x + f.w, y2 = f.y + f.h;
    const corner = id.length === 2;
    if (corner && !shift) {
      const ax = id.includes('w') ? x2 : x1, ay = id.includes('n') ? y2 : y1;
      const dx = lx - ax, dy = ly - ay;
      const sx = id.includes('w') ? -dx : dx, sy = id.includes('n') ? -dy : dy;
      const k = Math.max(4 / Math.min(f.w, f.h), Math.max(sx / f.w, sy / f.h));
      const w = f.w * k, h = f.h * k;
      x1 = id.includes('w') ? ax - w : ax; x2 = x1 + w;
      y1 = id.includes('n') ? ay - h : ay; y2 = y1 + h;
    } else {
      if (id.includes('w')) x1 = lx;
      if (id.includes('e')) x2 = lx;
      if (id.includes('n')) y1 = ly;
      if (id.includes('s')) y2 = ly;
    }
    const nb = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.max(2, Math.abs(x2 - x1)), h: Math.max(2, Math.abs(y2 - y1)) };
    placeKeepingCenter(nb);
  }

  /** Keep a callout's box tall enough for its text. */
  RL.fitCallout = function (o) {
    if (o.type !== 'callout') return;
    const m = calloutMetrics(normalize(o));
    if (o.h < m.needH) o.h = m.needH;
  };
  RL.textMetrics = textMetrics;
  RL.calloutMetrics = calloutMetrics;
  RL.dimLabel = dimLabel;
})();
