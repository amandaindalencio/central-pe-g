const fs = require('fs');
const { transformChurn } = require('../lib/transforms');

const TOOLRES = 'C:\\Users\\amand\\.claude\\projects\\c--Users-amand--claude\\43da95f9-467f-4fe1-9caa-25695fdcec05\\tool-results';
const d = JSON.parse(fs.readFileSync(
  TOOLRES + '\\mcp-cockpit-cockpit_query_table-1790856370812.txt', 'utf-8'
));

const byMonth = transformChurn(d);
const months = Object.keys(byMonth).filter((m) => m >= '2026-01' && m <= '2026-10').sort();

let qty = 0, sum = 0;
months.forEach((m) => { byMonth[m].forEach((r) => { qty++; sum += r.valor || 0; }); });

console.log('months in 2026 window:', months);
console.log('qty:', qty, '(expected 167)');
console.log('sum:', sum.toFixed(2), '(expected 1265986.56)');
console.log('sample row:', JSON.stringify(byMonth['2026-01'][0], null, 1));

if (qty !== 167 || Math.abs(sum - 1265986.56) > 0.01) {
  console.log('MISMATCH — transformChurn output drifted from the known-good value');
  process.exitCode = 1;
} else {
  console.log('OK — matches the value already validated and published on the dashboard');
}
