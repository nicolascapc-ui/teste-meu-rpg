import { useState } from 'react';
import { signInWithGoogle } from '../lib/firebase';
import { STARTER_ASSETS } from '../lib/templates';

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
    <div className="min-h-screen vtt-canvas flex flex-col">
      <header className="w-full max-w-6xl mx-auto px-6 py-5 flex items-center justify-between gap-8 border-b vtt-border">
        <span className="text-lg font-bold font-typewriter tracking-tight whitespace-nowrap shrink-0">
          Folio
        </span>
        <nav className="hidden md:flex items-center gap-6 text-xs vtt-muted">
          <span className="whitespace-nowrap shrink-0">Cenas e Névoa</span>
          <span className="whitespace-nowrap shrink-0">Fichas Modulares + PDF</span>
          <span className="whitespace-nowrap shrink-0">Segunda Tela TV</span>
          <span className="whitespace-nowrap shrink-0">Celular via QR Code</span>
        </nav>
        <button
          type="button"
          onClick={handleLogin}
          disabled={loading}
          className="px-4 py-2 text-xs font-semibold vtt-accent-btn whitespace-nowrap shrink-0 disabled:opacity-60"
        >
          {loading ? 'Entrando...' : 'Entrar com Google'}
        </button>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-stretch">
        <section className="lg:col-span-6 flex flex-col justify-center space-y-6">
          <p className="text-xs vtt-muted">Virtual Tabletop · Presencial e Online</p>
          <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold font-typewriter leading-tight">
            Sua mesa de RPG limpa, rápida e sem atrito.
          </h1>
          <p className="text-sm sm:text-base vtt-muted leading-relaxed max-w-xl">
            {subtitle ||
              'Troque cenas completas com música e névoa em um clique, projete pistas na TV sem menus do mestre e deixe cada jogador rolar dados pela própria ficha modular ou PDF no celular.'}
          </p>

          <div className="pt-2 space-y-3">
            <button
              type="button"
              onClick={handleLogin}
              disabled={loading}
              className="px-6 py-3 text-sm font-semibold vtt-accent-btn transition-opacity disabled:opacity-60 whitespace-nowrap"
            >
              {loading ? 'Conectando conta Google...' : 'Entrar com conta Google'}
            </button>
            {error && <p className="text-xs text-red-700 dark:text-red-400">{error}</p>}
            <p className="text-xs vtt-muted">
              Suas campanhas, temas visuais, fichas e notas ficam salvos na nuvem.
            </p>
          </div>

          <div className="pt-6 border-t vtt-border grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div>
              <p className="font-semibold">Cenas</p>
              <p className="vtt-muted mt-0.5">Pré-carregadas</p>
            </div>
            <div>
              <p className="font-semibold">Segunda Tela</p>
              <p className="vtt-muted mt-0.5">Névoa 100% opaca</p>
            </div>
            <div>
              <p className="font-semibold">Fichas</p>
              <p className="vtt-muted mt-0.5">Blocos ou PDF</p>
            </div>
            <div>
              <p className="font-semibold">Áudio</p>
              <p className="vtt-muted mt-0.5">3 camadas ao vivo</p>
            </div>
          </div>
        </section>

        <section className="lg:col-span-6 flex">
          <div className="w-full vtt-surface border p-3 flex flex-col justify-between">
            <div className="relative flex-1 min-h-[300px] overflow-hidden bg-stone-900">
              <img
                src={STARTER_ASSETS.tavernScene}
                alt="Cena de taverna costeira ao entardecer no Folio VTT"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/85 via-black/45 to-transparent text-stone-100">
                <p className="text-xs opacity-80">Cena ativa · A Âncora Enferrujada</p>
                <p className="text-sm font-typewriter mt-0.5">
                  Fundo, névoa, tokens e ambiente trocam juntos com 1 clique.
                </p>
              </div>
            </div>
            <div className="pt-3 px-1 flex items-center justify-between text-xs vtt-muted">
              <span>Tema padrão · Papel e Tinta</span>
              <span>Customizável por campanha</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
