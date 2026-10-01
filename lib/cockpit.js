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

async function callCockpitTool(toolName, args) {
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

  try {
    await client.connect(transport);
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
  } finally {
    await client.close().catch(() => {});
  }
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

// TODO: startDate fixo em 2026-01-01 casa com o resto do dashboard (MONTHS
// hardcoded em 2026-01..09 no dashboard.html) — cockpit_query_history aceita
// no máximo 366 dias por chamada, então isso quebra sozinho a partir de
// 2027-01-02. Quando o dashboard passar a rolar pra 2027, revisar os dois
// juntos (aqui e o array MONTHS no dashboard).
async function fetchNpsCsatHistory() {
  const startDate = '2026-01-01';
  const endDate = new Date().toISOString().slice(0, 10);
  const baseParams = {
    columns: NPSCSAT_COLUMNS,
    startDate, endDate,
    granularity: 'weekly',
    includeMetricTimestamps: true,
    filterByStatus: 'active',
    filterByCategory: 'Executar',
    pageSize: 500,
  };

  const first = await callCockpitTool('cockpit_query_history', { ...baseParams, page: 1 });
  const pageCount = (first.meta && first.meta.pagination && first.meta.pagination.pageCount) || 1;

  const rows = [...(first.data || [])];
  if (pageCount > 1) {
    const rest = await Promise.all(
      Array.from({ length: pageCount - 1 }, (_, i) => i + 2).map((page) =>
        callCockpitTool('cockpit_query_history', { ...baseParams, page })
      )
    );
    rest.forEach((r) => rows.push(...(r.data || [])));
  }
  return rows;
}

module.exports = { fetchDownsells, fetchRenovacoes, fetchNpsCsatHistory, callCockpitTool };
