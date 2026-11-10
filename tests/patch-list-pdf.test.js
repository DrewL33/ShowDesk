'use strict';

const assert = require('node:assert/strict');
const { createPatchListPdf } = require('../public/patch-list-pdf');

const referenceSections = [
  { pageGroup: 1, column: 'left', title: 'EXTERNAL INPUTS', note: 'All inputs: SDI | M/E access: 1, 2, 3, 4', headers: ['INPUT ID', 'SOURCE NAME'], rows: [['1', 'Cámara • One']] },
  { pageGroup: 1, column: 'right', title: 'INTERNAL / DIRECT SOURCES', headers: ['SOURCE ID', 'SOURCE NAME', 'M/E ACCESS'], rows: [['0', 'Black', '1-4']] },
  { pageGroup: 2, column: 'left', title: 'SWITCHER OUTPUTS + AUX SOURCE PATCHES', headers: ['OUTPUT ID', 'DESTINATION', 'AUX SOURCE PATCH'], rows: [['7001', 'Clean Feed 1', '—']] },
  { pageGroup: 2, column: 'right', title: 'M/E KEYER PATCHES', headers: ['M/E', 'TYPE', 'FILL SOURCE', 'KEY SOURCE'], rows: [['M/E 1 · USK 1', 'Luma', 'Cámara • One', 'Black']] }
];
const pdf = createPatchListPdf(referenceSections, 'ATEM Production Studio · Prepared today');
const longPdf = createPatchListPdf([
  { pageGroup: 1, column: 'left', title: 'EXTERNAL INPUTS', headers: ['INPUT ID', 'SOURCE NAME'], rows: Array.from({ length: 60 }, (_, index) => [`${index + 1}`, `Fill source ${index + 1}`]) },
  ...referenceSections.slice(1)
], 'ATEM Production Studio · Prepared today');

assert.ok(pdf.startsWith('%PDF-1.4\n'), 'patch list export must be a PDF file');
assert.match(pdf, /\/BaseFont \/Helvetica-Bold/);
assert.match(pdf, /Camara/, 'common accented names should be normalized for standard PDF fonts');
assert.equal((pdf.match(/\/Type \/Page \/Parent/g) || []).length, 2,
  'a standard patch list should follow the two-page reference layout');
assert.match(pdf, /1 \/ 2/);
assert.match(pdf, /2 \/ 2/);
assert.match(pdf, /1 0 0 1 408\.00/,
  'the second half of each reference page must be a distinct right column');
assert.match(pdf, /M\/E KEYER PATCHES/);
assert.ok((longPdf.match(/\/Type \/Page \/Parent/g) || []).length > 2,
  'larger patch lists should add pages as needed');
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
