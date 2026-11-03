const fs = require('fs');
const { transformPrevisao } = require('../lib/transforms');

// CORREÇÃO 03/11: transformPrevisao agora usa a Data de Churn real do projeto (churnDate) em vez do
// cálculo de 30 dias (churnRequestDate+30) quando ela já está cadastrada — ver nota em
// lib/transforms.js. Fixture antiga (de antes dessa correção) ficou obsoleta; usando o tool-result
// real recém-buscado (03/11) pros dois inputs.
const TOOLRES = 'C:\\Users\\amand\\.claude\\projects\\c--Users-amand--claude\\43da95f9-467f-4fe1-9caa-25695fdcec05\\tool-results';
const activeProjects = JSON.parse(fs.readFileSync(TOOLRES + '\\mcp-cockpit-cockpit_query_table-1793708408898.txt', 'utf-8'));
const previsao = JSON.parse(fs.readFileSync(TOOLRES + '\\mcp-cockpit-cockpit_entradas_saidas_previsao_query-1793708435176.txt', 'utf-8'));

const { forecastItems, forecastIncomplete, previsaoRiskPool, recoveryItems, activeMrrTotal } = transformPrevisao({ activeProjects, previsao });

const sumFee = forecastItems.reduce((a, r) => a + r.fee, 0);
const confirmedCount = forecastItems.filter((f) => f.confirmed).length;
console.log('forecastItems:', forecastItems.length, '(expected 10)');
console.log('sum fee:', sumFee.toFixed(2), '(expected 56673.06 — bate com o "Previsão: R$56.673" já visto no dashboard)');
console.log('confirmed (Data de Churn real):', confirmedCount, '(expected 6)');
console.log('forecastIncomplete:', forecastIncomplete.length, '(expected 0)');
console.log('previsaoRiskPool:', previsaoRiskPool.length, '(expected 84)');
console.log('recoveryItems:', recoveryItems.length, '(expected 10, same as forecastItems)');

const dec = forecastItems.filter((f) => f.projectedMonth === '2026-12');
console.log('Dezembro items:', dec.length, '(expected 3 — antes do fix, Dezembro nunca aparecia aqui)');
const decSum = dec.reduce((a, f) => a + f.fee, 0);
console.log('Dezembro sum:', decSum.toFixed(2), '(expected 16029.87 — mesmo valor já confirmado em RAW.churnByMonth[\'2026-12\'])');
const allDecConfirmed = dec.every((f) => f.confirmed);
console.log('Dezembro all confirmed (Data de Churn real, não estimativa):', allDecConfirmed);

const sinq = forecastItems.find((f) => f.name.includes('SINQ') && f.projectedMonth === '2026-12');
console.log('SINQ ATELIER noticeDays (real, não o fixo de 30):', sinq && sinq.noticeDays, '(expected 60)');

// % Churn do mês (19/10): activeMrrTotal = soma de fee de TODA a carteira ativa Executar já trazida
// por este mesmo tool-result (não só quem tem churnRequestDate) — recomputa independentemente aqui
// pra conferir que transformPrevisao não dropou nem duplicou nenhum projeto.
const expectedMrrTotal = (activeProjects.data || []).reduce((a, p) => a + (p.fee || 0), 0);
console.log('activeMrrTotal:', activeMrrTotal, '(expected', expectedMrrTotal, '— recomputado direto do mesmo tool-result)');

const ok = forecastItems.length === 10 && Math.abs(sumFee - 56673.06) < 0.01 && confirmedCount === 6
  && forecastIncomplete.length === 0 && previsaoRiskPool.length === 84
  && dec.length === 3 && Math.abs(decSum - 16029.87) < 0.01 && allDecConfirmed
  && sinq && sinq.noticeDays === 60
  && activeMrrTotal === expectedMrrTotal && activeMrrTotal > 0;

if (!ok) {
  console.log('MISMATCH — transformPrevisao output drifted from the known-good value (re-verificado ao vivo em 03/11)');
  process.exitCode = 1;
} else {
  console.log('OK — bate com o recomputado ao vivo em 03/11 (Data de Churn real priorizada sobre a estimativa de 30 dias)');
}
