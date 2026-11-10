(function (root) {
  'use strict';

  const PAGE_W = 792;
  const PAGE_H = 612;
  const LEFT = 28;
  const RIGHT = PAGE_W - 28;
  const GAP = 24;
  const COLUMN_W = (RIGHT - LEFT - GAP) / 2;
  const BOTTOM = PAGE_H - 39;
  const substitutions = { '–': '-', '—': '-', '−': '-', '•': '-', '·': '-', '→': '->', '←': '<-', '“': '"', '”': '"', '‘': "'", '’': "'", '…': '...' };

  function pdfText(value) {
    return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[–—−•·→←“”‘’…]/g, ch => substitutions[ch] || '?').replace(/[^\x20-\x7e]/g, '?');
  }

  function literal(value) {
    return pdfText(value).replace(/[\\()]/g, '\\$&');
  }

  function wrap(value, maxChars) {
    const result = [];
    for (const sourceWord of (pdfText(value).trim() || '-').split(/\s+/)) {
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
    const groups = new Map();
    (sections || []).forEach(section => {
      const group = Number(section.pageGroup) || 1;
      const column = section.column === 'right' ? 'right' : 'left';
      if (!groups.has(group)) groups.set(group, { left: [], right: [] });
      groups.get(group)[column].push(section);
    });
    if (!groups.size) groups.set(1, { left: [], right: [] });

    const pages = [];
    const color = (r, g, b) => `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
    const makeColumnPages = (items, pageGroup) => {
      const result = [];
      let commands = [];
      let y = 67;
      const text = (value, x, top, size = 7.4, shade = [0.08, 0.13, 0.17], bold = false) => {
        const font = bold ? 'F2' : 'F1';
        commands.push(`${color(...shade)} rg BT /${font} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(PAGE_H - top - size).toFixed(2)} Tm (${literal(value)}) Tj ET`);
      };
      const rect = (x, top, width, height, fill) => {
        commands.push(`${color(...fill)} rg ${x.toFixed(2)} ${(PAGE_H - top - height).toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
      };
      const line = (x1, top1, x2, top2, shade = [0.75, 0.79, 0.81], width = 0.45) => {
        commands.push(`${color(...shade)} RG ${width} w ${x1.toFixed(2)} ${(PAGE_H - top1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H - top2).toFixed(2)} l S`);
      };
      const pageBreak = () => {
        result.push(commands);
        commands = [];
        y = 67;
      };
      const drawSection = (section, continuation = false) => {
        const title = pdfText(section.title || 'PATCHES').toUpperCase();
        const note = pdfText(section.note || '');
        const headers = (section.headers || []).map(pdfText);
        const tableHeaders = headers.length ? headers : ['DETAIL'];
        const rows = section.rows?.length ? section.rows.map(row => row.map(pdfText)) : [['No entries reported.']];
        const widthsByText = tableHeaders.map((header, index) => {
          const longest = Math.max(header.length, ...rows.map(row => String(row[index] || '').length));
          return Math.min(40, Math.max(8, longest));
        });
        const totalWeight = widthsByText.reduce((sum, weight) => sum + weight, 0) || 1;
        const widths = widthsByText.map(weight => COLUMN_W * weight / totalWeight);
        const titleLabel = continuation ? `${title} (CONTINUED)` : title;
        const noteLines = note ? wrap(note, 94) : [];
        const headingHeight = 12 + noteLines.length * 8 + 7;
        const hasAnyRow = rows.some(row => row.some(cell => pdfText(cell).trim()));
        if (y + headingHeight + 14 > BOTTOM) pageBreak();
        text(titleLabel, LEFT, y, 9, [0.08, 0.16, 0.21], false);
        y += 14;
        noteLines.forEach((lineText, index) => text(lineText, LEFT, y + index * 8, 6.7, [0.28, 0.35, 0.39]));
        y += noteLines.length * 8 + 4;
        const drawHeader = () => {
          rect(LEFT, y, COLUMN_W, 16, [0.86, 0.89, 0.91]);
          let x = LEFT;
          tableHeaders.forEach((header, index) => {
            text(header, x + 5, y + 4.2, 7.1, [0.10, 0.14, 0.17], false);
            x += widths[index];
          });
          y += 16;
        };
        drawHeader();
        rows.forEach((row, rowIndex) => {
          const cells = tableHeaders.map((_, index) => row[index] || '');
          const wrapped = cells.map((cell, index) => wrap(cell, Math.max(7, Math.floor((widths[index] - 10) / 3.65))));
          const height = Math.max(11.1, Math.max(...wrapped.map(lines => lines.length)) * 8 + 2.6);
          if (y + height > BOTTOM) {
            pageBreak();
            text(`${title} (CONTINUED)`, LEFT, y, 7.8, [0.28, 0.35, 0.39], true);
            y += 12;
            drawHeader();
          }
          if (rowIndex % 2 === 1) rect(LEFT, y, COLUMN_W, height, [0.94, 0.955, 0.96]);
          let x = LEFT;
          wrapped.forEach((cellLines, columnIndex) => {
            cellLines.forEach((entry, lineIndex) => text(entry, x + 5, y + 1.6 + lineIndex * 8, 7.2, [0.08, 0.12, 0.15]));
            x += widths[columnIndex];
          });
          line(LEFT, y + height, LEFT + COLUMN_W, y + height, [0.79, 0.83, 0.85], 0.3);
          y += height;
        });
        if (!hasAnyRow) text('Names and assignments are retained exactly as listed.', LEFT, y + 2, 6.6, [0.30, 0.37, 0.41]);
        y += 17;
      };

      if (!items.length) drawSection({ title: 'PATCHES', headers: ['DETAIL'], rows: [['No patch data reported.']] });
      items.forEach(section => drawSection(section));
      if (!commands.length) commands.push('');
      result.push(commands);
      return result;
    };

    [...groups.entries()].sort((a, b) => a[0] - b[0]).forEach(([groupNumber, columns]) => {
      const leftPages = makeColumnPages(columns.left, groupNumber);
      const rightPages = makeColumnPages(columns.right, groupNumber);
      const pageCount = Math.max(leftPages.length, rightPages.length);
      for (let index = 0; index < pageCount; index++) {
        const commands = [];
        const text = (value, x, top, size = 8, shade = [0.10, 0.16, 0.20], bold = false) => {
          commands.push(`${color(...shade)} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${(PAGE_H - top - size).toFixed(2)} Tm (${literal(value)}) Tj ET`);
        };
        const line = (x1, top1, x2, top2, shade = [0.66, 0.71, 0.74], width = 0.6) => {
          commands.push(`${color(...shade)} RG ${width} w ${x1.toFixed(2)} ${(PAGE_H - top1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE_H - top2).toFixed(2)} l S`);
        };
        text('SHOWDESK | ATEM PATCH LIST', LEFT, 17, 15, [0.08, 0.16, 0.21], false);
        const category = groupNumber === 1 ? 'Input and internal source directory' : 'Outputs, AUX patches and keyer assignments';
        text(`${metadata} | ${category}`, LEFT, 39, 7.7, [0.20, 0.28, 0.32]);
        line(LEFT, 57, RIGHT, 57, [0.22, 0.34, 0.39], 1.1);
        commands.push(...(leftPages[index] || []));
        const rightCommands = rightPages[index] || [];
        if (rightCommands.length) {
          // Column content uses the same local x origin; shift its operators into the right column.
          commands.push(...rightCommands.map(operator => operator.replace(/(-?\d+(?:\.\d+)?) (\d+(?:\.\d+)?) m /g, (match, x, y) => `${(Number(x) + COLUMN_W + GAP).toFixed(2)} ${y} m `)
            .replace(/(-?\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) re/g, (match, x, y, w, h) => `${(Number(x) + COLUMN_W + GAP).toFixed(2)} ${y} ${w} ${h} re`)
            .replace(/1 0 0 1 (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?) Tm/g, (match, x, y) => `1 0 0 1 ${(Number(x) + COLUMN_W + GAP).toFixed(2)} ${y} Tm`)
            .replace(/(-?\d+(?:\.\d+)?) (\d+(?:\.\d+)?) l S/g, (match, x, y) => `${(Number(x) + COLUMN_W + GAP).toFixed(2)} ${y} l S`)));
        }
        line(LEFT, PAGE_H - 27, RIGHT, PAGE_H - 27, [0.66, 0.71, 0.74], 0.55);
        text('Source: ShowDesk ATEM Patch List | Names and assignments preserved', LEFT, PAGE_H - 21, 6.7, [0.22, 0.30, 0.34]);
        text(`${pages.length + 1} / TOTAL`, RIGHT - 45, PAGE_H - 21, 6.7, [0.10, 0.16, 0.20]);
        pages.push(commands);
      }
    });
    // Replace the temporary footer marker after the final page count is known.
    const total = pages.length;
    pages.forEach((page, index) => {
      const marker = `(${literal(`${index + 1} / TOTAL`)}) Tj`;
      const actual = `(${literal(`${index + 1} / ${total}`)}) Tj`;
      const position = page.findIndex(command => command.includes(marker));
      if (position >= 0) page[position] = page[position].replace(marker, actual);
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
