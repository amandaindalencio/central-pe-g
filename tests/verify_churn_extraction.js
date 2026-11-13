const fs = require('fs');
const { transformChurn } = require('../lib/transforms');

// CORREÇÃO 03/11: fonte trocada de cockpit_query_table pra cockpit_entradas_saidas_saidas_query
// (excludeChurnM0:false) — ver nota em lib/cockpit.js. Fixture antiga (shape de cockpit_query_table,
// com project_coordinator como campo plano) ficou obsoleta; usando o tool-result real da nova fonte.
// CORREÇÃO 13/11 (caso BUBLU): transformChurn passou a excluir linhas com statuses!=='churned' e
// !=='active' (ex. "finished" — projeto reclassificado, não é mais churn de verdade mesmo com
// churnDate/churnReason antigos ainda preenchidos). Números abaixo recomputados com esse filtro —
// 7 linhas "finished" desta mesma fixture passam a ser excluídas (qty 194→187, sum 1417992.41→1382341.60).
const TOOLRES = 'C:\\Users\\amand\\.claude\\projects\\c--Users-amand--claude\\43da95f9-467f-4fe1-9caa-25695fdcec05\\tool-results';
const d = JSON.parse(fs.readFileSync(
  TOOLRES + '\\mcp-cockpit-cockpit_entradas_saidas_saidas_query-1793706978431.txt', 'utf-8'
));

const byMonth = transformChurn(d);
const months = Object.keys(byMonth).sort();

let qty = 0, sum = 0;
months.forEach((m) => { byMonth[m].forEach((r) => { qty++; sum += r.valor || 0; }); });

console.log('months:', months);
console.log('qty:', qty, '(expected 187 — 202 linhas do fetch, 8 sem churnDate + 7 "finished" ficam de fora)');
console.log('sum:', sum.toFixed(2), '(expected 1382341.60)');
const sample = byMonth['2026-01'].find((r) => r.name.includes('LODEA'));
console.log('sample row (projectTeam -> coord via teamRole):', JSON.stringify(sample, null, 1));
const noFinished = months.every((m) => byMonth[m].every((r) => r.statuses === 'churned' || r.statuses === 'active'));
console.log('nenhuma linha "finished" (ou outro status) presente:', noFinished);

const ok = qty === 187 && Math.abs(sum - 1382341.60) < 0.01 && noFinished
  && sample && sample.squad === 'Billions' && sample.coord === 'Sem coordenador'; // LODEA só tem project_manager no projectTeam, sem coordenador mesmo

if (!ok) {
  console.log('MISMATCH — transformChurn output drifted from the known-good value (re-verificado ao vivo em 13/11)');
  process.exitCode = 1;
} else {
  console.log('OK — bate com o recomputado ao vivo em 13/11 (cockpit_entradas_saidas_saidas_query, excludeChurnM0:false, statuses churned/active apenas)');
}
