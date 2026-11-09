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

// NPS/CSAT and Help Flag fetch ~18-23 calls to the Cockpit MCP gateway. Since
// 09/11 these run in sequence, not parallel (tech team at Flow asked for
// "uma consulta de cada vez" after detecting overload — ver lib/cockpit.js),
// so each call's time adds up instead of being capped by the slowest one.
// 60s is still the max Vercel allows on Hobby; if a sync routinely times out
// now, the fix is to reduce how much it asks for, not to re-parallelize.
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

// Timeout do protocolo MCP (código -32001) ou HTTP 50x da própria Vercel. Até 09/11 isso disparava um
// retry automático pelo botão "Sincronizar" — removido por orientação direta do time de tech do Flow
// depois de detectarem sobrecarga no Cockpit/Flow causada por volume de chamadas, com instrução
// explícita de "se der timeout ou erro 504, não peça para o agente tentar de novo, reduza o pedido".
// Retentar automaticamente ia na contramão disso (mais carga, não menos), então a mensagem agora
// orienta pra esperar em vez de clicar de novo.
function isTimeoutError(e) {
  const msg = String((e && e.message) || e || '');
  return /timed out|-32001|HTTP 50\d/i.test(msg);
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
      ? `${rawMessage} — timeout no gateway MCP, provavelmente por sobrecarga no Flow/Cockpit. Não clique em sincronizar de novo agora (isso só aumenta a carga); o próximo cron automático tenta sozinho mais tarde.`
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
