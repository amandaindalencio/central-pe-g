import { NextResponse } from 'next/server';
import { getDoc } from '@/lib/store';

const KNOWN_SERVICES = ['downsell', 'renovacao', 'npscsat', 'churn', 'previsao'];

export async function GET(req, { params }) {
  const { service } = await params;
  if (!KNOWN_SERVICES.includes(service)) {
    return NextResponse.json({ error: 'unknown service: ' + service }, { status: 404 });
  }
  const [data, status] = await Promise.all([
    getDoc(`sync:data:${service}`),
    getDoc(`sync:status:${service}`),
  ]);
  return NextResponse.json({ data, status });
}
