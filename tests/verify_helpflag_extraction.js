const fs = require('fs');
const { transformHelpFlag } = require('../lib/transforms');

const rows = JSON.parse(fs.readFileSync(
  'C:\\Users\\amand\\AppData\\Local\\Temp\\claude\\c--Users-amand--claude\\43da95f9-467f-4fe1-9caa-25695fdcec05\\scratchpad\\hf_rebuild_raw.json',
  'utf-8'
));

const byMonth = transformHelpFlag(rows);
const months = Object.keys(byMonth).sort();
console.log('months:', months, '(expected 9, Jan-Set)');

let ok = months.length === 9;
months.forEach((m) => {
  const count = byMonth[m].length;
  if (count !== 373) ok = false;
  console.log(m, 'count:', count, '(expected 373)');
});

const sample = byMonth['2026-09'].find((r) => r.name === 'Positive Safety Sistemas');
console.log('sample row (Set/2026):', JSON.stringify(sample));
if (!sample || sample.squad !== 'Exclusive' || sample.coord !== 'rafaela.tolomeu') ok = false;

if (!ok) {
  console.log('MISMATCH');
  process.exitCode = 1;
} else {
  console.log('OK — 373 active clients every month (constant roster), fields match raw source');
}
