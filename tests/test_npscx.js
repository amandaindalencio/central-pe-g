const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('../public/dashboard.html', 'utf-8');
html = html.replace(/<link[^>]*>/g, '');
html = html.replace(/<script src="https:\/\/cdnjs[^"]*"><\/script>/, '');

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
html = html.replace(/<script>\r?\n"use strict";/, chartStub + '\n<script>\n"use strict";');

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, resources: undefined });
const { window } = dom;
const doc = window.document;

function assert(cond, label){ console.log((cond?'PASS':'FAIL')+' - '+label); if(!cond) process.exitCode=1; }
function fireChange(id, value){ const el=doc.getElementById(id); if(!el){ console.log('FAIL - element not found: '+id); process.exitCode=1; return;} el.value=value; el.dispatchEvent(new window.Event('change')); }
function clickTab(tab){ const btn = doc.querySelector(`#npscx-tabnav button[data-tab="${tab}"]`); btn.dispatchEvent(new window.Event('click', {bubbles:true})); }

setTimeout(()=>{
  console.log('--- window errors after initial load ---');
  window.__errors.forEach(e=>console.log('ERR:', e));
  assert(window.__errors.length===0, 'no JS errors on initial load');

  assert(window.npscxActiveProjects().length === 226, 'npsCsatRaw has 226 active projects');
  assert(window.npscxCleanResponses().length === 435, 'cleanResponses count matches raw events');

  // pacing tab (default active)
  assert(doc.getElementById('npscx-tab-pacing').hidden === false, 'pacing tab visible by default');
  assert(doc.getElementById('npscx-pacing-kpis').children.length === 4, 'pacing tab has 4 KPI cards');
  assert(doc.getElementById('npscxPacingChart'), 'pacing chart canvas exists');

  // switch to visao
  clickTab('visao');
  assert(doc.getElementById('npscx-tab-visao').hidden === false, 'visao tab visible after click');
  assert(doc.getElementById('npscx-tab-pacing').hidden === true, 'pacing tab hidden after switching');
  assert(doc.getElementById('npscx-visao-kpis').children.length === 3, 'visao tab has 3 KPI cards');
  assert(doc.getElementById('npscx-dim-cards').children.length === 7, 'visao tab has 7 dimension cards');
  assert(window.__errors.length===0, 'no errors after switching to visao tab');

  // squad tab
  clickTab('squad');
  assert(doc.getElementById('npscx-squad-cards').children.length >= 3, 'squad tab renders at least 3 squad cards');
  assert(doc.getElementById('npscx-squad-ranking').innerHTML.includes('table'), 'squad ranking table renders');
  assert(window.__errors.length===0, 'no errors after switching to squad tab');

  // coord tab
  clickTab('coord');
  assert(doc.getElementById('npscx-coord-select').options.length > 1, 'coord select has options');
  assert(doc.getElementById('npscx-coord-consol-table').innerHTML.includes('table'), 'coord consolidated table renders');
  assert(window.__errors.length===0, 'no errors after switching to coord tab');

  // alertas tab
  clickTab('alertas');
  assert(doc.getElementById('npscx-alert-detractors').innerHTML.includes('table') || doc.getElementById('npscx-alert-detractors').innerHTML.includes('Sem registros'), 'detractors alert renders');
  assert(doc.getElementById('npscx-alert-worstdim').innerHTML.length>0, 'worst-dim alert renders');
  assert(window.__errors.length===0, 'no errors after switching to alertas tab');

  // filters
  clickTab('pacing');
  fireChange('npscx-month-select', '2026-06');
  assert(window.__errors.length===0, 'no errors after changing month filter');
  fireChange('npscx-squad-select', 'Invictus');
  assert(window.__errors.length===0, 'no errors after changing squad filter');
  fireChange('npscx-squad-select', 'all');
  fireChange('npscx-month-select', 'all');

  // sorting smoke test on squad ranking table
  clickTab('squad');
  const th = Array.from(doc.querySelectorAll('#npscx-squad-ranking th')).find(t=>t.textContent.includes('NPS Score'));
  if(th){ th.dispatchEvent(new window.Event('click', {bubbles:true})); assert(window.__errors.length===0, 'no errors after sorting squad ranking table'); }
  else assert(false, 'NPS Score header found in squad ranking table');

  console.log('--- done ---');
  process.exit(process.exitCode||0);
}, 300);
