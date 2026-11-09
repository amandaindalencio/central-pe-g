// Cockpit client — talks MCP (same protocol/tools already validated all
// session via Claude Code), not a raw REST API. The "cockpit" MCP server is
// a real HTTP address (found in this session's own MCP config), so the
// backend can call it directly with the same tool names/params already
// proven to match the dashboard's current numbers:
//   downsells:  25 lançamentos, R$148.274,18 (year=2026, category=Executar)
//   renovações: 21 clientes,   R$130.078,86 (year=2026, category=Executar)
//
// Required env vars (see .env.local.example) — copied by hand from this
// session's own MCP config (mcpServers.cockpit in .claude.json), never
// generated or stored by the agent itself:
//   COCKPIT_MCP_URL            e.g. https://mcp-cockpit.dados.collieassociados.com/mcp
//   COCKPIT_MCP_AUTHORIZATION  the exact "Authorization" header value (includes "Bearer " if present)
//   COCKPIT_MCP_GATEWAY_KEY    the exact "x-mcp-gateway" header value

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

// IMPORTANT: one MCP connection (handshake) is reused for every tool call
// made within a single request — opening a fresh connection per call (the
// original version of this file) was the root cause of 504 timeouts on
// Help Flag/Previsão: paginated fetches issue a dozen-plus tool calls, and
// paying a full connect/close cycle for each one blew past the 60s ceiling.
async function withCockpitClient(fn) {
  const url = process.env.COCKPIT_MCP_URL;
  const auth = process.env.COCKPIT_MCP_AUTHORIZATION;
  const gatewayKey = process.env.COCKPIT_MCP_GATEWAY_KEY;

  if (!url || !auth || !gatewayKey) {
    throw new Error('COCKPIT_MCP_URL / COCKPIT_MCP_AUTHORIZATION / COCKPIT_MCP_GATEWAY_KEY não configurados (ver .env.local.example)');
  }

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: {
      headers: {
        Authorization: auth,
        'x-mcp-gateway': gatewayKey,
      },
    },
  });
  const client = new Client({ name: 'central-pe-g', version: '1.0.0' });

  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

// Chama fn(item) pra cada item da lista, UM DE CADA VEZ (não Promise.all) — orientação direta do time
// de tech do Flow em 09/11, depois de detectarem sobrecarga no Cockpit/Flow causada por volume de
// chamadas simultâneas: "Uma consulta de cada vez. Se o agente estiver disparando várias chamadas ao
// mesmo tempo, peça para ele fazer em sequência." Usado em todo fetch que antes paginava ou buscava
// várias janelas de data em paralelo (NPS/CSAT, Help Flag, Previsão) — mais lento por chamada, mas sem
// o pico de chamadas simultâneas que estava derrubando a performance do Flow pra todo mundo.
async function sequentially(items, fn) {
  const results = [];
  for (const item of items) { results.push(await fn(item)); }
  return results;
}

async function callOnClient(client, toolName, args) {
  const result = await client.callTool({ name: toolName, arguments: args || {} });
  if (result.isError) {
    const text = (result.content || []).map((c) => c.text || '').join(' ');
    throw new Error(`Cockpit MCP (${toolName}) retornou erro: ${text || 'sem detalhe'}`);
  }
  if (result.structuredContent) return result.structuredContent;
  const textBlock = (result.content || []).find((c) => c.type === 'text');
  if (textBlock) {
    try { return JSON.parse(textBlock.text); } catch { return textBlock.text; }
  }
  return result;
}

// Convenience for a single, standalone call (Downsell/Renovação/Churn —
// each needs just one tool call, so a dedicated connection per call is fine).
async function callCockpitTool(toolName, args) {
  return withCockpitClient((client) => callOnClient(client, toolName, args));
}

async function fetchDownsells({ year = 2026, globalCategory = 'Executar' } = {}) {
  return callCockpitTool('cockpit_entradas_saidas_downsells_query', {
    filterBy: 'year', year, globalCategory, pageSize: 250, includeSummary: true,
  });
}

async function fetchRenovacoes({ year = 2026, globalCategory = 'Executar' } = {}) {
  return callCockpitTool('cockpit_entradas_saidas_renovacoes_query', {
    filterBy: 'year', year, globalCategory, pageSize: 250, includeSummary: true,
  });
}

const NPSCSAT_COLUMNS = [
  'csat_nps_value', 'csat_v4_score', 'csat_service_score', 'csat_campaigns_score',
  'csat_copy_score', 'csat_design_score', 'csat_deadlinae_score', 'csat_results_score',
  'csat_observations', 'nps_observations', 'name', 'squad', 'project_coordinator',
];

// Fetches every page of a cockpit_query_history query over ONE shared MCP
// connection (see withCockpitClient above).
// TODO: startDate fixo em 2026-01-01 casa com o resto do dashboard (MONTHS
// hardcoded em 2026-01..09 no dashboard.html) — cockpit_query_history aceita
// no máximo 366 dias por chamada, então isso quebra sozinho a partir de
// 2027-01-02. Quando o dashboard passar a rolar pra 2027, revisar os dois
// juntos (aqui e o array MONTHS no dashboard).
async function fetchHistoryAllPages(baseParams) {
  return withCockpitClient(async (client) => {
    const first = await callOnClient(client, 'cockpit_query_history', { ...baseParams, page: 1 });
    const pageCount = (first.meta && first.meta.pagination && first.meta.pagination.pageCount) || 1;

    const rows = [...(first.data || [])];
    if (pageCount > 1) {
      const pageNums = Array.from({ length: pageCount - 1 }, (_, i) => i + 2);
      const rest = await sequentially(pageNums, (page) =>
        callOnClient(client, 'cockpit_query_history', { ...baseParams, page })
      );
      rest.forEach((r) => rows.push(...(r.data || [])));
    }
    return rows;
  });
}

async function fetchNpsCsatHistory() {
  const startDate = '2026-01-01';
  const endDate = new Date().toISOString().slice(0, 10);
  return fetchHistoryAllPages({
    columns: NPSCSAT_COLUMNS,
    startDate, endDate,
    granularity: 'weekly',
    includeMetricTimestamps: true,
    filterByStatus: 'active',
    filterByCategory: 'Executar',
    pageSize: 500,
  });
}

// Help Flag: Health Score semanal (LOCF) de TODA a carteira ativa hoje — sem
// filtro de categoria (ao contrário de NPS/CSAT). Um filtro Executar-only
// aqui foi o bug que subcontava o risco nesta sessão (ver memória/rodapé:
// "cada mês usa a pontuação que o cliente tinha registrada naquele momento,
// mas só entram clientes ativos hoje").
//
// transformHelpFlag só usa, de cada mês, a última semana (LOCF) — então em
// vez de puxar o ano inteiro semana a semana (29 páginas, 14k linhas), pedimos
// direto uma janela de 7 dias terminando no fim de cada mês (garante
// exatamente 1 sábado — a carteira ativa tem ~390 clientes, menos que o
// pageSize — então vira 1 chamada pequena por mês).
//
// CORREÇÃO 09/11: as chamadas (meses + semanas) eram feitas em paralelo —
// até 23 chamadas simultâneas numa única sincronização. O time de tech do
// Flow identificou essa central entre as maiores origens de carga no
// Cockpit/Flow num pico de sobrecarga da plataforma, com instrução direta de
// "uma consulta de cada vez". Trocado pra sequencial (sequentially(), acima)
// — mais lento por sync (a soma dos tempos, não o máximo), mas sem o pico de
// concorrência. Se isso não couber mais nos 60s da Vercel em carteiras
// maiores, a resposta certa é reduzir o pedido (menos meses/semanas), não
// voltar a paralelizar.
async function fetchOneWeekSnapshot(client, columns, endDate) {
  const startDate = new Date(new Date(endDate + 'T00:00:00Z').getTime() - 6 * 86400000).toISOString().slice(0, 10);
  const params = { columns, startDate, endDate, granularity: 'weekly', filterByStatus: 'active', pageSize: 500 };
  const first = await callOnClient(client, 'cockpit_query_history', { ...params, page: 1 });
  const pageCount = (first.meta && first.meta.pagination && first.meta.pagination.pageCount) || 1;
  const rows = [...(first.data || [])];
  if (pageCount > 1) {
    const pageNums = Array.from({ length: pageCount - 1 }, (_, i) => i + 2);
    const rest = await sequentially(pageNums, (page) => callOnClient(client, 'cockpit_query_history', { ...params, page }));
    rest.forEach((r) => rows.push(...(r.data || [])));
  }
  return rows;
}

function mostRecentSaturday(iso) {
  const d = new Date(iso + 'T00:00:00Z');
  const diff = (d.getUTCDay() - 6 + 7) % 7; // dias desde o último sábado (0 se hoje já é sábado)
  return new Date(d.getTime() - diff * 86400000).toISOString().slice(0, 10);
}

// Busca os snapshots de fim-de-mês (pro roster mensal, RAW.helpFlagByMonth) e os últimos 12 sábados
// (pro heatmap "Efetividade por coordenação", RAW.hfWeeklyTrend) — tudo em sequência, uma chamada de
// cada vez (ver nota de sequentially() e do fetchOneWeekSnapshot acima — orientação de 09/11 do time
// de tech do Flow).
async function fetchHelpFlagHistory() {
  const monthlyColumns = ['algorithm_health_avg_score', 'name', 'squad', 'project_coordinator', 'account_manager'];
  const weeklyColumns = ['algorithm_health_avg_score', 'project_coordinator'];
  const today = new Date().toISOString().slice(0, 10);
  const months = ['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12']
    .filter((m) => m <= today.slice(0, 7));

  const lastSaturday = mostRecentSaturday(today);
  const weekEndDates = Array.from({ length: 12 }, (_, i) =>
    new Date(new Date(lastSaturday + 'T00:00:00Z').getTime() - (11 - i) * 7 * 86400000).toISOString().slice(0, 10)
  );

  return withCockpitClient(async (client) => {
    const perMonth = await sequentially(months, (m) => {
      const [y, mo] = m.split('-').map(Number);
      const lastDayOfMonth = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
      const endDate = lastDayOfMonth < today ? lastDayOfMonth : today;
      return fetchOneWeekSnapshot(client, monthlyColumns, endDate);
    });
    const perWeek = await sequentially(weekEndDates, (endDate) => fetchOneWeekSnapshot(client, weeklyColumns, endDate));

    const monthlyRows = [];
    perMonth.forEach((r) => monthlyRows.push(...r));

    return { monthlyRows, weeklyRows: perWeek, weekEndDates };
  });
}

// CORREÇÃO 03/11: trocado de volta pro cockpit_entradas_saidas_saidas_query (tool dedicada, ver
// paridade com a aba Saídas) — a versão anterior usava cockpit_query_table com
// filterByStatus:'all'+applyColumnFiltersOnClient por causa de um bug conhecido do
// excludeChurnM0 (default true) que derrubava o total sem aviso (ver memória
// reference_cockpit_saidas_query_bug). Só que isso trazia TODO projeto Executar (ativo + churned +
// qualquer status) com o healthScoreTable completo (162 colunas!) em cada linha — ~9,4KB/linha,
// ~5,8MB no total — e estourava os 60s da função na Vercel (504 reportado 03/11 nas 5 áreas).
// Confirmado ao vivo (03/11): o bug do excludeChurnM0 tem, sim, um parâmetro pra desligar — passando
// excludeChurnM0:false direto nesta tool dedicada, ela já filtra churned=true no próprio Strapi (sem
// precisar do workaround "pega tudo e filtra depois"), devolve 202 registros Jan-Dez/2026 (bate com
// os R$1.455.378,18 do próprio meta.summary) e cada linha tem ~4,3KB (sem healthScoreTable) — menos
// da metade do tamanho por linha, e sem a sobra de centenas de projetos ativos que não interessam
// aqui. Resultado: ~1,8MB no total em vez de ~5,8MB.
async function fetchChurnedProjects({ year = new Date().getFullYear(), globalCategory = 'Executar' } = {}) {
  return callCockpitTool('cockpit_entradas_saidas_saidas_query', {
    filterBy: 'year', year, globalCategory,
    excludeChurnM0: false,
    pageSize: 250,
    includeSummary: false,
  });
}

// Previsão de Churn combina 2 fontes reais (sem inventar mês/data como a
// base antiga fazia):
//  (a) todos os projetos ativos Executar, de onde filtramos quem tem
//      churnRequestDate preenchido (aviso prévio formal) — mesmo campo já
//      usado pela tabela de recuperação. Confirmado ao vivo: 6 clientes,
//      R$41.116 — idêntico ao valor já publicado.
//  (b) cockpit_entradas_saidas_previsao_query, filtrando customerCareStatus
//      "Antecipação" (85 registros) pro "risco antecipado, sem aviso formal".
// CORREÇÃO 09/11: as 2 chamadas eram feitas em paralelo (Promise.all) — trocado pra sequencial, mesma
// orientação do time de tech do Flow aplicada em todo o arquivo (ver nota em fetchOneWeekSnapshot).
async function fetchPrevisaoData() {
  return withCockpitClient(async (client) => {
    // ~230 projetos ativos Executar cabem numa página só (pageSize 250) —
    // fetchAllPages:true forçava a tool a paginar internamente e isso
    // estava estourando os 60s da Vercel; sem essa flag, 1 chamada só.
    const activeProjects = await callOnClient(client, 'cockpit_query_table', {
      filterByStatus: 'active',
      filterByCategory: 'Executar',
      pageSize: 250,
    });
    const previsao = await callOnClient(client, 'cockpit_entradas_saidas_previsao_query', {
      globalCategory: 'Executar',
      applyColumnFiltersOnClient: true,
      pageSize: 250,
      includeSummary: false,
    });
    return { activeProjects, previsao };
  });
}

module.exports = {
  fetchDownsells, fetchRenovacoes, fetchNpsCsatHistory, fetchChurnedProjects,
  fetchPrevisaoData, fetchHelpFlagHistory, callCockpitTool,
};
