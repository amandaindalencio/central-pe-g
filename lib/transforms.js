// Ported from central-wbr-peg.html (transformDownsell/transformRenovacao) —
// same logic already validated against the Cockpit MCP tools this session
// (25 downsells / R$148.274,18; 21 renovações / R$130.078,86).
// Operates on {data: [...]} — the shape the MCP tools return; TODO confirm
// the raw Cockpit REST API returns the same shape once lib/cockpit.js is
// tested against real credentials.

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

module.exports = { transformDownsell, transformRenovacao, MONTHS };
