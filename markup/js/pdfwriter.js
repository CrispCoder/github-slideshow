/*
 * Minimal PDF 1.4 writer: one full-page JPEG image per page.
 * No dependencies, so exporting to PDF works fully offline.
 */
(function () {
  'use strict';
  const RL = (window.RL = window.RL || {});

  function latin1(s) {
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff;
    return b;
  }
  function pdfString(s) {
    // Keep ASCII only for the Info dictionary and escape delimiters.
    return '(' + String(s).replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1') + ')';
  }
  const num = (n) => (Math.round(n * 1000) / 1000).toString();

  /**
   * @param {Array<{jpeg:Uint8Array, pxW:number, pxH:number, wPt:number, hPt:number}>} pages
   * @param {{title?:string}} meta
   * @returns {Blob}
   */
  RL.buildPDF = function (pages, meta = {}) {
    const chunks = [];
    const offsets = [];
    let len = 0;
    const push = (x) => {
      const b = typeof x === 'string' ? latin1(x) : x;
      chunks.push(b);
      len += b.length;
    };
    const obj = (n, write) => {
      offsets[n] = len;
      push(`${n} 0 obj\n`);
      write();
      push('\nendobj\n');
    };

    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    const n = pages.length;
    const infoNum = 3 + n * 3;
    obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
    const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    obj(2, () => push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`));

    pages.forEach((p, i) => {
      const pn = 3 + i * 3, cn = pn + 1, im = pn + 2;
      obj(pn, () =>
        push(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.wPt)} ${num(p.hPt)}] ` +
            `/Resources << /XObject << /Im0 ${im} 0 R >> /ProcSet [/PDF /ImageC] >> /Contents ${cn} 0 R >>`
        )
      );
      const content = `q\n${num(p.wPt)} 0 0 ${num(p.hPt)} 0 0 cm\n/Im0 Do\nQ\n`;
      obj(cn, () => {
        push(`<< /Length ${content.length} >>\nstream\n`);
        push(content);
        push('\nendstream');
      });
      obj(im, () => {
        push(
          `<< /Type /XObject /Subtype /Image /Width ${p.pxW} /Height ${p.pxH} ` +
            `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`
        );
        push(p.jpeg);
        push('\nendstream');
      });
    });

    const d = new Date();
    const pad = (v) => String(v).padStart(2, '0');
    const date = `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    obj(infoNum, () =>
      push(`<< /Title ${pdfString(meta.title || 'Markup')} /Producer (Redline Markup Studio) /CreationDate (${date}) >>`)
    );

    const xref = len;
    const total = infoNum + 1;
    push(`xref\n0 ${total}\n0000000000 65535 f \n`);
    for (let i = 1; i < total; i++) push(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
    push(`trailer\n<< /Size ${total} /Root 1 0 R /Info ${infoNum} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return new Blob(chunks, { type: 'application/pdf' });
  };
})();
