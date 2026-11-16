// Pedido 16/11: coluna "Produto" na Renovação, pra deixar claro o que cada renovação é. Confirmado
// ao vivo que o campo `product` do Cockpit vem em formatos diferentes (slug técnico antigo vs. texto
// já legível separado por vírgula em cadastros recentes) — productLabel() precisa lidar com os dois.
const assert = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + label); if (!cond) process.exitCode = 1; };
const { transformRenovacao } = require('../lib/transforms');

function proj(name, product) {
  return { name, squad: [{ name: 'Invictus' }], projectTeam: [], effectiveBookingMonths: 6, fee: 5000, renewalDateIso: '2026-12-01T00:00:00.000Z', daysUntilRenewal: 10, product };
}

(function () {
  const payload = { data: [
    proj('CLIENTE SDR', 'sdr_ai'),
    proj('CLIENTE ASSESSORIA', 'assessoria_byline'),
    proj('CLIENTE JA LEGIVEL', 'Profissional de Social Media, Profissional de Designer Gráfico'),
    proj('CLIENTE SLUG DESCONHECIDO', 'novo_produto_futuro'),
    proj('CLIENTE SEM PRODUTO', null),
  ] };
  const items = transformRenovacao(payload);
  const byName = {};
  items.forEach((r) => { byName[r.name] = r.product; });

  assert(byName['CLIENTE SDR'] === 'SDR com IA', '[renovacao-product] slug conhecido "sdr_ai" vira rótulo legível');
  assert(byName['CLIENTE ASSESSORIA'] === 'Assessoria Byline', '[renovacao-product] slug conhecido "assessoria_byline" vira rótulo legível');
  assert(byName['CLIENTE JA LEGIVEL'] === 'Profissional de Social Media, Profissional de Designer Gráfico', '[renovacao-product] texto já legível (sem "_") passa direto, sem alteração');
  assert(byName['CLIENTE SLUG DESCONHECIDO'] === 'Novo Produto Futuro', '[renovacao-product] slug desconhecido vira fallback mecânico (underscore→espaço, capitaliza) em vez de travar ou mostrar o código cru');
  assert(byName['CLIENTE SEM PRODUTO'] === 'Não informado', '[renovacao-product] sem produto cadastrado mostra "Não informado", não undefined/null/vazio');
})();

console.log('--- done ---');
