(function (root) {
  'use strict';

  const PAGE_W = 792;
  const PAGE_H = 612;
  const LEFT = 38;
  const RIGHT = PAGE_W - 38;
  const TABLE_W = RIGHT - LEFT;

  function pdfText(value) {
    const substitutions = { '–': '-', '—': '-', '−': '-', '•': '-', '·': '-', '→': '->', '←': '<-', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...' };
    return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[–—−•·→←“”‘’…]/g, ch => substitutions[ch] || '?').replace(/[^\x20-\x7e]/g, '?');
  }

  function literal(value) {
    return pdfText(value).replace(/[\\()]/g, '\\$&');
  }

  function wrap(value, maxChars) {
    const text = pdfText(value).trim();
    if (!text) return ['-'];
    const result = [];
    for (const sourceWord of text.split(/\s+/)) {
      let word = sourceWord;
      while (word.length > maxChars) {
        result.push(word.slice(0, maxChars));
        word = word.slice(maxChars);
      }
      if (!result.length || (result[result.length - 1] + ' ' + word).trim().length > maxChars) result.push(word);
      else result[result.length - 1] += ' ' + word;
    }
    return result;
  }

  function createPatchListPdf(sections, metadata = '') {
    const pages = [];
    let commands;
    let y;
    const color = (r, g, b) => `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
    const text = (value, x, top, size = 8, shade = [0.10, 0.16, 0.20], bold = false) => {
      const font = bold ? 'F2' : 'F1';
      commands.push(`${color(...shade)} rg BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(PAGE_H - top - size).toFixed(2)} Tm (${literal(value)}) Tj ET`);
    };
    const rect = (x, top, width, height, fill, stroke = null) => {
      const base = `${color(...fill)} rg ${x.toFixed(2)} ${(PAGE_H - top - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re`;
      commands.push(stroke ? `${base} S` : `${base} f`);
    };
    const line = (x1, top1, x2, top2, shade = [0.75, 0.79, 0.81], width = 0.5) => {
      commands.push(`${color(...shade)} RG ${width} w ${x1.toFixed(2)} ${(PAGE_H - top1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H - top2).toFixed(2)} l S`);
    };
    const addPage = () => {
      commands = [];
      pages.push(commands);
      y = 36;
      text('SHOWDESK  /  ATEM PATCH LIST', LEFT, y, 13, [0.08, 0.17, 0.22], true);
      y += 22;
      text(metadata, LEFT, y, 8, [0.32, 0.39, 0.42]);
      y += 12;
      line(LEFT, y, RIGHT, y, [0.22, 0.34, 0.39], 1.2);
      y += 18;
    };
    const columnWidths = (headers, rows) => {
      const weights = headers.map((header, index) => {
        const longest = Math.max(String(header || '').length, ...rows.map(row => String(row[index] || '').length), 8);
        return Math.min(36, Math.max(9, longest));
      });
      const total = weights.reduce((sum, value) => sum + value, 0);
      return weights.map(value => TABLE_W * value / total);
    };
    const drawTableHeader = (headers, widths) => {
      const h = 22;
      rect(LEFT, y, TABLE_W, h, [0.12, 0.21, 0.26]);
      let x = LEFT;
      headers.forEach((header, index) => {
        text(header, x + 7, y + 6, 7, [0.94, 0.97, 0.98], true);
        x += widths[index];
      });
      y += h;
    };

    addPage();
    (sections || []).forEach(section => {
      const title = pdfText(section.title || 'PATCHES');
      const headers = (section.headers || []).map(pdfText);
      const rows = section.rows?.length ? section.rows.map(row => row.map(pdfText)) : [['No entries reported.']];
      const widths = columnWidths(headers.length ? headers : ['DETAIL'], rows);
      const tableHeaders = headers.length ? headers : ['DETAIL'];
      if (y + 46 > PAGE_H - 34) addPage();
      text(title.toUpperCase(), LEFT, y, 9, [0.10, 0.18, 0.22], true);
      y += 15;
      drawTableHeader(tableHeaders, widths);
      rows.forEach((row, rowIndex) => {
        const cells = tableHeaders.map((_, index) => row[index] || '');
        const wrapped = cells.map((cell, index) => wrap(cell, Math.max(8, Math.floor((widths[index] - 14) / 4.2))));
        const rowHeight = Math.max(20, Math.max(...wrapped.map(lines => lines.length)) * 10 + 8);
        if (y + rowHeight > PAGE_H - 34) {
          addPage();
          text(`${title.toUpperCase()} (CONTINUED)`, LEFT, y, 8, [0.27, 0.37, 0.41], true);
          y += 14;
          drawTableHeader(tableHeaders, widths);
        }
        if (rowIndex % 2 === 1) rect(LEFT, y, TABLE_W, rowHeight, [0.95, 0.97, 0.97]);
        let x = LEFT;
        wrapped.forEach((lines, col) => {
          lines.forEach((entry, index) => text(entry, x + 7, y + 5 + index * 10, 8, [0.10, 0.15, 0.18]));
          x += widths[col];
        });
        line(LEFT, y + rowHeight, RIGHT, y + rowHeight, [0.83, 0.86, 0.87], 0.35);
        y += rowHeight;
      });
      y += 17;
    });

    pages.forEach((page, index) => {
      line(LEFT, PAGE_H - 25, RIGHT, PAGE_H - 25, [0.78, 0.82, 0.83], 0.4);
      text(`Prepared ${new Date().toLocaleString()}     Page ${index + 1} of ${pages.length}`, LEFT, PAGE_H - 19, 7, [0.38, 0.45, 0.48]);
    });

    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`;
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    pages.forEach((page, index) => {
      const pageId = 5 + index * 2;
      const streamId = pageId + 1;
      const stream = page.join('\n');
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamId} 0 R >>`;
      objects[streamId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    });
    let output = '%PDF-1.4\n%ShowDesk\n';
    const offsets = [0];
    for (let id = 1; id < objects.length; id++) {
      offsets[id] = output.length;
      output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
    }
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < objects.length; id++) output += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return output;
  }

  root.ShowDeskPatchPdf = { createPatchListPdf };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createPatchListPdf };
})(typeof window === 'undefined' ? globalThis : window);
