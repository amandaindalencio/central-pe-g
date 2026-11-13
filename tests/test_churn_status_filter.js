// Reportado 13/11 (caso BUBLU): um projeto reclassificado pra "finished" (desfecho diferente de
// churn — conclusão normal, não cancelamento) continuava aparecendo no Revenue Churn porque
// churnDate/churnReason ficaram com o valor antigo de quando era "churned". transformChurn agora
// só inclui statuses 'churned' ou 'active' (o 2º caso é a Data de Churn agendada ainda em projeto
// ativo, aviso prévio em andamento — fix de 03/11 — independente da data já ter passado ou não).
const assert = (cond, label) => { console.log((cond ? 'PASS' : 'FAIL') + ' - ' + label); if (!cond) process.exitCode = 1; };
const { transformChurn } = require('../lib/transforms');

function row(name, statuses, churnDate, fee) {
  return { name, documentId: name, lt: 5, projectTeam: [], squad: [{ name: 'Invictus' }], churnReason: 'interno_cliente', churnDetail: 'interno_cliente', fee, churnDate, statuses };
}

(function () {
  const payload = {
    data: [
      row('BUBLU', 'finished', '2026-11-02T03:00:00.000Z', 6455), // caso real reportado — deve sumir
      row('CLIENTE CHURNED DE VERDADE', 'churned', '2026-11-03T03:00:00.000Z', 5000), // deve continuar
      row('CLIENTE AGENDADO AINDA ATIVO', 'active', '2026-11-20T03:00:00.000Z', 3000), // futuro — deve continuar (fix 03/11)
      row('CLIENTE AGENDADO DATA JA PASSOU', 'active', '2026-10-01T03:00:00.000Z', 2000), // passado mas status ainda active — deve continuar (não é o bug do BUBLU, é lag de atualização no Flow)
      row('CLIENTE PAUSADO OU OUTRO STATUS', 'paused', '2026-09-01T03:00:00.000Z', 1000), // status desconhecido/não-churn — deve sumir
    ],
  };
  const byMonth = transformChurn(payload);
  const all = Object.values(byMonth).flat();
  const names = all.map((r) => r.name);

  assert(!names.includes('BUBLU'), '[churn-status-filter] BUBLU (finished, churnDate antigo) não aparece mais no Revenue Churn');
  assert(names.includes('CLIENTE CHURNED DE VERDADE'), '[churn-status-filter] projeto realmente churned continua aparecendo');
  assert(names.includes('CLIENTE AGENDADO AINDA ATIVO'), '[churn-status-filter] projeto ativo com Data de Churn futura continua aparecendo (fix 03/11 preservado)');
  assert(names.includes('CLIENTE AGENDADO DATA JA PASSOU'), '[churn-status-filter] projeto ativo com Data de Churn já passada (Flow ainda não atualizou o status) continua aparecendo — não é tratado como o bug do BUBLU');
  assert(!names.includes('CLIENTE PAUSADO OU OUTRO STATUS'), '[churn-status-filter] status desconhecido/não-churn (nem churned nem active) não aparece');
  assert(all.length === 3, '[churn-status-filter] exatamente 3 dos 5 projetos de teste passam no filtro');
})();

console.log('--- done ---');
