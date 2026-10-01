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

// IMPORTANT: Vercel's Fluid Compute was routing this function to iad1
// (Washington, D.C.) on some invocations — confirmed via function logs on a
// Help Flag timeout (61.5s, every one of ~9 parallel Cockpit calls paying a
// Brazil<->US round trip). Pinning to gru1 (São Paulo) keeps it next to the
// Cockpit MCP gateway (hosted in Brazil) instead of wherever Fluid picks.
export const preferredRegion = 'gru1';

const SERVICES = {
  downsell: { fetch: fetchDownsells, transform: transformDownsell, label: 'Downsell' },
  renovacao: { fetch: fetchRenovacoes, transform: transformRenovacao, label: 'Renovação' },
  npscsat: { fetch: fetchNpsCsatHistory, transform: transformNpsCsat, label: 'NPS & CSAT' },
  churn: { fetch: fetchChurnedProjects, transform: transformChurn, label: 'Revenue Churn' },
  previsao: { fetch: fetchPrevisaoData, transform: transformPrevisao, label: 'Previsão' },
  helpflag: { fetch: fetchHelpFlagHistory, transform: transformHelpFlag, label: 'Help Flag' },
};

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
    const message = String((e && e.message) || e);
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
