// Testa a lógica de merge "carga inicial + incremento" adicionada em 13/11 (manual de boas
// práticas §3.3 — "o passado não muda: baixe uma vez e guarde") pra Help Flag e NPS/CSAT.
// Puro — não chama o Cockpit, só exercita transformHelpFlag/transformNpsCsat com dado sintético.
const assert = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + label); if (!cond) process.exitCode = 1; };
const { transformHelpFlag, transformNpsCsat } = require('../lib/transforms');

/* ---- Help Flag ---- */

function hfRow(referenceDate, projectDocumentId, values) {
  return { referenceDate, projectDocumentId, values };
}

// Primeira sincronização (previous=null) — deve se comportar igual à carga completa de antes.
(function () {
  const monthlyRows = [hfRow('2026-01-31', 'p1', { name: 'A', squad: 'Invictus', project_coordinator: 'jefferson.vieira', algorithm_health_avg_score: 15 })];
  const weeklyRows = [[hfRow('2026-10-25', 'p1', { project_coordinator: 'jefferson.vieira', algorithm_health_avg_score: 15 })]];
  const weekEndDates = ['2026-10-25'];
  const result = transformHelpFlag({ monthlyRows, weeklyRows, weekEndDates }, null);
  assert(result.byMonth['2026-01'] && result.byMonth['2026-01'].length === 1, '[helpflag] primeira sync (previous=null) monta byMonth normalmente');
  assert(result.weeklyTrend.weeks.length === 1, '[helpflag] primeira sync monta weeklyTrend normalmente');
})();

// Incremental: mês novo (Nov) chega, mês antigo (Jan) salvo antes continua intacto sem ser buscado de novo.
(function () {
  const previous = {
    byMonth: { '2026-01': [{ name: 'A', squad: 'Invictus', coord: 'jefferson.vieira', am: null, hs: 15 }] },
    weeklyTrend: { weeks: ['2026-10-25'], byCoord: { 'jefferson.vieira': [{ flagged: 1, total: 1, pct: 100 }] } },
  };
  const monthlyRows = [hfRow('2026-11-07', 'p2', { name: 'B', squad: 'Billions', project_coordinator: 'nayaraventura', algorithm_health_avg_score: 25 })];
  const weeklyRows = [[hfRow('2026-11-01', 'p2', { project_coordinator: 'nayaraventura', algorithm_health_avg_score: 25 })]];
  const weekEndDates = ['2026-11-01'];
  const result = transformHelpFlag({ monthlyRows, weeklyRows, weekEndDates }, previous);
  assert(result.byMonth['2026-01'] && result.byMonth['2026-01'][0].name === 'A', '[helpflag] mês antigo (Jan) preservado sem rebuscar');
  assert(result.byMonth['2026-11'] && result.byMonth['2026-11'][0].name === 'B', '[helpflag] mês novo (Nov) incorporado');
  assert(result.weeklyTrend.weeks.length === 2 && result.weeklyTrend.weeks.includes('2026-10-25') && result.weeklyTrend.weeks.includes('2026-11-01'), '[helpflag] semana antiga preservada + semana nova incorporada');
})();

// Janela deslizante: ao ultrapassar 12 semanas, a mais antiga é descartada.
(function () {
  const oldWeeks = Array.from({ length: 12 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`);
  const previous = {
    byMonth: {},
    weeklyTrend: { weeks: oldWeeks, byCoord: { 'jefferson.vieira': oldWeeks.map(() => ({ flagged: 1, total: 2, pct: 50 })) } },
  };
  const weekEndDates = ['2026-11-08'];
  const weeklyRows = [[hfRow('2026-11-08', 'p1', { project_coordinator: 'jefferson.vieira', algorithm_health_avg_score: 10 })]];
  const result = transformHelpFlag({ monthlyRows: [], weeklyRows, weekEndDates }, previous);
  assert(result.weeklyTrend.weeks.length === 12, '[helpflag] janela deslizante mantém exatamente 12 semanas');
  assert(!result.weeklyTrend.weeks.includes(oldWeeks[0]), '[helpflag] semana mais antiga (13ª) é descartada ao entrar uma nova');
  assert(result.weeklyTrend.weeks.includes('2026-11-08'), '[helpflag] semana nova está presente');
})();

/* ---- NPS & CSAT ---- */

function npsRow(referenceDate, projectDocumentId, values, metricCreatedAt) {
  return { referenceDate, projectDocumentId, values, metricCreatedAt };
}

// Sem signature prévio (primeira sync): 1ª linha de um projeto com métrica preenchida sempre conta como evento — comportamento já validado antes desta correção.
(function () {
  const rows = [npsRow('2026-01-03', 'p1', { name: 'A', csat_nps_value: 9 }, { csat_nps_value: '2026-01-02T00:00:00Z' })];
  const result = transformNpsCsat(rows, null);
  assert(result.responses.length === 1, '[npscsat] primeira sync (sem previous) detecta evento na 1ª linha normalmente');
  assert(result.signatures['p1'] && result.signatures['p1'].csat_nps_value === '2026-01-02T00:00:00Z', '[npscsat] signature do projeto é salvo pra próxima incremental');
})();

// COM signature prévio: a mesma linha/valor (sem mudança real) NÃO deve ser recontada como evento novo —
// esse é o bug que uma janela estreita teria sem o signature (toda 1ª linha da janela "parece nova").
(function () {
  const previous = {
    projects: [{ id: 'p1', name: 'A', squad: null, coordinator: null, status: 'active' }],
    responses: [{ project_id: 'p1', csat_date: '2026-01-02', nps: 9 }],
    signatures: { p1: { csat_nps_value: '2026-01-02T00:00:00Z' } },
  };
  // janela estreita (incremental) com a MESMA metricCreatedAt de antes — nada mudou de verdade.
  const rows = [npsRow('2026-11-07', 'p1', { name: 'A', csat_nps_value: 9 }, { csat_nps_value: '2026-01-02T00:00:00Z' })];
  const result = transformNpsCsat(rows, previous);
  assert(result.responses.length === 1, '[npscsat] signature prévio evita falso-positivo: nenhum evento novo detectado quando metricCreatedAt não mudou');
  assert(result.responses[0].csat_date === '2026-01-02', '[npscsat] resposta antiga (de previous) continua presente no merge, sem duplicar');
})();

// COM signature prévio e mudança real: um metricCreatedAt novo (resposta de verdade) É detectado e somado ao histórico antigo.
(function () {
  const previous = {
    projects: [{ id: 'p1', name: 'A', squad: null, coordinator: null, status: 'active' }],
    responses: [{ project_id: 'p1', csat_date: '2026-01-02', nps: 9 }],
    signatures: { p1: { csat_nps_value: '2026-01-02T00:00:00Z' } },
  };
  const rows = [npsRow('2026-11-07', 'p1', { name: 'A', csat_nps_value: 7 }, { csat_nps_value: '2026-11-06T00:00:00Z' })];
  const result = transformNpsCsat(rows, previous);
  assert(result.responses.length === 2, '[npscsat] resposta nova (metricCreatedAt mudou de verdade) é detectada e somada à antiga — total 2, não substitui nem perde a antiga');
  assert(result.responses.some((r) => r.csat_date === '2026-01-02') && result.responses.some((r) => r.csat_date === '2026-11-06'), '[npscsat] tanto a resposta antiga quanto a nova aparecem no merge final');
})();

// Projeto que não aparece na janela estreita mantém seu cadastro/signature antigos intactos.
(function () {
  const previous = {
    projects: [{ id: 'p1', name: 'A', squad: 'Invictus', coordinator: 'x', status: 'active' }, { id: 'p2', name: 'B', squad: 'Billions', coordinator: 'y', status: 'active' }],
    responses: [],
    signatures: { p1: { csat_nps_value: '2026-01-02T00:00:00Z' }, p2: { csat_nps_value: '2026-02-01T00:00:00Z' } },
  };
  const rows = [npsRow('2026-11-07', 'p1', { name: 'A', csat_nps_value: 10 }, { csat_nps_value: '2026-11-07T00:00:00Z' })];
  const result = transformNpsCsat(rows, previous);
  assert(result.projects.find((p) => p.id === 'p2'), '[npscsat] projeto ausente da janela estreita (p2) continua no cadastro mesclado');
  assert(result.signatures.p2 && result.signatures.p2.csat_nps_value === '2026-02-01T00:00:00Z', '[npscsat] signature de p2 não é apagado por não ter aparecido nesta janela');
})();

console.log('--- done ---');
