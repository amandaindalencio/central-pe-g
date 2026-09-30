import { NextResponse } from 'next/server';
import { setDoc } from '@/lib/store';
import { fetchDownsells, fetchRenovacoes } from '@/lib/cockpit';
import { transformDownsell, transformRenovacao } from '@/lib/transforms';

const SERVICES = {
  downsell: { fetch: fetchDownsells, transform: transformDownsell, label: 'Downsell' },
  renovacao: { fetch: fetchRenovacoes, transform: transformRenovacao, label: 'Renovação' },
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
