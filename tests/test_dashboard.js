const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('../public/dashboard.html', 'utf-8');
// strip external resources (fonts, chart.js cdn) - not needed for logic test
html = html.replace(/<link[^>]*>/g, '');
html = html.replace(/<script src="https:\/\/cdnjs[^"]*"><\/script>/, '');

// stub Chart.js before the main inline script runs
const chartStub = `<script>
window.Chart = function(ctx, config){
  this._ctx = ctx; this.data = (config && config.data) || {datasets:[]};
  this.destroy = function(){}; this.update = function(){};
  return this;
};
window.IntersectionObserver = function(cb){ this.observe=function(){}; this.disconnect=function(){}; };
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.error && e.error.stack || e.message)));
</script>`;
const before = html;
html = html.replace(/<script>\r?\n"use strict";/, chartStub + '\n<script>\n"use strict";');
console.log('stub inserted:', html !== before, '| html includes window.Chart:', html.includes('window.Chart'));

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, resources: undefined });
const { window } = dom;
const doc = window.document;

function assert(cond, label){
  console.log((cond ? 'PASS' : 'FAIL') + ' - ' + label);
  if(!cond) process.exitCode = 1;
}

function fireChange(id, value){
  const el = doc.getElementById(id);
  if(!el){ console.log('FAIL - element not found: '+id); process.exitCode=1; return; }
  el.value = value;
  el.dispatchEvent(new window.Event('change'));
}

setTimeout(()=>{
  console.log('--- window errors after initial load ---');
  window.__errors.forEach(e=>console.log('ERR:', e));
  assert(window.__errors.length===0, 'no JS errors on initial load');

  // Basic structural checks
  assert(!doc.getElementById('kpi-overview'), 'top-of-Visão-Geral KPI block (kpi-overview) removed entirely');
  assert(!!doc.getElementById('kpi-churn').innerHTML.trim(), 'churn KPIs rendered');
  assert(doc.getElementById('churn-coord-select').options.length > 1, 'churn coord select populated');
  assert(!doc.getElementById('nps-player-select'), 'nps player select removed');
  assert(doc.getElementById('hf-coord-select').options.length > 1, 'hf coord select populated');
  assert(!doc.getElementById('kpi-churn').innerHTML.includes('undefined'), 'no "undefined" leaking into churn KPIs');
  assert(!doc.getElementById('npscx-pacing-kpis').innerHTML.includes('undefined'), 'no "undefined" leaking into nps/csat pacing KPIs');
  assert(!doc.getElementById('kpi-previsao').innerHTML.includes('undefined'), 'no "undefined" leaking into previsao KPIs');
  assert(!doc.getElementById('kpi-previsao').innerHTML.includes('NaN'), 'no NaN leaking into previsao KPIs');
  assert(doc.getElementById('previsao-table').innerHTML.includes('KCE'), 'previsao table lists KCE (confirmed forecast item)');
  assert(!!doc.getElementById('kpi-previsao').innerHTML.trim(), 'previsao KPIs rendered');
  assert(!!doc.getElementById('previsao-table').innerHTML.trim(), 'previsao table rendered');
  assert(!!doc.getElementById('kpi-helpflag').innerHTML.trim(), 'helpflag KPIs rendered');
  assert(!!doc.getElementById('npscx-pacing-kpis').innerHTML.trim(), 'nps/csat pacing KPIs rendered');

  // --- TEST: churn month selector ---
  const churnKpiBefore = doc.getElementById('kpi-churn').innerHTML;
  fireChange('churn-month-select', '2026-01');
  const churnKpiAfterJan = doc.getElementById('kpi-churn').innerHTML;
  assert(churnKpiBefore !== churnKpiAfterJan, 'churn KPI changes when month=Jan selected');
  assert(churnKpiAfterJan.includes('177.967') || churnKpiAfterJan.includes('177967'), 'Jan churn KPI shows correct Executar-only value (177.967,35 total — rebuilt 28/09 from cockpit_query_table statuses=churned)');
  assert(doc.getElementById('churn-table').innerHTML.includes('LODEA'), 'churn table shows a January client (LODEA)');

  fireChange('churn-month-select', 'all');
  const churnKpiGeral = doc.getElementById('kpi-churn').innerHTML;
  assert(churnKpiGeral.includes('sem comparativo') === false, 'geral view renders (no crash)');

  // --- TEST: churn squad selector (the reported bug) ---
  fireChange('churn-month-select', '2026-09');
  const kpiBeforeSquad = doc.getElementById('kpi-churn').innerHTML;
  const coordOptionsBefore = doc.getElementById('churn-coord-select').innerHTML;
  fireChange('churn-squad-select', 'Invictus');
  const kpiAfterSquad = doc.getElementById('kpi-churn').innerHTML;
  const coordOptionsAfter = doc.getElementById('churn-coord-select').innerHTML;
  assert(kpiBeforeSquad !== kpiAfterSquad, 'churn KPI changes when squad filter applied (bug #3 check)');
  assert(coordOptionsBefore !== coordOptionsAfter, 'coordinator dropdown changes when squad filter applied');
  assert(!coordOptionsAfter.includes('Vitor Neres'), 'Exclusive-only coordinator (Vitor Neres) excluded when Invictus squad selected');
  assert(doc.getElementById('churn-table').innerHTML.includes('Exclusive') === false || doc.getElementById('churn-table').innerHTML.split('Exclusive').length <= 1, 'churn table does not show Exclusive rows when Invictus filter active');
  const squadRowsHTML = doc.getElementById('churn-squad-rows').innerHTML;
  assert(squadRowsHTML.includes('Invictus') && !squadRowsHTML.includes('Billions'), 'squad-rows section shows only selected squad');
  fireChange('churn-squad-select', 'all');

  // NOTE: the old NPS/CSAT month+squad+metric-toggle+coordinator-drilldown UI was fully
  // replaced (29/09/2026) by a new 5-tab per-response NPS & CSAT section — see test_npscx.js
  // for its dedicated coverage (pacing/visao/squad/coord/alertas tabs, filters, sorting).

  // help flag coordinator select
  fireChange('hf-coord-select', '0');
  const hfPanel0 = doc.getElementById('hf-coord-select-panel-0').classList.contains('active');
  assert(hfPanel0, 'help flag coordinator dropdown switches active panel correctly');

  // churn coord select
  fireChange('churn-coord-select', '0');
  const churnPanel0 = doc.getElementById('churn-coord-select-panel-0').classList.contains('active');
  assert(churnPanel0, 'churn coordinator dropdown switches active panel correctly');

  fireChange('churn-month-select', 'all');

  // forecast gap box mentions FLORESTEC (missing churnRequestDate as of 25/09 refresh)
  assert(doc.getElementById('previsao-gap-box').innerHTML.includes('FLORESTEC'), 'previsao gap box flags FLORESTEC incomplete record');

  // --- TEST: combined Revenue Churn KPI + component toggle (Churn + Downsell + Previsão) ---
  assert(doc.getElementById('downsell-block'), 'downsell block present as component (not a section)');
  assert(!doc.getElementById('downsell-block').querySelector('.section-bar'), 'downsell block has no section heading of its own');
  const combinedHtml = doc.getElementById('kpi-churn-combined').innerHTML;
  assert(combinedHtml.includes('Churn + Downsell + Previsão'), 'combined KPI shows Churn+Downsell+Previsão by default');
  assert(!doc.getElementById('churn-detail-block').hidden, 'churn detail visible by default');
  assert(!doc.getElementById('downsell-block').hidden, 'downsell block visible by default');
  assert(!doc.getElementById('section-previsao').hidden, 'previsao block visible by default');
  assert(doc.getElementById('downsell-table').closest('details'), 'downsell table is wrapped in a collapsible <details>');
  assert(!doc.getElementById('downsell-table').closest('details').open, 'downsell table is collapsed by default');

  const combinedBefore = doc.getElementById('kpi-churn-combined').innerHTML;
  doc.querySelector('#churn-component-toggle button[data-comp="previsao"]').dispatchEvent(new window.Event('click', {bubbles:true}));
  assert(doc.getElementById('section-previsao').hidden, 'previsao section hides when Previsão toggled off');
  assert(doc.getElementById('kpi-churn-combined').innerHTML !== combinedBefore, 'combined KPI recomputes after toggling Previsão off');
  doc.querySelector('#churn-component-toggle button[data-comp="previsao"]').dispatchEvent(new window.Event('click', {bubbles:true})); // toggle back on

  doc.querySelector('#churn-component-toggle button[data-comp="churn"]').dispatchEvent(new window.Event('click', {bubbles:true}));
  assert(doc.getElementById('churn-detail-block').hidden, 'churn detail hides when Churn toggled off');
  assert(!doc.getElementById('downsell-block').hidden, 'downsell block stays visible when only Churn toggled off');
  assert(!doc.getElementById('section-previsao').hidden, 'previsao block stays visible when only Churn toggled off');
  doc.querySelector('#churn-component-toggle button[data-comp="churn"]').dispatchEvent(new window.Event('click', {bubbles:true})); // toggle back on

  const combinedBefore2 = doc.getElementById('kpi-churn-combined').innerHTML;
  doc.querySelector('#churn-component-toggle button[data-comp="downsell"]').dispatchEvent(new window.Event('click', {bubbles:true}));
  assert(doc.getElementById('downsell-block').hidden, 'downsell block hides when Downsell toggled off');
  assert(!doc.getElementById('churn-detail-block').hidden, 'churn detail stays visible when only Downsell toggled off');
  assert(doc.getElementById('kpi-churn-combined').innerHTML !== combinedBefore2, 'combined KPI recomputes after toggling Downsell off');
  doc.querySelector('#churn-component-toggle button[data-comp="downsell"]').dispatchEvent(new window.Event('click', {bubbles:true})); // toggle back on

  // --- TEST: previsao respects squad filter ---
  const previsaoKpiAll = doc.getElementById('kpi-previsao').innerHTML;
  fireChange('churn-squad-select', 'Exclusive');
  const previsaoKpiExclusive = doc.getElementById('kpi-previsao').innerHTML;
  assert(previsaoKpiAll !== previsaoKpiExclusive, 'previsao KPI changes when squad filter applied');
  assert(!doc.getElementById('previsao-table').innerHTML.includes('DPONET'), 'previsao table excludes Invictus client (DPONET) when Exclusive squad selected');
  fireChange('churn-squad-select', 'all');

  // --- TEST: tables are collapsed by default (details without open attr) ---
  ['churn-table','previsao-table','hf-table'].forEach(id=>{
    const el = doc.getElementById(id);
    const details = el.closest('details');
    assert(!!details, `${id} is wrapped in a <details> element`);
    assert(details && !details.hasAttribute('open'), `${id}'s <details> is collapsed by default`);
  });

  // --- TEST: previsao month selector ---
  const previsaoOptEl = doc.getElementById('previsao-month-select');
  assert(previsaoOptEl && previsaoOptEl.options.length > 1, 'previsao month select populated');
  const previsaoTableAll = doc.getElementById('previsao-table').innerHTML;
  fireChange('previsao-month-select', '2026-10');
  const previsaoTableOct = doc.getElementById('previsao-table').innerHTML;
  assert(previsaoTableAll !== previsaoTableOct, 'previsao table changes when month filter applied');
  assert(!previsaoTableOct.includes('KCE') && !previsaoTableOct.includes('DPONET'), 'previsao Oct-only view excludes Set-projected clients (KCE, DPONET)');
  assert(previsaoTableOct.includes('GREEN WAY') || previsaoTableOct.includes('REVINTE') || previsaoTableOct.includes('NOVA ROTA'), 'previsao Oct-only view includes an Oct-projected client');
  fireChange('previsao-month-select', 'all');

  // --- TEST: Help Flag month/squad selectors (item 3) ---
  assert(doc.getElementById('hf-month-select').options.length > 1, 'hf month select populated');
  assert(doc.getElementById('hf-squad-select').options.length > 1, 'hf squad select populated');

  // --- TEST: October (MTD) now visible in Help Flag and NPS/CSAT, without touching Churn/Downsell/Renovação's own "Geral" scope (05/10) ---
  (function checkOctoberVisibility(){
    const hfOpts = Array.from(doc.getElementById('hf-month-select').options).map(o=>o.value);
    assert(hfOpts.includes('2026-10'), 'hf month select includes Outubro (2026-10)');
    const npscxOpts = Array.from(doc.getElementById('npscx-month-select').options).map(o=>o.value);
    assert(npscxOpts.includes('2026-10'), 'npscx month select includes Outubro (2026-10)');
    // Churn's own month list/scope is untouched — still exactly Jan..Out via its own CHURN_MONTHS (pre-existing), not a new regression from MONTHS_INCL_OCT
    const churnOpts = Array.from(doc.getElementById('churn-month-select').options).map(o=>o.value);
    assert(churnOpts.filter(v=>v==='2026-10').length === 1, 'churn month select still has exactly one Outubro option (no duplicate from MONTHS_INCL_OCT)');
  })();
  const hfKpiAll = doc.getElementById('kpi-helpflag').innerHTML;
  fireChange('hf-month-select', '2026-01');
  const hfKpiJan = doc.getElementById('kpi-helpflag').innerHTML;
  assert(hfKpiAll !== hfKpiJan, 'hf KPI changes when month=Jan selected');
  assert(!hfKpiJan.includes('undefined') && !hfKpiJan.includes('NaN'), 'no undefined/NaN in hf KPI after month change');
  fireChange('hf-squad-select', 'Invictus');
  const hfKpiJanInvictus = doc.getElementById('kpi-helpflag').innerHTML;
  assert(hfKpiJan !== hfKpiJanInvictus, 'hf KPI changes when squad filter applied');
  assert(!doc.getElementById('hf-table').innerHTML.includes('sq-dot" style="background:#f472b6'), 'hf table excludes Billions dot color when Invictus filter active');
  fireChange('hf-squad-select', 'all');
  fireChange('hf-month-select', 'all');
  assert(doc.getElementById('hf-churn-cross-box').innerHTML.includes('%'), 'hf churn cross box renders a percentage insight');
  assert(doc.getElementById('hf-governance-grid').innerHTML.includes('select'), 'hf governance grid renders per-coordinator selects');
  const govGridHTML = doc.getElementById('hf-governance-grid').innerHTML;
  assert(!govGridHTML.includes('Ariel Pinguelli') && !govGridHTML.includes('Bruno Zorzan') && !govGridHTML.includes('Carolina Machado') && !govGridHTML.includes('Guilherme Canestri') && !govGridHTML.includes('Rafaela Tolomeu') && !govGridHTML.includes('Ruan Silva') && !govGridHTML.includes('Vitor Cruz') && !govGridHTML.includes('Sem coordenador'), 'hf governance grid excludes inactive coordinators');
  assert(govGridHTML.includes('Jefferson Vieira') || govGridHTML.includes('Melissa Pessoa') || govGridHTML.includes('Nayara Ventura'), 'hf governance grid still includes active coordinators');
  assert(govGridHTML.includes('Clientes em risco'), 'hf governance card shows a collapsible at-risk client list');
  assert(govGridHTML.includes('da carteira ativa em risco'), 'hf governance card shows active portfolio ratio');

  // --- TEST: Help Flag weekly trend table per coordinator ---
  (function checkHfWeeklyTrend(){
    const el = doc.getElementById('hf-weekly-trend');
    assert(!!el && el.innerHTML.trim().length>0, 'hf weekly trend table renders');
    const bodyRows = el.querySelectorAll('tbody tr');
    assert(bodyRows.length === 12, 'hf weekly trend table has one row per active coordinator (12)');
    const headers = el.querySelectorAll('thead th');
    assert(headers.length === 13, 'hf weekly trend table has coord column + 12 week columns');
    assert(!el.innerHTML.includes('undefined') && !el.innerHTML.includes('NaN'), 'no undefined/NaN in hf weekly trend table');
    const firstCoordBefore = bodyRows[0].children[0].textContent.trim();
    const lastWeekTh = Array.from(headers).pop();
    lastWeekTh.click();
    const afterRows = doc.getElementById('hf-weekly-trend').querySelectorAll('tbody tr');
    assert(afterRows.length === 12, 'row count stable after sorting hf weekly trend table');
    const firstCoordAfter = afterRows[0].children[0].textContent.trim();
    assert(firstCoordAfter !== firstCoordBefore, 'hf weekly trend table row order actually changes after clicking a week header to sort');
  })();
  assert(!govGridHTML.includes('(Executar)'), 'hf governance card no longer scopes ratio text to Executar-only (fixed undercount bug: counts full active roster now)');

  // --- TEST: regression — "em risco" count can never exceed portfolio total, ratio never exceeds 100% (bug: 'all' months concatenation double-counted clients flagged in multiple months) ---
  (function checkGovernanceRatioBounds(){
    let totalChecked = 0, violations = [];
    function scan(label){
      const grid = doc.getElementById('hf-governance-grid').innerHTML;
      const matches = [...grid.matchAll(/(\d+)\/(\d+) da carteira ativa em risco \(([\d,]+)%\)/g)];
      matches.forEach(m=>{
        const x = parseInt(m[1]), y = parseInt(m[2]), pct = parseFloat(m[3].replace(',', '.'));
        totalChecked++;
        if(x > y || pct > 100) violations.push(`${label}: ${m[0]}`);
      });
    }
    scan('all/all');
    ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'].forEach(mo=>{ fireChange('hf-month-select', mo); scan(mo); });
    fireChange('hf-month-select', 'all');
    assert(totalChecked >= 100, 'governance ratio check covered all coordinators across all months (' + totalChecked + ' checked)');
    assert(violations.length === 0, 'no coordinator has em-risco count above portfolio total or ratio above 100% — violations: ' + violations.join('; '));
  })();

  // --- TEST: regression — Help Flag risk counts are no longer undercounted (bug: extra Executar-only name filter was silently dropping most real at-risk clients) ---
  (function checkGovernanceUndercountFixed(){
    fireChange('hf-month-select', '2026-09');
    fireChange('hf-squad-select', 'all');
    const grid = doc.getElementById('hf-governance-grid').innerHTML;
    const matches = [...grid.matchAll(/(\d+)\/(\d+) da carteira ativa em risco/g)];
    const maxRisk = Math.max(...matches.map(m=>parseInt(m[1])));
    assert(maxRisk >= 15, 'at least one coordinator shows a realistic (not undercounted) em-risco count in Set (max seen: ' + maxRisk + ')');
    fireChange('hf-month-select', 'all');
  })();

  // --- TEST: Help Flag "Player (CS)" column renamed to "Account Manager" (item 4) ---
  assert(!doc.getElementById('hf-table').innerHTML.includes('Player (CS)'), 'hf-table no longer shows Player (CS) column');
  assert(doc.getElementById('hf-squad-rows').innerHTML.includes('Account Manager'), 'hf-squad-rows shows Account Manager column');
  assert(!doc.getElementById('hf-squad-rows').innerHTML.includes('Player (CS)'), 'hf-squad-rows no longer shows Player (CS) column');
  fireChange('hf-coord-select', '0');
  assert(doc.getElementById('hf-coord-details').innerHTML.includes('Account Manager'), 'hf-coord-details drilldown table shows Account Manager column');
  assert(!doc.getElementById('hf-coord-details').innerHTML.includes('Player (CS)'), 'hf-coord-details no longer shows Player (CS) column');
  fireChange('hf-coord-select', '-1');

  // --- TEST: hf-coord-select (Coordenação drilldown) also filtered to active coordinators only ---
  const hfCoordOptsHTML = doc.getElementById('hf-coord-select').innerHTML;
  assert(!hfCoordOptsHTML.includes('Ariel Pinguelli') && !hfCoordOptsHTML.includes('Bruno Zorzan') && !hfCoordOptsHTML.includes('Sem coordenador'), 'hf coordenacao select excludes inactive coordinators');
  assert(hfCoordOptsHTML.includes('Jefferson Vieira') || hfCoordOptsHTML.includes('Melissa Pessoa'), 'hf coordenacao select still includes active coordinators');

  // --- TEST: Churn Player (CS) drilldown removed by explicit user request (kept only in NPS/CSAT) ---
  assert(!doc.getElementById('churn-player-select'), 'churn player select no longer rendered in Revenue Churn');
  assert(!doc.getElementById('churn-player-details'), 'churn player details block no longer rendered in Revenue Churn');

  // --- TEST: recovery table blocked status text updated (item 1) ---
  // --- TEST: recovery table unblocked (28/09) — renders real data instead of the old "bloqueada" message ---
  (function checkRecoveryTable(){
    const details = Array.from(doc.querySelectorAll('details')).find(d => d.innerHTML.includes('Tabela de recuperação'));
    assert(!!details, 'recovery details block exists');
    assert(!details.innerHTML.includes('bloqueada') && !details.innerHTML.includes('time de tecnologia'), 'recovery block no longer shows the old blocked message');
    const rt = doc.getElementById('recovery-table');
    assert(!!rt && rt.innerHTML.trim().length>0, 'recovery-table renders content');
    assert(rt.innerHTML.includes('KCE'), 'recovery table lists KCE (aviso prévio already expired, still active)');
    assert(rt.innerHTML.includes('vencido') && rt.innerHTML.includes('em andamento'), 'recovery table distinguishes expired vs in-progress aviso prévio');
    fireChange('churn-squad-select', 'Billions');
    assert(!doc.getElementById('recovery-table').innerHTML.includes('KCE'), 'recovery table respects squad filter (KCE is Exclusive, excluded under Billions)');
    fireChange('churn-squad-select', 'all');
  })();

  // --- TEST: Previsão combined chart; "Sinal de confiança" block removed by explicit request ---
  assert(!!doc.getElementById('chartPrevisaoCombined'), 'previsao combined chart canvas exists');
  assert(!doc.getElementById('kpi-previsao-confidence'), 'previsao confidence KPI block no longer rendered');
  assert(!!doc.getElementById('previsao-risk-table').innerHTML.trim(), 'previsao risk pool table renders');

  // NOTE: the old NPS/CSAT Player-role breakdown tables were removed along with the old
  // NPS/CSAT UI (29/09/2026) — not part of the new 5-tab structure's spec.

  // --- TEST: sortable table headers (click to sort, click again to reverse) ---
  (function checkSortableHeaders(){
    const clickHeader = (tableSel, text) => {
      const table = doc.querySelector(tableSel);
      const th = Array.from(table.querySelectorAll('th')).find(t=>t.textContent.includes(text));
      assert(!!th, `sortable header "${text}" found in ${tableSel}`);
      assert(th.dataset.sortTable, `header "${text}" is marked sortable (data-sort-table present)`);
      th.click();
    };
    const colVals = (tableSel, colIdx) => Array.from(doc.querySelector(tableSel).querySelectorAll('tbody tr')).map(tr=>tr.children[colIdx].textContent.trim());

    // A paginate()-based table (churn-table, Valor saída column)
    fireChange('churn-month-select', 'all');
    clickHeader('#churn-table table', 'Valor sa');
    const churnDesc = colVals('#churn-table table', 6).map(v=>parseFloat(v.replace(/[^\d,.-]/g,'').replace(',','.')));
    assert(churnDesc.every((v,i)=>i===0||v<=churnDesc[i-1]), 'churn-table (paginate-based) sorts descending on Valor saída click');
  })();

  // --- TEST: Revenue Churn month selector includes Outubro with partial (Previsão-only) data (item 1) ---
  const churnMonthOpts = Array.from(doc.getElementById('churn-month-select').options).map(o=>o.value);
  assert(churnMonthOpts.includes('2026-10'), 'churn month select includes Outubro/2026');
  fireChange('churn-month-select', '2026-10');
  const octCombinedHTML = doc.getElementById('kpi-churn-combined').innerHTML;
  assert(!octCombinedHTML.includes('undefined') && !octCombinedHTML.includes('NaN'), 'no undefined/NaN when Outubro selected in Revenue Churn');
  assert(doc.getElementById('churn-scope-note').textContent.includes('parcial'), 'churn scope note flags Outubro as partial (Previsão only)');
  fireChange('churn-month-select', 'all');

  // --- TEST: Renovação section built (28/09) using cockpit_entradas_saidas_renovacoes_query data ---
  const renovSection = doc.getElementById('section-renovacao');
  assert(!!renovSection, 'renovacao section exists');
  assert(!renovSection.innerHTML.includes('bloqueada') && !renovSection.innerHTML.includes('não foi construída'), 'renovacao section no longer shows the old blocked message');
  assert(!!doc.querySelector('a.nav-tab[href="#section-renovacao"]'), 'renovacao nav tab exists');
  assert(!!doc.getElementById('kpi-renovacao') && doc.getElementById('kpi-renovacao').innerHTML.trim().length>0, 'renovacao KPI cards render');
  assert(!doc.getElementById('kpi-renovacao').innerHTML.includes('undefined') && !doc.getElementById('kpi-renovacao').innerHTML.includes('NaN'), 'no undefined/NaN in renovacao KPIs');
  const renovTable = doc.getElementById('renovacao-table');
  assert(!!renovTable && renovTable.innerHTML.trim().length>0, 'renovacao-table renders');
  assert(renovTable.innerHTML.includes('ciclo passou, ativo') || renovTable.innerHTML.includes('d</span>') || renovTable.innerHTML.includes('hoje'), 'renovacao table shows days-until-renewal status chips');

  // --- TEST: Renovação month selector (28/09) ---
  (function checkRenovacaoMonthSelector(){
    const sel = doc.getElementById('renovacao-month-select');
    assert(!!sel && sel.options.length > 1, 'renovacao month select populated');
    const allCount = doc.getElementById('renovacao-table').textContent;
    const decOption = Array.from(sel.options).find(o=>o.textContent.includes('Dezembro'));
    assert(!!decOption, 'renovacao month select includes Dezembro/2026');
    fireChange('renovacao-month-select', decOption.value);
    const decHTML = doc.getElementById('renovacao-table').innerHTML;
    assert(!decHTML.includes('undefined') && !decHTML.includes('NaN'), 'no undefined/NaN when filtering renovacao by Dezembro');
    assert(doc.getElementById('kpi-renovacao').innerHTML.includes('Renovações no mês'), 'renovacao KPI label switches to month-scoped wording when a month is selected');
    fireChange('renovacao-month-select', 'all');
  })();

  // --- TEST: Renovação annual consolidated pivot tables (project × month + by-squad, 05/10) ---
  (function checkRenovacaoAnnualPivots(){
    const annual = doc.getElementById('renovacao-annual-table');
    assert(!!annual && annual.innerHTML.trim().length>0, 'renovacao-annual-table renders');
    assert(annual.innerHTML.includes('Booking'), 'renovacao-annual-table has a Booking column (project-level pivot)');
    assert(annual.innerHTML.includes('/2026'), 'renovacao-annual-table has MM/2026 month columns');
    assert(annual.innerHTML.includes('Total'), 'renovacao-annual-table has a Total row');
    assert(!annual.innerHTML.includes('undefined') && !annual.innerHTML.includes('NaN'), 'no undefined/NaN in renovacao-annual-table');

    const squadPivots = doc.getElementById('renovacao-squad-pivots');
    assert(!!squadPivots && squadPivots.innerHTML.trim().length>0, 'renovacao-squad-pivots renders');
    ['Invictus','Billions','Exclusive'].forEach(sq=>{
      assert(squadPivots.innerHTML.includes(sq), `renovacao-squad-pivots includes a ${sq} block`);
    });
    assert(!squadPivots.innerHTML.includes('Booking'), 'renovacao-squad-pivots tables omit the Booking column (project-level only)');
    assert(!squadPivots.innerHTML.includes('undefined') && !squadPivots.innerHTML.includes('NaN'), 'no undefined/NaN in renovacao-squad-pivots');
  })();

  // NOTE: the old CSAT-evolution-by-squad/coordenação tables were superseded (29/09/2026) by
  // the new 5-tab NPS & CSAT section's Squad/Coordenação tabs, built on real per-response data.

  // --- TEST: Overview insights (item 7) — exactly 5 fixed cards after pruning to Help Flag + 4 new weekly-reading insights ---
  const insightsHTML = doc.getElementById('overview-insights').innerHTML;
  assert(insightsHTML.trim().length > 0, 'overview insights block renders content');
  assert((insightsHTML.match(/insight-box/g)||[]).length === 5, 'overview insights renders exactly 5 cards');
  assert(!insightsHTML.includes('foi quem mais se moveu de Ago para Set'), 'removed insight: biggest MoM mover');
  assert(!insightsHTML.includes('combina os piores sinais em Set'), 'removed insight: worst combined coordenação signals');
  assert(!insightsHTML.includes('Previsão em aberto:'), 'removed insight: forecast vs realized churn multiple');
  assert(insightsHTML.includes('Help Flag antecipa risco real'), 'kept insight: Help Flag predicts churn');
  assert(insightsHTML.includes('Previsão'), 'new insight: novos projetos na Previsão de Churn');
  assert(insightsHTML.includes('de MRR'), 'new-forecast insight includes total MRR of the entrants');
  assert(insightsHTML.includes('Carteira ativa') && insightsHTML.includes('HS≤21'), 'new insight: carteira-wide HS≤21 trend present (now computed dynamically from RAW.helpFlagByMonth, month-over-month since 05/10 rewrite)');
  assert(insightsHTML.includes('maior piora'), 'new insight: pior coordenação (month-over-month wording since 05/10 rewrite, was "na semana")');
  assert(insightsHTML.includes('respostas de NPS') && insightsHTML.includes('CSAT V4'), 'new insight: respostas NPS/CSAT recebidas');

  console.log('--- final window errors ---');
  window.__errors.forEach(e=>console.log('ERR:', e));
  assert(window.__errors.length===0, 'no JS errors after all interactions');

  console.log(process.exitCode === 1 ? '\\n=== SOME TESTS FAILED ===' : '\\n=== ALL TESTS PASSED ===');
}, 500);
