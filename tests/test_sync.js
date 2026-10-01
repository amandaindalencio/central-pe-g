const fs = require('fs');
const { JSDOM } = require('jsdom');

function loadDom(fetchImpl){
  let html = fs.readFileSync('../public/dashboard.html', 'utf-8');
  html = html.replace(/<link[^>]*>/g, '');
  html = html.replace(/<script src="https:\/\/cdnjs[^"]*"><\/script>/, '');
  const stubScript = `<script>
window.Chart = function(){ this.destroy=function(){}; this.update=function(){}; return this; };
window.IntersectionObserver = function(){ this.observe=function(){}; this.disconnect=function(){}; };
window.__errors = [];
window.addEventListener('error', e => window.__errors.push(String(e.error && e.error.stack || e.message)));
${fetchImpl}
</script>`;
  html = html.replace(/<script>\r?\n"use strict";/, stubScript + '\n<script>\n"use strict";');
  return new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, resources: undefined });
}

function assert(cond, label){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) process.exitCode=1; }

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
      data: { payload: { '2026-01': [{name:'CLIENTE CHURN FAKE', documentId:'fakedoc1', lt:12, coord:'jefferson.vieira', squad:'Invictus', motivo:'Financeiro', churnDetail:'Não informado', valor:5000, data:'15/01'}] } },
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
      console.log('--- done ---');
      process.exit(process.exitCode||0);
    }, 100);
  }, 400);
})();
