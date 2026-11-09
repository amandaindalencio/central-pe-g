const fs = require('fs');
const { JSDOM } = require('jsdom');

function loadDom(fetchImpl){
  let html = fs.readFileSync('../public/dashboard.html', 'utf-8');
  html = html.replace(/<link[^>]*>/g, '');
  html = html.replace(/<script src="https:\/\/cdnjs[^"]*"><\/script>/, '');
  const stubScript = `<script>
window.Chart = function(ctx, config){ this._ctx = ctx; this.data = (config && config.data) || {datasets:[]}; this.destroy=function(){}; this.update=function(){}; return this; };
window.IntersectionObserver = function(){ this.observe=function(){}; this.disconnect=function(){}; };
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.error && e.error.stack || e.message)));
${fetchImpl}
</script>`;
  html = html.replace(/<script>\r?\n"use strict";/, stubScript + '\n<script>\n"use strict";');
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, resources: undefined });
}

function assert(cond, label){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) process.exitCode=1; }
function fireChange(win, id, value){
  const el = win.document.getElementById(id);
  el.value = value;
  el.dispatchEvent(new win.Event('change'));
}

// ---- Scenario 1: fetch not available / API unreachable ----
(function scenarioNoFetch(){
  const dom = loadDom(`window.fetch = () => Promise.reject(new Error('network down'));`);
  const doc = dom.window.document;
  setTimeout(()=>{
    assert(dom.window.__errors.length===0, '[no-fetch] no JS errors on load');
    const pill = doc.getElementById('sync-pill-downsell');
    assert(pill.classList.contains('idle') || pill.classList.contains('error'), '[no-fetch] downsell pill does not get stuck mid-sync when the API is unreachable');
    assert(doc.getElementById('kpi-churn').innerHTML.trim().length>0, '[no-fetch] dashboard still renders from static RAW fallback');
  }, 400);
})();

// ---- Scenario 2: /api/data pre-populated (simulating a prior successful sync) ----
(function scenarioDataPreseeded(){
  const fetchImpl = `
window.fetch = async (url, opts) => {
  if (url === '/api/data/downsell') {
    return { ok:true, json: async () => ({
      data: { payload: { '2026-01': [{name:'CLIENTE FAKE SYNC', squad:'Invictus', coord:'jefferson.vieira', am:'Maria', prev:1000, novo:500, delta:-500, motivo:'Teste sync', data:'01/01'}] } },
      status: { status:'ok', updatedAt: Date.now()-3600000, error:null }
    }) };
  }
  if (url === '/api/data/renovacao') {
    return { ok:true, json: async () => ({ data:null, status:null }) };
  }
  return { ok:false, json: async () => ({}) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(()=>{
    assert(dom.window.__errors.length===0, '[preseeded] no JS errors on load');
    const pill = doc.getElementById('sync-pill-downsell');
    assert(pill.classList.contains('ok'), '[preseeded] downsell pill shows ok status from /api/data');
    assert(pill.querySelector('.sync-meta').textContent.includes('há'), '[preseeded] downsell pill shows relative last-updated time');
    const rows = dom.window.downsellRows('2026-01','all');
    assert(rows.some(r=>r.name==='CLIENTE FAKE SYNC'), '[preseeded] downsellRows() reads from SYNCED_DATA once populated from /api/data');
  }, 400);
})();

// ---- Scenario 2b: /api/data/npscsat pre-populated — RAW.npsCsatRaw gets overwritten ----
(function scenarioNpsCsatPreseeded(){
  const fetchImpl = `
window.fetch = async (url, opts) => {
  if (url === '/api/data/npscsat') {
    return { ok:true, json: async () => ({
      data: { payload: {
        projects: [{ id:'fakeproj1', name:'CLIENTE NPSCSAT FAKE', squad:'Invictus', coordinator:'jefferson.vieira', status:'active' }],
        responses: [{ project_id:'fakeproj1', csat_date:'2026-06-10', nps:10, v4:5, service:5, campaigns:5, copy:5, design:5, deadlines:5, results:5, comment:null }]
      } },
      status: { status:'ok', updatedAt: Date.now()-7200000, error:null }
    }) };
  }
  return { ok:true, json: async () => ({ data:null, status:null }) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(()=>{
    assert(dom.window.__errors.length===0, '[npscsat-preseeded] no JS errors on load');
    const pill = doc.getElementById('sync-pill-npscsat');
    assert(pill.classList.contains('ok'), '[npscsat-preseeded] npscsat pill shows ok status from /api/data');
    assert(dom.window.npscxActiveProjects().some(p=>p.id==='fakeproj1'), '[npscsat-preseeded] RAW.npsCsatRaw got overwritten with the synced data (visible via npscxActiveProjects)');
    assert(dom.window.npscxCleanResponses().some(r=>r.project_id==='fakeproj1'), '[npscsat-preseeded] npscxCleanResponses() picks up the new data (memoization cache was cleared)');
  }, 400);
})();

// ---- Scenario 2c: /api/data/churn pre-populated — RAW.churnByMonth gets overwritten ----
(function scenarioChurnPreseeded(){
  const fetchImpl = `
window.fetch = async (url, opts) => {
  if (url === '/api/data/churn') {
    return { ok:true, json: async () => ({
      data: { payload: {
        '2026-01': [{name:'CLIENTE CHURN FAKE', documentId:'fakedoc1', lt:12, coord:'jefferson.vieira', squad:'Invictus', motivo:'Financeiro', churnDetail:'Não informado', valor:5000, data:'15/01'}],
        // projeto ainda ativo com "Data de Churn" futura já cadastrada no Flow (reportado 03/11) —
        // o pipeline já bucketiza isso em Novembro; o que faltava era o gráfico da Visão Geral
        // enxergar esse mês (ver scenarioChurnEvoChartRefreshes abaixo).
        '2026-11': [{name:'CLIENTE CHURN FUTURO FAKE', documentId:'fakedoc2', lt:8, coord:'nayaraventura', squad:'Billions', motivo:'Qualidade da Operação', churnDetail:'Não informado', valor:7000, data:'21/11'}],
      } },
      status: { status:'ok', updatedAt: Date.now()-5400000, error:null }
    }) };
  }
  return { ok:true, json: async () => ({ data:null, status:null }) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(()=>{
    assert(dom.window.__errors.length===0, '[churn-preseeded] no JS errors on load');
    const pill = doc.getElementById('sync-pill-churn');
    assert(pill.classList.contains('ok'), '[churn-preseeded] churn pill shows ok status from /api/data');
    assert(doc.getElementById('churn-table').innerHTML.includes('CLIENTE CHURN FAKE'), '[churn-preseeded] churn table re-renders with the synced data');
    const chart = dom.window._churnEvoChart;
    assert(!!chart, '[churn-preseeded] overview churn evolution chart instance exists after sync');
    const novIdx = chart.data.labels.indexOf('Nov');
    assert(novIdx !== -1, '[churn-preseeded] chart includes a Novembro column');
    assert(chart.data.datasets[1].data[novIdx] === 7000, '[churn-preseeded] chart Novembro value reflects the freshly-synced data (R$7.000), not stuck at the pre-sync (Jan-only) snapshot');
  }, 400);
})();

// ---- Scenario 2d: /api/data/previsao pre-populated — RAW.forecastItems etc. get overwritten ----
(function scenarioPrevisaoPreseeded(){
  const fetchImpl = `
window.fetch = async (url, opts) => {
  if (url === '/api/data/previsao') {
    return { ok:true, json: async () => ({
      data: { payload: {
        forecastItems: [{name:'CLIENTE PREVISAO FAKE', squad:'Invictus', coord:'jefferson.vieira', am:'Maria', requestDate:'01/09/2026', noticeDays:30, projectedDate:'01/10/2026', projectedMonth:'2026-10', overdue:false, fee:9000}],
        forecastIncomplete: [],
        previsaoRiskPool: [{name:'CLIENTE RISCO FAKE', squad:'Billions', coord:'nayaraventura', am:'mychelly', healthMedio:45, flag:'Care', fee:3000}],
        recoveryItems: [{name:'CLIENTE PREVISAO FAKE', squad:'Invictus', coord:'jefferson.vieira', am:'Maria', requestDate:'01/09/2026', projectedDate:'01/10/2026', avisoVencido:false}]
      } },
      status: { status:'ok', updatedAt: Date.now()-3600000, error:null }
    }) };
  }
  return { ok:true, json: async () => ({ data:null, status:null }) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(()=>{
    assert(dom.window.__errors.length===0, '[previsao-preseeded] no JS errors on load');
    const pill = doc.getElementById('sync-pill-previsao');
    assert(pill.classList.contains('ok'), '[previsao-preseeded] previsao pill shows ok status from /api/data');
    assert(doc.getElementById('previsao-table').innerHTML.includes('CLIENTE PREVISAO FAKE'), '[previsao-preseeded] previsao table re-renders with the synced data');
    assert(doc.getElementById('previsao-risk-table').innerHTML.includes('CLIENTE RISCO FAKE'), '[previsao-preseeded] risk pool table re-renders with the synced data');
    assert(doc.getElementById('recovery-table').innerHTML.includes('CLIENTE PREVISAO FAKE'), '[previsao-preseeded] recovery table re-renders with the synced data');
  }, 400);
})();

// ---- Scenario 2d-bis-2: overview insight #2 reports BOTH new churn requests (Data de Solicitação)
// AND actual status-changed-to-Churned confirmations in the same 7-day window (09/11 — "quantos
// projetos tiveram a Data de Solicitação preenchida nesse período e quantos efetivamente tiveram o
// status passado para Churned"). A project with a future-scheduled churnDate (statuses:'active', not
// yet really Churned) must NOT count as a confirmation, even if its date falls in the window. ----
(function scenarioChurnRequestsVsConfirmations(){
  const threeDaysAgo = new Date(Date.now() - 3*86400000);
  const dd = String(threeDaysAgo.getDate()).padStart(2,'0');
  const mm = String(threeDaysAgo.getMonth()+1).padStart(2,'0');
  const ddmm = `${dd}/${mm}`;
  const monthKey = `2026-${mm}`;
  const fetchImpl = `
window.fetch = async (url, opts) => {
  if (url === '/api/data/churn') {
    return { ok:true, json: async () => ({
      data: { payload: { '${monthKey}': [
        {name:'CLIENTE JA CHURNED FAKE', documentId:'fakedocchurned', lt:5, coord:'jefferson.vieira', squad:'Invictus', motivo:'Financeiro', churnDetail:'Não informado', valor:4000, data:'${ddmm}', statuses:'churned'},
        {name:'CLIENTE AGENDADO FAKE', documentId:'fakedocagendado', lt:5, coord:'jefferson.vieira', squad:'Invictus', motivo:'Financeiro', churnDetail:'Não informado', valor:9999, data:'${ddmm}', statuses:'active'}
      ] } },
      status: { status:'ok', updatedAt: Date.now(), error:null }
    }) };
  }
  if (url === '/api/data/previsao') {
    return { ok:true, json: async () => ({
      data: { payload: {
        forecastItems: [{name:'CLIENTE PEDIDO NOVO FAKE', squad:'Invictus', coord:'jefferson.vieira', am:null, requestDate:'${ddmm}/2026', noticeDays:30, projectedDate:'01/12/2026', projectedMonth:'2026-12', overdue:false, fee:3000, confirmed:false}],
        forecastIncomplete: [], previsaoRiskPool: [], recoveryItems: [], activeMrrTotal: 500000
      } },
      status: { status:'ok', updatedAt: Date.now(), error:null }
    }) };
  }
  return { ok:true, json: async () => ({ data:null, status:null }) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(()=>{
    assert(dom.window.__errors.length===0, '[churn-requests-vs-confirmations] no JS errors on load');
    const insightsHTML = doc.getElementById('overview-insights').innerHTML;
    assert(insightsHTML.includes('1</strong> novo(s) pedido(s) de churn'), '[churn-requests-vs-confirmations] counts exactly 1 new request (CLIENTE PEDIDO NOVO FAKE)');
    assert(insightsHTML.includes('1</strong> cliente(s) efetivamente tiveram o status alterado para Churned'), '[churn-requests-vs-confirmations] counts exactly 1 actual confirmation (only the statuses:churned one, not the statuses:active scheduled one)');
    assert(!insightsHTML.includes('2</strong> cliente(s) efetivamente'), '[churn-requests-vs-confirmations] does NOT count the still-active scheduled project as a confirmation');
  }, 400);
})();

// ---- Scenario 2d-ter: forecastItems with a real Data de Churn (confirmed:true) must NOT be double
// counted (reported 03/11 — a still-active project can have both churnRequestDate AND a real churnDate
// set; since 03/11 transformPrevisao prefers the real churnDate, and that same project is ALSO already
// in RAW.churnByMonth via the same date — componentValue('previsao',...) and the overview/previsao
// charts must exclude confirmed items so the combined totals don't count that project twice). ----
(function scenarioPrevisaoConfirmedNotDoubleCounted(){
  const fetchImpl = `
window.fetch = async (url, opts) => {
  if (url === '/api/data/churn') {
    return { ok:true, json: async () => ({
      data: { payload: { '2026-12': [{name:'CLIENTE CONFIRMADO FAKE', documentId:'fakedocdec', lt:9, coord:'nayaraventura', squad:'Billions', motivo:'Financeiro', churnDetail:'Não informado', valor:6000, data:'18/12'}] } },
      status: { status:'ok', updatedAt: Date.now(), error:null }
    }) };
  }
  if (url === '/api/data/previsao') {
    return { ok:true, json: async () => ({
      data: { payload: {
        forecastItems: [
          {name:'CLIENTE CONFIRMADO FAKE', squad:'Billions', coord:'nayaraventura', am:null, requestDate:'19/10/2026', noticeDays:60, projectedDate:'18/12/2026', projectedMonth:'2026-12', overdue:false, fee:6000, confirmed:true},
          {name:'CLIENTE ESTIMADO FAKE', squad:'Invictus', coord:'jefferson.vieira', am:null, requestDate:'01/12/2026', noticeDays:30, projectedDate:'31/12/2026', projectedMonth:'2026-12', overdue:false, fee:2000, confirmed:false},
        ],
        forecastIncomplete: [], previsaoRiskPool: [], recoveryItems: [], activeMrrTotal: 500000
      } },
      status: { status:'ok', updatedAt: Date.now(), error:null }
    }) };
  }
  return { ok:true, json: async () => ({ data:null, status:null }) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(()=>{
    assert(dom.window.__errors.length===0, '[previsao-no-double-count] no JS errors on load');
    fireChange(dom.window, 'churn-month-select', '2026-12');
    const combinedHtml = doc.getElementById('kpi-churn-combined').innerHTML;
    // Churn: R$6.000 (o confirmado) + Downsell: R$0 + Previsão: só o estimado (R$2.000, o confirmado
    // NÃO entra de novo) = R$8.000 combinado — se desse R$14.000, estaria contando o confirmado 2x.
    assert(combinedHtml.includes('8.000') && !combinedHtml.includes('14.000'), '[previsao-no-double-count] combined Revenue Churn KPI does not double-count the confirmed project (6.000 churn + 2.000 estimated previsão = 8.000, not 14.000)');
    fireChange(dom.window, 'churn-month-select', 'all');
    const chart = dom.window._churnEvoChart;
    const decIdx = chart.data.labels.indexOf('Dez');
    assert(chart.data.datasets[1].data[decIdx] === 8000, `[previsao-no-double-count] overview chart Dezembro total is 8.000 (not double-counted), got ${chart.data.datasets[1].data[decIdx]}`);
  }, 400);
})();

// ---- Scenario 2d-bis: % Churn do mês card (19/10) — reads RAW.churnByMonth (synced by "churn") against
// RAW.activeMrrTotal (synced by "previsao", carried over from fetchPrevisaoData's activeProjects with no
// extra Cockpit call). Both services pre-populated together here since the card lives in Revenue Churn
// but depends on data that only arrives via the Previsão sync. ----
(function scenarioChurnPctOfMrr(){
  const fetchImpl = `
window.fetch = async (url, opts) => {
  if (url === '/api/data/churn') {
    return { ok:true, json: async () => ({
      data: { payload: { '2026-01': [{name:'CLIENTE CHURN FAKE', documentId:'fakedoc1', lt:12, coord:'jefferson.vieira', squad:'Invictus', motivo:'Financeiro', churnDetail:'Não informado', valor:5000, data:'15/01'}] } },
      status: { status:'ok', updatedAt: Date.now()-5400000, error:null }
    }) };
  }
  if (url === '/api/data/previsao') {
    return { ok:true, json: async () => ({
      data: { payload: {
        forecastItems: [], forecastIncomplete: [], previsaoRiskPool: [], recoveryItems: [],
        activeMrrTotal: 100000
      } },
      status: { status:'ok', updatedAt: Date.now()-3600000, error:null }
    }) };
  }
  return { ok:true, json: async () => ({ data:null, status:null }) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(()=>{
    assert(dom.window.__errors.length===0, '[churn-pct-mrr] no JS errors on load');
    // "Geral" (all months) by default — card shouldn't compute a misleading % against a single-month-shaped MRR base
    const kpiAll = doc.getElementById('kpi-churn').innerHTML;
    assert(kpiAll.includes('% Churn do mês'), '[churn-pct-mrr] new "% Churn do mês" card renders');
    assert(kpiAll.includes('selecione um mês'), '[churn-pct-mrr] card shows guidance instead of a number when scope is "Geral"');

    fireChange(dom.window, 'churn-month-select', '2026-01');
    const kpiJan = doc.getElementById('kpi-churn').innerHTML;
    // R$5.000 de churn sobre R$100.000 de MRR ativo = 5,0%
    assert(kpiJan.includes('5,0%'), '[churn-pct-mrr] % Churn do mês = valor de churn do mês ÷ RAW.activeMrrTotal (5.000/100.000 = 5,0%)');
    assert(kpiJan.includes('100.000') && kpiJan.includes('5.000'), '[churn-pct-mrr] sub-text shows both the churn value and the MRR base used');
  }, 400);
})();

// ---- Scenario 2e: /api/data/helpflag pre-populated — RAW.helpFlagByMonth gets overwritten ----
(function scenarioHelpFlagPreseeded(){
  const fetchImpl = `
window.fetch = async (url, opts) => {
  if (url === '/api/data/helpflag') {
    return { ok:true, json: async () => ({
      data: { payload: {
        byMonth: { '2026-01': [{name:'CLIENTE HELPFLAG FAKE', squad:'Invictus', coord:'jefferson.vieira', am:'Maria', hs:15}] },
        weeklyTrend: { weeks: ['2026-09-26'], byCoord: { 'jefferson.vieira': [{flagged:1, total:1, pct:100}] } }
      } },
      status: { status:'ok', updatedAt: Date.now()-1800000, error:null }
    }) };
  }
  return { ok:true, json: async () => ({ data:null, status:null }) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(()=>{
    assert(dom.window.__errors.length===0, '[helpflag-preseeded] no JS errors on load');
    const pill = doc.getElementById('sync-pill-helpflag');
    assert(pill.classList.contains('ok'), '[helpflag-preseeded] helpflag pill shows ok status from /api/data');
    assert(doc.getElementById('hf-table').innerHTML.includes('CLIENTE HELPFLAG FAKE'), '[helpflag-preseeded] hf-table re-renders with the synced data');
    // Melissa Pessoa removida de ACTIVE_COORDS em 09/11 (não é mais coordenadora) — a tabela de 12
    // semanas lê as chaves direto do RAW.hfWeeklyTrend.byCoord sincronizado (não da lista estática
    // assada no publish), então um sync de verdade já reflete a lista atual de coordenadores sozinho.
    const weeklyRows = doc.getElementById('hf-weekly-trend').querySelectorAll('tbody tr');
    assert(weeklyRows.length === 1, '[helpflag-preseeded] weekly trend table row count reflects the freshly-synced byCoord (1), not the static 12-coordinator snapshot');
    assert(!doc.getElementById('hf-weekly-trend').innerHTML.includes('Melissa'), '[helpflag-preseeded] weekly trend table has no Melissa Pessoa after a live sync (ACTIVE_COORDS updated 09/11)');
  }, 400);
})();

// ---- Scenario 2f: overview insights recompute after a sync, not frozen at first load (05/10 fix) ----
(function scenarioInsightsRefreshOnSync(){
  // The initial page load already calls /api/data/helpflag once (via initSync's
  // syncRefreshFromApi) before any explicit sync — so the fake payload must only
  // start being served AFTER the POST /api/sync/helpflag, otherwise "before" would
  // already reflect it too and the before/after comparison would be meaningless.
  const fetchImpl = `
window.__helpflagSynced = false;
window.fetch = async (url, opts) => {
  if (opts && opts.method === 'POST' && url === '/api/sync/helpflag') {
    window.__helpflagSynced = true;
    return { ok:true, json: async () => ({ ok:true, updatedAt: Date.now() }) };
  }
  if (url === '/api/data/helpflag') {
    // status carries a FRESH updatedAt (but no data) so initSync's own
    // staleness check never auto-triggers a sync on its own — otherwise
    // that auto-sync (not our explicit runSync below) would be the one
    // applying the fake payload, and before/after would already match.
    if (!window.__helpflagSynced) return { ok:true, json: async () => ({ data:null, status:{status:'ok', updatedAt:Date.now(), error:null} }) };
    return { ok:true, json: async () => ({
      data: { payload: {
        byMonth: {
          '2026-01': [
            {name:'CLIENTE INSIGHT FAKE A', squad:'Invictus', coord:'jefferson.vieira', am:'Maria', hs:5},
            {name:'CLIENTE INSIGHT FAKE B', squad:'Invictus', coord:'jefferson.vieira', am:'Maria', hs:5}
          ],
          '2026-02': [
            {name:'CLIENTE INSIGHT FAKE A', squad:'Invictus', coord:'jefferson.vieira', am:'Maria', hs:28},
            {name:'CLIENTE INSIGHT FAKE B', squad:'Invictus', coord:'jefferson.vieira', am:'Maria', hs:28}
          ]
        },
        weeklyTrend: { weeks: ['2026-09-26'], byCoord: { 'jefferson.vieira': [{flagged:0, total:2, pct:0}] } }
      } },
      status: { status:'ok', updatedAt: Date.now(), error:null }
    }) };
  }
  return { ok:true, json: async () => ({ data:null, status:null }) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(async ()=>{
    const before = doc.getElementById('overview-insights').innerHTML;
    await dom.window.runSync(['helpflag']);
    const after = doc.getElementById('overview-insights').innerHTML;
    assert(dom.window.__errors.length===0, '[insights-refresh] no JS errors after the sync that should refresh insights');
    assert(before !== after, '[insights-refresh] overview-insights HTML actually changes after a Help Flag sync (was frozen at first load before this fix)');
    assert(after.includes('HS≤21') && (after.includes('Janeiro') || after.includes('Fevereiro')), '[insights-refresh] refreshed insight reflects the newly-synced months, not the old static snapshot');
    const weeklyTable = doc.getElementById('hf-weekly-trend').innerHTML;
    assert(weeklyTable.includes('26/09'), '[insights-refresh] 12-week heatmap (hf-weekly-trend) also re-renders from the synced weeklyTrend, not stuck on the old static snapshot');
  }, 400);
})();

// ---- Scenario 3: POST /api/sync/downsell fails (e.g. Cockpit token invalid) ----
(function scenarioSyncError(){
  const fetchImpl = `
window.fetch = async (url, opts) => {
  if (opts && opts.method === 'POST' && url === '/api/sync/downsell') {
    return { ok:false, json: async () => ({ ok:false, error:'Cockpit API 401: token inválido' }) };
  }
  return { ok:true, json: async () => ({ data:null, status:null }) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(async ()=>{
    await dom.window.runSync(['downsell']);
    setTimeout(()=>{
      assert(dom.window.__errors.length===0, '[sync-error] no JS errors after a failed sync attempt');
      const pill = doc.getElementById('sync-pill-downsell');
      assert(pill.classList.contains('error'), '[sync-error] downsell pill shows error status');
      const errBox = doc.getElementById('sync-error-box').textContent;
      assert(errBox.includes('token inválido'), '[sync-error] error box surfaces the real backend error message, not a generic one');
    }, 100);
  }, 400);
})();

// ---- Scenario 4: retry-on-timeout REMOVED 09/11 (Flow tech team: "se der timeout ou erro 504, não
// peça para o agente tentar de novo. Reduza o pedido." — retrying automatically was adding load to an
// already-overloaded backend, the opposite of what was asked). A timeout/504 on /api/sync/renovacao
// must now go straight to the error state with exactly ONE POST attempt, no second try. ----
(function scenarioSyncTimeoutNoRetry(){
  const fetchImpl = `
window.__renovacaoAttempts = 0;
window.fetch = async (url, opts) => {
  if (opts && opts.method === 'POST' && url === '/api/sync/renovacao') {
    window.__renovacaoAttempts++;
    return { ok:false, json: async () => ({ ok:false, error:'MCP error -32001: Request timed out' }) };
  }
  // Pre-seed renovacao as freshly synced so initSync()'s own stale-check (page load) does NOT ALSO
  // auto-trigger a competing runSync(['renovacao']) — otherwise 2 independent calls race and the
  // attempt count becomes non-deterministic instead of exactly 1.
  if (url === '/api/data/renovacao') {
    return { ok:true, json: async () => ({ data: { payload: [] }, status: { status:'ok', updatedAt: Date.now(), error:null } }) };
  }
  return { ok:true, json: async () => ({ data:null, status:null }) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(async ()=>{
    await dom.window.runSync(['renovacao']);
    setTimeout(()=>{
      assert(dom.window.__errors.length===0, '[sync-timeout-no-retry] no JS errors on a timed-out sync');
      assert(dom.window.__renovacaoAttempts===1, '[sync-timeout-no-retry] exactly 1 POST attempt, no automatic retry (09/11: retrying adds load to an overloaded Flow, instead of reducing it)');
      const pill = doc.getElementById('sync-pill-renovacao');
      assert(pill.classList.contains('error'), '[sync-timeout-no-retry] pill goes straight to "error", no "tentando de novo…" intermediate state');
      const errBox = doc.getElementById('sync-error-box').textContent;
      assert(errBox.includes('-32001'), '[sync-timeout-no-retry] real error message still surfaces to the user');
    }, 100);
  }, 400);
})();

// ---- Scenario 5: same for a raw "HTTP 504" (Vercel platform kills the function before any of our
// own JSON comes back) — must also NOT retry. ----
(function scenarioSync504NoRetry(){
  const fetchImpl = `
window.__churnAttempts = 0;
window.fetch = async (url, opts) => {
  if (opts && opts.method === 'POST' && url === '/api/sync/churn') {
    window.__churnAttempts++;
    // Vercel's own 504 page, not JSON from our route — res.json() rejects, runSyncOnce falls
    // back to "HTTP "+res.status with no body.error to read.
    return { ok:false, status:504, json: async () => { throw new Error('Unexpected token < in JSON'); } };
  }
  // Pre-seed churn as freshly synced so initSync()'s own stale-check doesn't also auto-trigger a
  // competing runSync(['churn']) — see same note in scenarioSyncTimeoutNoRetry above.
  if (url === '/api/data/churn') {
    return { ok:true, json: async () => ({ data: { payload: {} }, status: { status:'ok', updatedAt: Date.now(), error:null } }) };
  }
  return { ok:true, json: async () => ({ data:null, status:null }) };
};`;
  const dom = loadDom(fetchImpl);
  const doc = dom.window.document;
  setTimeout(async ()=>{
    await dom.window.runSync(['churn']);
    setTimeout(()=>{
      assert(dom.window.__errors.length===0, '[sync-504-no-retry] no JS errors on a 504 sync');
      assert(dom.window.__churnAttempts===1, '[sync-504-no-retry] exactly 1 POST attempt on a raw HTTP 504 too, no retry');
      const pill = doc.getElementById('sync-pill-churn');
      assert(pill.classList.contains('error'), '[sync-504-no-retry] pill goes straight to "error"');
      console.log('--- done ---');
      process.exit(process.exitCode||0);
    }, 100);
  }, 400);
})();
