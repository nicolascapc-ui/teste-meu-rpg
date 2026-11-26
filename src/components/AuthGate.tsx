import { useState } from 'react';
import { BookOpen, Dices, Eye, Layers, Smartphone, Tv, Volume2 } from 'lucide-react';
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

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-12 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
        <section className="lg:col-span-7 flex flex-col justify-center space-y-6">
          <p className="text-xs vtt-muted">Virtual Tabletop · Presencial e Online</p>
          <h1 className="text-3xl sm:text-4xl lg:text-[2.75rem] font-bold font-typewriter leading-tight">
            Sua mesa de RPG limpa, rápida e sem atrito.
          </h1>
          <p className="text-sm sm:text-base vtt-muted leading-relaxed max-w-xl">
            {subtitle ||
              'Troque cenas completas com música, névoa e muros de visão em um clique, projete pistas na TV sem menus do mestre e deixe cada jogador rolar dados pela própria ficha modular ou PDF no celular.'}
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
              Suas campanhas, temas visuais, fichas, áudios e notas ficam salvos na nuvem.
            </p>
          </div>
        </section>

        {/* Pure Typographic "Papel e Tinta" Dossier Summary (Zero AI imagery) */}
        <section className="lg:col-span-5">
          <div className="vtt-surface border vtt-border p-6 space-y-5">
            <div className="flex items-center justify-between border-b vtt-border pb-3">
              <div>
                <p className="text-[11px] uppercase tracking-widest vtt-muted">Dossiê da Mesa</p>
                <p className="text-base font-bold font-typewriter mt-0.5">
                  Tudo o que você controla ao vivo
                </p>
              </div>
              <span className="text-[11px] font-mono vtt-muted">v1 · Folio</span>
            </div>

            <ul className="space-y-3.5 text-xs">
              <li className="flex items-start gap-3">
                <Layers className="w-4 h-4 vtt-accent-text shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Cenas, Vídeos, Névoa e Muros de Visão</p>
                  <p className="vtt-muted mt-0.5 leading-relaxed">
                    Alterne mapas táticos, fundos animados, névoa de guerra e linha de visão dinâmica com portas.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Tv className="w-4 h-4 vtt-accent-text shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Segunda Tela limpa para TV ou monitor</p>
                  <p className="vtt-muted mt-0.5 leading-relaxed">
                    Janela sem barras do mestre, névoa 100% opaca, efeitos visuais sincronizados e handouts em tela cheia.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Smartphone className="w-4 h-4 vtt-accent-text shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Fichas Livres + Leitor Automático de PDF</p>
                  <p className="vtt-muted mt-0.5 leading-relaxed">
                    Qualquer sistema de RPG: importe um PDF para gerar blocos e rolagens ou monte do zero no celular.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Dices className="w-4 h-4 vtt-accent-text shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Rolador Universal + Chat Público e Oculto</p>
                  <p className="vtt-muted mt-0.5 leading-relaxed">
                    Dados explosivos, vantagem, pools de sucesso e rolagens secretas exclusivas do mestre.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <Volume2 className="w-4 h-4 vtt-accent-text shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">Mixer de 3 Camadas + Wiki da Campanha</p>
                  <p className="vtt-muted mt-0.5 leading-relaxed">
                    Música, ambiente e SFX com pitch/abafamento e pastas organizadas com segredos isolados.
                  </p>
                </div>
              </li>
            </ul>

            <div className="pt-3 border-t vtt-border flex items-center justify-between text-[11px] vtt-muted">
              <span className="flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5" />
                Tema Papel e Tinta
              </span>
              <span className="flex items-center gap-1.5">
                <BookOpen className="w-3.5 h-3.5" />
                Customizável por campanha
              </span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
