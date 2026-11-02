import { NextResponse } from 'next/server';
import { setDoc } from '@/lib/store';
import {
  fetchDownsells, fetchRenovacoes, fetchNpsCsatHistory, fetchChurnedProjects,
  fetchPrevisaoData, fetchHelpFlagHistory,
} from '@/lib/cockpit';
import {
  transformDownsell, transformRenovacao, transformNpsCsat, transformChurn,
  transformPrevisao, transformHelpFlag,
} from '@/lib/transforms';

// NPS/CSAT and Help Flag fetch ~9-18 calls to the Cockpit MCP gateway in
// parallel — needs more than the default timeout. 60s is the max Vercel
// allows on Hobby.
export const maxDuration = 60;

// Tried pinning preferredRegion='gru1' (São Paulo) after a function log
// showed one Help Flag timeout running in iad1 (Washington, D.C.) — made
// things WORSE (previously-working Churn/NPS&CSAT started 504ing too), so
// reverted. gru1 may not be reliably available on this Vercel plan/Fluid
// Compute setup; not touching region again without clearer evidence.

const SERVICES = {
  downsell: { fetch: fetchDownsells, transform: transformDownsell, label: 'Downsell' },
  renovacao: { fetch: fetchRenovacoes, transform: transformRenovacao, label: 'Renovação' },
  npscsat: { fetch: fetchNpsCsatHistory, transform: transformNpsCsat, label: 'NPS & CSAT' },
  churn: { fetch: fetchChurnedProjects, transform: transformChurn, label: 'Revenue Churn' },
  previsao: { fetch: fetchPrevisaoData, transform: transformPrevisao, label: 'Previsão' },
  helpflag: { fetch: fetchHelpFlagHistory, transform: transformHelpFlag, label: 'Help Flag' },
};

// Timeout do protocolo MCP (código -32001) usa o mesmo teto de 60s da própria função da Vercel (ver
// nota de maxDuration acima) — uma chamada que fica bem na borda desse limite falha de forma
// intermitente, sem relação com o dado em si. Reportado 02/11 (Renovação: "MCP error -32001: Request
// timed out"). Não há mais orçamento de tempo pra esperar DENTRO desta mesma invocação (os dois tetos
// já são o máximo possível), então o único jeito real de dar uma segunda chance é chamar fetch() de
// novo — mas isso certamente estoura os 60s totais da função. Por isso o retry físico mora só no
// botão "Sincronizar" do dashboard (cada clique é uma invocação nova, com orçamento de 60s do zero);
// aqui, no cron, só deixamos a mensagem de erro clara o bastante pra reconhecer esse caso específico
// quando alguém olhar o status — o próprio cron do dia seguinte já é, na prática, o retry.
function isTimeoutError(e) {
  const msg = String((e && e.message) || e || '');
  return /timed out|-32001/i.test(msg);
}

async function runService(service) {
  const svc = SERVICES[service];
  if (!svc) return { status: 404, body: { error: 'unknown service: ' + service } };

  await setDoc(`sync:status:${service}`, { status: 'running', updatedAt: Date.now(), error: null });

  try {
    const raw = await svc.fetch();
    const payload = svc.transform(raw);
    const now = Date.now();
    await setDoc(`sync:data:${service}`, { payload, updatedAt: now });
    await setDoc(`sync:status:${service}`, { status: 'ok', updatedAt: now, error: null });
    return { status: 200, body: { ok: true, updatedAt: now } };
  } catch (e) {
    const now = Date.now();
    const rawMessage = String((e && e.message) || e);
    const message = isTimeoutError(e)
      ? `${rawMessage} — timeout intermitente no gateway MCP (não é problema com o dado em si). Tente sincronizar de novo pelo botão (cada clique já tenta 2x sozinho); se veio do cron automático, o próximo cron já tenta de novo.`
      : rawMessage;
    await setDoc(`sync:status:${service}`, { status: 'error', updatedAt: now, error: { message } });
    return { status: 500, body: { ok: false, error: message } };
  }
}

// Vercel Cron Jobs issue a GET request to the configured path (see vercel.json).
export async function GET(req, { params }) {
  const { service } = await params;
  const result = await runService(service);
  return NextResponse.json(result.body, { status: result.status });
}

// The dashboard's "Sincronizar" button calls this (fetch(..., {method:'POST'})).
export async function POST(req, { params }) {
  const { service } = await params;
  const result = await runService(service);
  return NextResponse.json(result.body, { status: result.status });
}
