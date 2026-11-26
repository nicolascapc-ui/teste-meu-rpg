import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { signInWithGoogle } from '../lib/firebase';

interface AuthGateProps {
  subtitle?: string;
}

export function AuthGate({ subtitle }: AuthGateProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleLogin() {
    setLoading(true);
    setError('');
    try {
      await signInWithGoogle();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Não foi possível concluir o login.';
      setError(msg.includes('popup-closed') ? 'Janela de login fechada antes da conclusão.' : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen vtt-canvas flex flex-col justify-between">
      {/* Minimal Top Bar */}
      <header className="w-full max-w-5xl mx-auto px-6 py-6 flex items-center justify-between gap-8">
        <span className="text-sm font-bold font-typewriter tracking-widest uppercase whitespace-nowrap shrink-0">
          Folio
        </span>
        <nav className="hidden sm:flex items-center gap-6 text-xs vtt-muted">
          <span className="whitespace-nowrap shrink-0">Tabletop</span>
          <span className="whitespace-nowrap shrink-0">Fichas Universais</span>
          <span className="whitespace-nowrap shrink-0">Segunda Tela</span>
        </nav>
        <button
          type="button"
          onClick={handleLogin}
          disabled={loading}
          className="px-4 py-2 text-xs font-semibold border vtt-border vtt-surface hover:vtt-subtle transition-colors whitespace-nowrap shrink-0 disabled:opacity-60"
        >
          {loading ? 'Entrando...' : 'Entrar'}
        </button>
      </header>

      {/* Dominant Focal Anchor — Pure Typographic Hierarchy */}
      <main className="w-full max-w-5xl mx-auto px-6 py-16 flex flex-col items-start justify-center">
        <p className="text-xs font-mono uppercase tracking-[0.22em] vtt-muted mb-4">
          Virtual Tabletop
        </p>

        <h1
          className="font-bold font-typewriter tracking-tight leading-[0.95] text-stone-900 dark:text-stone-100"
          style={{ fontSize: 'clamp(4rem, 11vw, 8.25rem)' }}
        >
          FOLIO
        </h1>

        {subtitle ? (
          <p className="mt-4 text-sm sm:text-base vtt-muted max-w-md">{subtitle}</p>
        ) : null}

        <div className="mt-10 flex flex-col sm:flex-row sm:items-center gap-4">
          <button
            type="button"
            onClick={handleLogin}
            disabled={loading}
            className="px-7 py-3.5 text-sm font-semibold vtt-accent-btn flex items-center gap-3 transition-opacity disabled:opacity-60 whitespace-nowrap"
          >
            <span>{loading ? 'Conectando...' : 'Abrir Mesa com Google'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>

        {error && <p className="mt-3 text-xs text-red-700 dark:text-red-400">{error}</p>}
      </main>

      {/* Quiet Editorial Footer */}
      <footer className="w-full max-w-5xl mx-auto px-6 py-6 border-t vtt-border flex items-center justify-between text-xs vtt-muted">
        <span>Folio VTT</span>
        <span>Presencial · Online · Segunda Tela</span>
      </footer>
    </div>
  );
}
