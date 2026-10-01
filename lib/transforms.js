// Ported from central-wbr-peg.html (transformDownsell/transformRenovacao) and
// from this session's Python NPS/CSAT extraction script (extractNpsCsatResponses)
// — same logic already validated against the Cockpit MCP tools:
//   25 downsells / R$148.274,18; 21 renovações / R$130.078,86;
//   NPS/CSAT: 226 projects / 435 response events (Jan–Set/2026 window).
// Operates on the JSON shape cockpit_query_*/cockpit_query_history return via MCP.

const MONTHS = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'];

function teamRole(team, role) {
  const t = (team || []).find(x => x.squadRole === role);
  return t ? t.user.username : null;
}
function squadName(project) {
  const s = project.squad;
  return (s && s[0] && s[0].name) || 'Sem squad';
}
function ddmm(iso) {
  const d = (iso || '').slice(0, 10).split('-');
  return d.length === 3 ? d[2] + '/' + d[1] : '';
}
function ddmmyyyy(iso) {
  const d = (iso || '').slice(0, 10).split('-');
  return d.length === 3 ? d[2] + '/' + d[1] + '/' + d[0] : '';
}
function addDays(iso, days) {
  const dt = new Date((iso || '').slice(0, 10) + 'T00:00:00Z');
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function transformDownsell(payload) {
  const byMonth = {};
  ((payload && payload.data) || []).forEach(row => {
    const p = row.project || {};
    const mk = (row.effectiveDate || '').slice(0, 7);
    if (!MONTHS.includes(mk)) return;
    (byMonth[mk] = byMonth[mk] || []).push({
      name: p.name, squad: squadName(p),
      coord: teamRole(p.projectTeam, 'project_coordinator'),
      am: teamRole(p.projectTeam, 'account_manager'),
      prev: row.previousFee, novo: row.newFee, delta: row.deltaFee,
      motivo: row.notes, data: ddmm(row.effectiveDate),
    });
  });
  return byMonth;
}

function transformRenovacao(payload) {
  return ((payload && payload.data) || []).map(p => ({
    name: p.name, squad: squadName(p),
    coord: teamRole(p.projectTeam, 'project_coordinator'),
    am: teamRole(p.projectTeam, 'account_manager'),
    renewalDate: ddmm(p.renewalDateIso), bookingMonths: p.effectiveBookingMonths,
    fee: p.fee, daysUntil: p.daysUntilRenewal,
  }));
}

/* ---- Revenue Churn ---- */

// Confirmado ao vivo nesta sessão: distintos valores reais de churnReason
// (fora null) são exatamente estes 7 — mapeados pros rótulos já usados no
// dashboard (MOTIVO_COLOR). Qualquer valor novo/desconhecido cai em "Não
// informado" em vez de aparecer com o código técnico cru.
const CHURN_REASON_LABEL = {
  qualidade_operacao: 'Qualidade da Operação',
  financeiro: 'Financeiro',
  interno_cliente: 'Interno Cliente',
  produto_inadequado: 'Produto Inadequado',
  cliente_nao_ativado: 'Cliente Não Ativado',
  falha_na_venda: 'Falha na Venda',
  demissao_cliente: 'Demissão Cliente',
};

function transformChurn(payload) {
  const byMonth = {};
  ((payload && payload.data) || []).forEach((row) => {
    if (!row.churnDate) return;
    const mk = row.churnDate.slice(0, 7);
    const squad = Array.isArray(row.squad) ? (row.squad[0] && row.squad[0].name) : null;
    (byMonth[mk] = byMonth[mk] || []).push({
      name: row.name,
      documentId: row.documentId,
      lt: row.lt,
      coord: row.project_coordinator || 'Sem coordenador',
      squad: squad || 'Sem squad',
      motivo: CHURN_REASON_LABEL[row.churnReason] || 'Não informado',
      churnDetail: row.churnDetail || 'Não informado',
      valor: row.fee,
      data: ddmm(row.churnDate),
    });
  });
  return byMonth;
}

/* ---- Previsão de Churn ---- */

// Período de aviso prévio contratual padrão da V4 — confirmado ao vivo:
// as 6 projeções atuais batem exatamente (R$41.116 total) usando este
// valor fixo, igual ao já publicado no dashboard. Não é um número
// inventado — é a mesma regra de negócio já usada antes.
const NOTICE_PERIOD_DAYS = 30;

function transformPrevisao({ activeProjects, previsao }) {
  const today = new Date().toISOString().slice(0, 10);

  const withRequest = ((activeProjects && activeProjects.data) || []).filter((p) => p.churnRequestDate);
  const forecastItems = [];
  const forecastIncomplete = [];

  withRequest.forEach((p) => {
    const squad = Array.isArray(p.squad) ? (p.squad[0] && p.squad[0].name) : null;
    const coord = p.project_coordinator || null;
    if (!p.fee || !squad) {
      forecastIncomplete.push({
        name: p.name, squad: squad || 'Sem squad', coord: coord || 'Sem coordenador',
        issue: !p.fee ? 'sem fee cadastrado' : 'sem squad cadastrado',
      });
      return;
    }
    const requestIso = p.churnRequestDate.slice(0, 10);
    const projectedIso = addDays(requestIso, NOTICE_PERIOD_DAYS);
    forecastItems.push({
      name: p.name, squad, coord,
      am: p.account_manager || null,
      requestDate: ddmmyyyy(requestIso),
      noticeDays: NOTICE_PERIOD_DAYS,
      projectedDate: ddmmyyyy(projectedIso),
      projectedMonth: projectedIso.slice(0, 7),
      overdue: projectedIso < today,
      fee: p.fee,
    });
  });

  const previsaoRiskPool = ((previsao && previsao.data) || [])
    .filter((p) => p.customerCareStatus === 'Antecipação')
    .map((p) => ({
      name: p.name,
      squad: squadName(p),
      coord: teamRole(p.projectTeam, 'project_coordinator') || 'Sem coordenador',
      am: teamRole(p.projectTeam, 'account_manager'),
      healthMedio: p.healthMedio != null ? +p.healthMedio : null,
      flag: p.flag || null,
      fee: p.fee,
    }));

  // Mesma base de "aviso prévio formal" (withRequest), só que exibida na
  // tabela de recuperação: quem já passou do prazo sem sair de fato (sinal
  // de retenção) vs quem ainda está dentro do prazo.
  const recoveryItems = forecastItems.map((f) => ({
    name: f.name, squad: f.squad, coord: f.coord, am: f.am,
    requestDate: f.requestDate, projectedDate: f.projectedDate, avisoVencido: f.overdue,
  }));

  return { forecastItems, forecastIncomplete, previsaoRiskPool, recoveryItems };
}

/* ---- NPS & CSAT: per-response event extraction from weekly LOCF-dense history ---- */

const NPSCSAT_METRIC_COLS = [
  'csat_nps_value', 'csat_v4_score', 'csat_service_score', 'csat_campaigns_score',
  'csat_copy_score', 'csat_design_score', 'csat_deadlinae_score', 'csat_results_score',
  'csat_observations', 'nps_observations',
];

function cleanComment(s) {
  if (!s) return null;
  let out = String(s);
  out = out.replace(/Card da pesquisa:\s*\S+/gi, '');
  out = out.replace(/Nota CSAT:\s*\d+(\.\d+)?/gi, '');
  out = out.trim();
  out = out.replace(/^[\s.-]+|[\s.-]+$/g, '');
  return out || null;
}

// rows: raw `data` array from cockpit_query_history (granularity=weekly,
// includeMetricTimestamps=true). Detects a new response event whenever any
// of the 10 metric columns' metricCreatedAt changes from the previous
// week's row for that project — the same technique validated by hand this
// session (18 pages / 8814 rows -> 226 projects / 435 events).
function extractNpsCsatResponses(rows) {
  const byProject = {};
  rows.forEach((r) => {
    (byProject[r.projectDocumentId] = byProject[r.projectDocumentId] || []).push(r);
  });

  const projects = {};
  const responses = [];

  Object.keys(byProject).forEach((pid) => {
    const list = byProject[pid].slice().sort((a, b) => (a.referenceDate < b.referenceDate ? -1 : 1));
    const prevSig = {};

    list.forEach((row) => {
      const mc = row.metricCreatedAt || {};
      const curSig = {};
      NPSCSAT_METRIC_COLS.forEach((k) => { curSig[k] = mc[k] || null; });

      const changedKeys = NPSCSAT_METRIC_COLS.filter((k) => curSig[k] && curSig[k] !== prevSig[k]);
      if (changedKeys.length) {
        const v = row.values || {};
        const eventDate = changedKeys.reduce((max, k) => (curSig[k] > max ? curSig[k] : max), changedKeys[0] && curSig[changedKeys[0]]).slice(0, 10);
        responses.push({
          project_id: pid,
          csat_date: eventDate,
          nps: v.csat_nps_value ?? null,
          v4: v.csat_v4_score ?? null,
          service: v.csat_service_score ?? null,
          campaigns: v.csat_campaigns_score ?? null,
          copy: v.csat_copy_score ?? null,
          design: v.csat_design_score ?? null,
          deadlines: v.csat_deadlinae_score ?? null,
          results: v.csat_results_score ?? null,
          comment: cleanComment(v.csat_observations || v.nps_observations),
        });
      }
      NPSCSAT_METRIC_COLS.forEach((k) => { if (curSig[k]) prevSig[k] = curSig[k]; });

      const v = row.values || {};
      if (v.name) {
        const squad = Array.isArray(v.squad) ? (v.squad[0] || null) : (v.squad || null);
        projects[pid] = {
          id: pid, name: v.name, squad, coordinator: v.project_coordinator || null, status: 'active',
        };
      }
    });
  });

  return { projects: Object.values(projects), responses };
}

function transformNpsCsat(rows) {
  return extractNpsCsatResponses(rows);
}

module.exports = {
  transformDownsell, transformRenovacao, transformChurn, transformPrevisao, transformNpsCsat,
  extractNpsCsatResponses, cleanComment, MONTHS,
};
