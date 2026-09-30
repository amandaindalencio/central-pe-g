'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.href = '/';
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Senha incorreta.');
      }
    } catch {
      setError('Falha ao conectar. Tente de novo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', background: '#FAFAF8' }}>
      <form onSubmit={submit} style={{ padding: 28, border: '1px solid #E7E5E4', borderRadius: 12, minWidth: 300, background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,.06)' }}>
        <h1 style={{ fontSize: 16, marginBottom: 4, color: '#1C1917' }}>Central WBR · PE&amp;G</h1>
        <p style={{ fontSize: 12, color: '#78716C', marginBottom: 16 }}>Acesso restrito — informe a senha.</p>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Senha"
          autoFocus
          style={{ width: '100%', padding: 10, marginBottom: 10, border: '1px solid #D6D3D1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
        />
        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', padding: 10, background: '#D6281A', color: '#fff', border: 'none', borderRadius: 8, cursor: loading ? 'default' : 'pointer', fontWeight: 700, fontSize: 13, opacity: loading ? 0.7 : 1 }}
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
        {error && <p style={{ color: '#B91C1C', fontSize: 12, marginTop: 10 }}>{error}</p>}
      </form>
    </div>
  );
}
