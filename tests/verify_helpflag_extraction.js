const fs = require('fs');
const { transformHelpFlag } = require('../lib/transforms');

const monthlyRows = JSON.parse(fs.readFileSync(
  'C:\\Users\\amand\\AppData\\Local\\Temp\\claude\\c--Users-amand--claude\\43da95f9-467f-4fe1-9caa-25695fdcec05\\scratchpad\\hf_rebuild_raw.json',
  'utf-8'
));

// Two real weekly-trend weeks fetched live on 05/10 (see conversation) —
// just enough to sanity-check buildHelpFlagWeeklyTrend end-to-end, including
// the multi-coordinator-as-array edge case confirmed live that week.
const TR = 'C:\\Users\\amand\\.claude\\projects\\c--Users-amand--claude\\43da95f9-467f-4fe1-9caa-25695fdcec05\\tool-results\\';
const w0926 = JSON.parse(fs.readFileSync(TR + 'mcp-cockpit-cockpit_query_history-1791201487123.txt', 'utf-8')).data;
const w1003 = JSON.parse(fs.readFileSync(TR + 'mcp-cockpit-cockpit_query_history-1791201402087.txt', 'utf-8')).data;

const { byMonth, weeklyTrend } = transformHelpFlag({
  monthlyRows,
  weeklyRows: [w0926, w1003],
  weekEndDates: ['2026-09-26', '2026-10-03'],
});

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

console.log('weeklyTrend.weeks:', weeklyTrend.weeks);
const gd = weeklyTrend.byCoord['Guilhermeduarte.coord'];
console.log('Guilhermeduarte.coord weekly:', JSON.stringify(gd));
// 38.7% on 26/09 is the exact value already shown (and confirmed correct) in
// the dashboard screenshot before this fix — must still match post-refactor.
if (!gd || gd[0].pct !== 38.7) ok = false;
if (Object.keys(weeklyTrend.byCoord).length !== 12) ok = false;

if (!ok) {
  console.log('MISMATCH');
  process.exitCode = 1;
} else {
  console.log('OK — monthly roster unchanged (373/month), weekly trend matches the known-good 38.7% for 26/09, no crash on the multi-coordinator-array edge case');
}
