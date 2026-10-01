const fs = require('fs');
const { transformPrevisao } = require('../lib/transforms');

const TOOLRES = 'C:\\Users\\amand\\.claude\\projects\\c--Users-amand--claude\\43da95f9-467f-4fe1-9caa-25695fdcec05\\tool-results';
const activeProjects = JSON.parse(fs.readFileSync(TOOLRES + '\\mcp-cockpit-cockpit_query_table-1790857267732.txt', 'utf-8'));
const previsao = JSON.parse(fs.readFileSync(TOOLRES + '\\mcp-cockpit-cockpit_entradas_saidas_previsao_query-1790856443940.txt', 'utf-8'));

const { forecastItems, forecastIncomplete, previsaoRiskPool, recoveryItems } = transformPrevisao({ activeProjects, previsao });

const sumFee = forecastItems.reduce((a, r) => a + r.fee, 0);
console.log('forecastItems:', forecastItems.length, '(expected 6)');
console.log('sum fee:', sumFee, '(expected 41116)');
console.log('forecastIncomplete:', forecastIncomplete.length, '(expected 0)');
console.log('previsaoRiskPool:', previsaoRiskPool.length, '(expected 85)');
console.log('recoveryItems:', recoveryItems.length, '(expected 6, same as forecastItems)');

const kce = forecastItems.find((f) => f.name.includes('KCE'));
console.log('KCE projectedMonth:', kce && kce.projectedMonth, '(expected 2026-08)');

const ok = forecastItems.length === 6 && sumFee === 41116 && forecastIncomplete.length === 0
  && previsaoRiskPool.length === 85 && kce && kce.projectedMonth === '2026-08';

if (!ok) {
  console.log('MISMATCH — transformPrevisao output drifted from the known-good value');
  process.exitCode = 1;
} else {
  console.log('OK — matches the value already validated and published on the dashboard');
}
