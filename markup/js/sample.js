/*
 * Generates a synthetic engineering drawing (mounting bracket) so the app can
 * be tried without a file. Returns a PNG data URL.
 */
(function () {
  'use strict';
  const RL = (window.RL = window.RL || {});

  RL.makeSampleDrawing = function () {
    const W = 2400, H = 1600;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#111'; g.fillStyle = '#111';
    g.lineCap = 'butt'; g.lineJoin = 'miter';
    const F = (s, b) => `${b ? 'bold ' : ''}${s}px Arial, Helvetica, sans-serif`;

    // Border & zones
    g.lineWidth = 6; g.strokeRect(40, 40, W - 80, H - 80);
    g.lineWidth = 2; g.strokeRect(70, 70, W - 140, H - 140);
    g.font = F(22); g.textAlign = 'center'; g.textBaseline = 'middle';
    const cols = 8, rows = 4;
    for (let i = 0; i < cols; i++) {
      const x = 70 + ((W - 140) / cols) * (i + 0.5);
      g.fillText(String(cols - i), x, 55); g.fillText(String(cols - i), x, H - 55);
      if (i) { const xx = 70 + ((W - 140) / cols) * i; g.beginPath(); g.moveTo(xx, 40); g.lineTo(xx, 70); g.moveTo(xx, H - 70); g.lineTo(xx, H - 40); g.stroke(); }
    }
    for (let j = 0; j < rows; j++) {
      const y = 70 + ((H - 140) / rows) * (j + 0.5);
      const L = 'DCBA'[j];
      g.fillText(L, 55, y); g.fillText(L, W - 55, y);
      if (j) { const yy = 70 + ((H - 140) / rows) * j; g.beginPath(); g.moveTo(40, yy); g.lineTo(70, yy); g.moveTo(W - 70, yy); g.lineTo(W - 40, yy); g.stroke(); }
    }

    // Title block
    const tbx = W - 70 - 900, tby = H - 70 - 260;
    g.lineWidth = 3; g.strokeRect(tbx, tby, 900, 260);
    g.lineWidth = 1.5;
    [[tbx, tby + 90, tbx + 900, tby + 90], [tbx, tby + 170, tbx + 900, tby + 170], [tbx + 560, tby + 90, tbx + 560, tby + 260], [tbx + 730, tby + 170, tbx + 730, tby + 260]]
      .forEach(([a, b, cc, d]) => { g.beginPath(); g.moveTo(a, b); g.lineTo(cc, d); g.stroke(); });
    g.textAlign = 'left';
    g.font = F(16); g.fillText('TITLE', tbx + 12, tby + 18);
    g.font = F(40, true); g.fillText('MOUNTING BRACKET', tbx + 20, tby + 58);
    g.font = F(16);
    g.fillText('DWG NO.', tbx + 12, tby + 106); g.fillText('MATERIAL', tbx + 572, tby + 106);
    g.fillText('SCALE', tbx + 12, tby + 186); g.fillText('SHEET', tbx + 572, tby + 186); g.fillText('REV', tbx + 742, tby + 186);
    g.font = F(30, true);
    g.fillText('BRK-1042-A', tbx + 20, tby + 140); g.fillText('6061-T6 AL', tbx + 572, tby + 140);
    g.fillText('1 : 1', tbx + 20, tby + 222); g.fillText('1 OF 1', tbx + 572, tby + 222); g.fillText('B', tbx + 790, tby + 222);
    g.font = F(18); g.fillText('UNLESS OTHERWISE SPECIFIED: DIMENSIONS IN MM, TOL ±0.2', 90, H - 92);

    // Helpers
    const line = (x1, y1, x2, y2, w = 3, dash) => { g.lineWidth = w; g.setLineDash(dash || []); g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); g.setLineDash([]); };
    const center = (x1, y1, x2, y2) => line(x1, y1, x2, y2, 1.5, [30, 8, 6, 8]);
    const arrow = (x, y, ang) => { const s = 18; g.beginPath(); g.moveTo(x, y); g.lineTo(x - s * Math.cos(ang - 0.3), y - s * Math.sin(ang - 0.3)); g.lineTo(x - s * Math.cos(ang + 0.3), y - s * Math.sin(ang + 0.3)); g.closePath(); g.fill(); };
    const hdim = (x1, x2, y, yRef, label) => {
      line(x1, yRef, x1, y + 12, 1.2); line(x2, yRef, x2, y + 12, 1.2); line(x1, y, x2, y, 1.2);
      arrow(x1, y, Math.PI); arrow(x2, y, 0);
      g.font = F(24); g.textAlign = 'center'; g.fillStyle = '#fff';
      const tw = g.measureText(label).width; g.fillRect((x1 + x2) / 2 - tw / 2 - 6, y - 32, tw + 12, 26);
      g.fillStyle = '#111'; g.fillText(label, (x1 + x2) / 2, y - 19);
    };
    const vdim = (y1, y2, x, xRef, label) => {
      line(xRef, y1, x - 12, y1, 1.2); line(xRef, y2, x - 12, y2, 1.2); line(x, y1, x, y2, 1.2);
      arrow(x, y1, -Math.PI / 2); arrow(x, y2, Math.PI / 2);
      g.save(); g.translate(x - 18, (y1 + y2) / 2); g.rotate(-Math.PI / 2); g.font = F(24); g.textAlign = 'center'; g.fillText(label, 0, 0); g.restore();
    };

    // FRONT VIEW: plate 640x400 at (300,360) — 1 mm = 4 px
    const px = 300, py = 380, pw = 640, ph = 400;
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(px, py); g.lineTo(px + pw - 80, py); g.lineTo(px + pw, py + 80); g.lineTo(px + pw, py + ph); g.lineTo(px, py + ph); g.closePath(); g.stroke();
    const holes = [[px + 100, py + 100], [px + pw - 120, py + 300], [px + 100, py + 300]];
    holes.forEach(([x, y]) => { g.lineWidth = 3; g.beginPath(); g.arc(x, y, 34, 0, Math.PI * 2); g.stroke(); center(x - 60, y, x + 60, y); center(x, y - 60, x, y + 60); });
    // slot
    g.lineWidth = 3; g.beginPath(); g.arc(px + 300, py + 200, 26, Math.PI / 2, Math.PI * 1.5); g.lineTo(px + 420, py + 174); g.arc(px + 420, py + 200, 26, -Math.PI / 2, Math.PI / 2); g.closePath(); g.stroke();
    center(px + 250, py + 200, px + 470, py + 200);
    hdim(px, px + pw, py - 90, py - 10, '160.0');
    hdim(px, px + 100, py + ph + 80, py + ph + 10, '25.0');
    vdim(py, py + ph, px - 90, px - 10, '100.0');
    vdim(py, py + 100, px + pw + 90, px + pw + 10, '25.0');
    g.font = F(22); g.textAlign = 'left'; g.fillText('3X Ø17.0 THRU', px + 140, py + 52);
    g.font = F(26, true); g.textAlign = 'center'; g.fillText('FRONT VIEW', px + pw / 2, py + ph + 160);

    // SIDE VIEW
    const sx = 1180, sw = 48;
    g.lineWidth = 4; g.strokeRect(sx, py, sw, ph);
    line(sx, py + 100 - 34, sx + sw, py + 100 - 34, 2, [14, 8]); line(sx, py + 100 + 34, sx + sw, py + 100 + 34, 2, [14, 8]);
    line(sx, py + 300 - 34, sx + sw, py + 300 - 34, 2, [14, 8]); line(sx, py + 300 + 34, sx + sw, py + 300 + 34, 2, [14, 8]);
    hdim(sx, sx + sw, py - 90, py - 10, '12.0');
    g.font = F(26, true); g.textAlign = 'center'; g.fillText('RIGHT SIDE', sx + sw / 2, py + ph + 160);

    // ISO-ish view
    g.save(); g.translate(1640, 520); g.lineWidth = 3;
    const iso = (x, y, z) => [x * 0.87 - y * 0.87, x * 0.5 + y * 0.5 - z];
    const P = (x, y, z) => { const p = iso(x, y, z); return p; };
    const poly = (pts) => { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(...P(...p)) : g.moveTo(...P(...p)))); g.closePath(); g.stroke(); };
    poly([[0, 0, 0], [320, 0, 0], [320, 0, 200], [0, 0, 200]]);
    poly([[0, 0, 200], [320, 0, 200], [320, 24, 200], [0, 24, 200]]);
    poly([[320, 0, 0], [320, 24, 0], [320, 24, 200], [320, 0, 200]]);
    g.restore();
    g.font = F(26, true); g.fillText('ISOMETRIC', 1760, 780);

    // Notes
    g.textAlign = 'left'; g.font = F(24, true); g.fillText('NOTES:', 1560, 950);
    g.font = F(22);
    ['1. BREAK ALL SHARP EDGES 0.5 MAX.', '2. DEBURR ALL HOLES.', '3. ANODIZE CLEAR PER MIL-A-8625 TYPE II.', '4. PART MARK WITH DWG NO. AND REV.']
      .forEach((t, i) => g.fillText(t, 1560, 990 + i * 34));

    return c.toDataURL('image/png');
  };
})();
