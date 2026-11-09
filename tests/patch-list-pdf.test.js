'use strict';

const assert = require('node:assert/strict');
const { createPatchListPdf } = require('../public/patch-list-pdf');

const pdf = createPatchListPdf([
  { title: 'External inputs', headers: ['INPUT ID', 'SOURCE NAME', 'CONNECTION'], rows: [['1', 'Cámara • One', 'SDI']] },
  { title: 'M/E 1 keyer patches', headers: ['KEYER', 'FILL', 'KEY'], rows: Array.from({ length: 60 }, (_, index) => [`USK ${index + 1}`, `Fill source ${index + 1}`, `Key source ${index + 1}`]) }
], 'ATEM Production Studio · Prepared today');

assert.ok(pdf.startsWith('%PDF-1.4\n'), 'patch list export must be a PDF file');
assert.match(pdf, /\/BaseFont \/Helvetica-Bold/);
assert.match(pdf, /Camara/, 'common accented names should be normalized for standard PDF fonts');
assert.ok((pdf.match(/\/Type \/Page \/Parent/g) || []).length > 1, 'long patch lists should paginate');
assert.match(pdf, /\/Type \/Pages \/Kids \[5 0 R 7 0 R/,
  'the page tree must point to page objects, not the font objects');

const xrefPosition = pdf.indexOf('xref\n0 ');
const startXref = Number(pdf.match(/startxref\n(\d+)\n%%EOF/)[1]);
assert.equal(startXref, xrefPosition, 'cross-reference offset must point to the xref table');
const xrefLines = pdf.slice(xrefPosition).split('\n');
const objectCount = Number(xrefLines[1].split(' ')[1]);
for (let id = 1; id < objectCount; id++) {
  const offset = Number(xrefLines[id + 2].slice(0, 10));
  assert.ok(pdf.startsWith(`${id} 0 obj`, offset), `xref entry ${id} must point to its object`);
}

console.log('Patch list PDF generation regressions passed');
