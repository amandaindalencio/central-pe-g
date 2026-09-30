// Cockpit REST client.
//
// TODO(bloqueio real): esta sessão só conhece o Cockpit através das tools
// MCP (cockpit_entradas_saidas_downsells_query, cockpit_entradas_saidas_renovacoes_query),
// nunca chamou a API REST diretamente. Os paths/params abaixo são um palpite
// baseado na descrição das tools ("Paridade com /entradas-saidas?aba=downsells-fee",
// "Paridade com /entradas-saidas?aba=renovacoes") — PRECISAM ser confirmados/
// corrigidos com uma chamada real assim que COCKPIT_API_BASE_URL e
// COCKPIT_API_TOKEN estiverem configurados (.env.local), comparando o
// resultado com os totais já validados nesta sessão via MCP:
//   downsells: 25 lançamentos, R$148.274,18 (year=2026, category=Executar)
//   renovações: 21 clientes, R$130.078,86 (year=2026, category=Executar)

const BASE_URL = process.env.COCKPIT_API_BASE_URL;
const TOKEN = process.env.COCKPIT_API_TOKEN;

async function cockpitFetch(path, params) {
  if (!BASE_URL || !TOKEN) {
    throw new Error('COCKPIT_API_BASE_URL / COCKPIT_API_TOKEN não configurados (ver .env.local.example)');
  }
  const url = new URL(path, BASE_URL);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v != null) url.searchParams.set(k, String(v));
  });
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Cockpit API ${res.status} em ${path}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchDownsells({ year = 2026, category = 'Executar' } = {}) {
  // TODO: confirmar path/params reais.
  return cockpitFetch('/entradas-saidas/downsells', { year, category });
}

async function fetchRenovacoes({ year = 2026, category = 'Executar' } = {}) {
  // TODO: confirmar path/params reais.
  return cockpitFetch('/entradas-saidas/renovacoes', { year, category });
}

module.exports = { fetchDownsells, fetchRenovacoes };
