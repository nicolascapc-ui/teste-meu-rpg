import { useState } from 'react';
import type { User } from 'firebase/auth';
import { LogOut, Plus, Trash2, ArrowRight, KeyRound } from 'lucide-react';
import type { Campaign, CampaignTheme, UserMembership } from '../types/vtt';
import { THEME_PRESETS, DEFAULT_THEME } from '../lib/themes';
import { createCampaignWithStarterKit, deleteCampaign, joinCampaignByRoomCode } from '../lib/vttService';
import { logOut } from '../lib/firebase';

interface CampaignLobbyProps {
  user: User;
  campaigns: Campaign[];
  memberships: UserMembership[];
  loading: boolean;
  onOpenCampaign: (campaignId: string) => void;
  onOpenPlayerRoom: (campaignId: string) => void;
}

export function CampaignLobby({
  user,
  campaigns,
  memberships,
  loading,
  onOpenCampaign,
  onOpenPlayerRoom,
}: CampaignLobbyProps) {
  const [creating, setCreating] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState('');
  const [system, setSystem] = useState('Sistema Livre');
  const [description, setDescription] = useState('');
  const [selectedTheme, setSelectedTheme] = useState<CampaignTheme>(DEFAULT_THEME);
  const [withStarter, setWithStarter] = useState(true);

  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [lobbyError, setLobbyError] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function handleCreateCampaign(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || creating) return;
    setCreating(true);
    setLobbyError('');
    try {
      const id = await createCampaignWithStarterKit({
        gmUid: user.uid,
        gmName: user.displayName || 'Mestre',
        title: title.trim(),
        system: system.trim() || 'Sistema Livre',
        description: description.trim(),
        theme: selectedTheme,
        withStarterContent: withStarter,
      });
      setShowCreateModal(false);
      setTitle('');
      setDescription('');
      onOpenCampaign(id);
    } catch {
      setLobbyError('Não foi possível criar a campanha. Tente novamente em instantes.');
    } finally {
      setCreating(false);
    }
  }

  async function handleQuickDemo() {
    if (creating) return;
    setCreating(true);
    setLobbyError('');
    try {
      const id = await createCampaignWithStarterKit({
        gmUid: user.uid,
        gmName: user.displayName || 'Mestre',
        title: 'Crônicas do Farol Cinzento',
        system: 'Sistema Livre',
        description: 'Mesa inicial com 3 cenas ilustradas, handouts pop-up e wiki organizada em pastas.',
        theme: DEFAULT_THEME,
        withStarterContent: true,
      });
      onOpenCampaign(id);
    } catch {
      setLobbyError('Não foi possível criar a mesa de demonstração. Tente novamente.');
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinRoom(e: React.FormEvent) {
    e.preventDefault();
    const clean = joinCode.trim().toUpperCase();
    if (clean.length !== 6) {
      setJoinError('Digite os 6 caracteres do código da sala.');
      return;
    }
    setJoining(true);
    setJoinError('');
    try {
      const info = await joinCampaignByRoomCode({
        roomCode: clean,
        uid: user.uid,
        displayName: user.displayName || 'Jogador',
      });
      setJoinCode('');
      onOpenPlayerRoom(info.campaignId);
    } catch (err) {
      setJoinError(err instanceof Error ? err.message : 'Erro ao entrar na sala.');
    } finally {
      setJoining(false);
    }
  }

  async function handleDelete(camp: Campaign) {
    setLobbyError('');
    try {
      await deleteCampaign(camp.id, camp.roomCode);
      setConfirmDeleteId(null);
    } catch {
      setLobbyError('Não foi possível excluir esta campanha. Tente novamente.');
    }
  }

  return (
    <div className="min-h-screen vtt-canvas flex flex-col">
      {/* Clean 3-zone top bar */}
      <header className="w-full max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-8 border-b vtt-border">
        <span className="text-lg font-bold font-typewriter whitespace-nowrap shrink-0">Folio</span>
        <nav className="hidden md:flex items-center gap-6 text-xs vtt-muted">
          <a href="#campanhas" className="hover:opacity-100 whitespace-nowrap shrink-0">
            Minhas Campanhas
          </a>
          <a href="#entrar-sala" className="hover:opacity-100 whitespace-nowrap shrink-0">
            Entrar como Jogador
          </a>
        </nav>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 text-xs font-semibold vtt-accent-btn flex items-center gap-2 whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            Nova campanha
          </button>
          <button
            type="button"
            onClick={() => void logOut()}
            title="Sair da conta"
            className="p-2 border vtt-border vtt-muted hover:opacity-80 shrink-0"
            aria-label="Sair da conta"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-10 space-y-12">
        {/* Intro + Quick Join Row */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-7 space-y-2">
            <p className="text-xs vtt-muted">
              Arquivo de mesas · {user.displayName || 'Mestre'}
            </p>
            <h1 className="text-3xl font-bold font-typewriter">Suas Campanhas</h1>
            <p className="text-sm vtt-muted max-w-xl leading-relaxed">
              Cada campanha salva seu próprio fundo, cores, cenas pré-carregadas, fichas e anotações.
              Abra uma mesa para mestrar ou entre com um código de sala como jogador.
            </p>
          </div>

          <form
            id="entrar-sala"
            onSubmit={handleJoinRoom}
            className="lg:col-span-5 vtt-surface border p-5 space-y-3"
          >
            <div className="flex items-center gap-2 text-xs font-semibold">
              <KeyRound className="w-3.5 h-3.5 vtt-accent-text" />
              <span>Entrar em mesa pelo código (Celular / Online)</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="EX: K9P2X4"
                maxLength={6}
                className="flex-1 px-3 py-2 text-sm uppercase tracking-widest tabular-nums border vtt-border vtt-canvas"
              />
              <button
                type="submit"
                disabled={joining}
                className="px-4 py-2 text-xs font-semibold vtt-accent-btn whitespace-nowrap shrink-0 disabled:opacity-60"
              >
                {joining ? 'Entrando...' : 'Entrar'}
              </button>
            </div>
            {joinError && <p className="text-xs text-red-700 dark:text-red-400">{joinError}</p>}
          </form>
        </section>

        {/* Owned Campaigns */}
        <section id="campanhas" className="space-y-4">
          <div className="flex items-center justify-between border-b vtt-border pb-3">
            <h2 className="text-lg font-bold font-typewriter">Mesas que você mestra</h2>
            <span className="text-xs vtt-muted tabular-nums">
              {campaigns.length} {campaigns.length === 1 ? 'campanha' : 'campanhas'}
            </span>
          </div>

          {lobbyError && (
            <div className="p-3 border border-red-700/40 bg-red-700/10 text-xs text-red-700 dark:text-red-400">
              {lobbyError}
            </div>
          )}

          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-44 vtt-surface border animate-pulse" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="vtt-surface border p-10 text-center space-y-4">
              <h3 className="text-xl font-bold font-typewriter">Nenhuma campanha criada ainda</h3>
              <p className="text-sm vtt-muted max-w-md mx-auto">
                Comece com uma mesa de demonstração (3 cenas, handouts e wiki)
                ou monte sua própria campanha do zero com suas fichas e áudios.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleQuickDemo}
                  disabled={creating}
                  className="px-5 py-2.5 text-xs font-semibold vtt-accent-btn whitespace-nowrap"
                >
                  {creating ? 'Preparando mesa...' : 'Criar mesa de demonstração'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="px-5 py-2.5 text-xs font-semibold border vtt-border hover:opacity-80 whitespace-nowrap"
                >
                  Criar campanha em branco
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {campaigns.map((camp) => (
                <article
                  key={camp.id}
                  className="vtt-surface border flex flex-col justify-between transition-transform duration-150 hover:-translate-y-0.5"
                >
                  {/* Visual theme color bar */}
                  <div
                    className="h-2 w-full flex"
                    aria-hidden="true"
                  >
                    <span className="flex-1" style={{ backgroundColor: camp.theme?.bgCanvas || '#f4efe6' }} />
                    <span className="w-10" style={{ backgroundColor: camp.theme?.textPrimary || '#1f1e1c' }} />
                    <span className="w-8" style={{ backgroundColor: camp.theme?.accentColor || '#8f2d2d' }} />
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-1.5">
                      <p className="text-xs vtt-muted">
                        {camp.system} · Sala <span className="tabular-nums font-semibold">{camp.roomCode}</span>
                      </p>
                      <h3 className="text-lg font-bold font-typewriter leading-snug">
                        {camp.title}
                      </h3>
                      {camp.description && (
                        <p className="text-xs vtt-muted line-clamp-2 leading-relaxed">
                          {camp.description}
                        </p>
                      )}
                    </div>

                    <div className="pt-3 border-t vtt-border flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenCampaign(camp.id)}
                        className="px-3.5 py-2 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap"
                      >
                        Abrir mesa
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>

                      {confirmDeleteId === camp.id ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void handleDelete(camp)}
                            className="px-2.5 py-1.5 text-xs bg-red-700 text-white whitespace-nowrap"
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1.5 text-xs border vtt-border whitespace-nowrap"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(camp.id)}
                          title="Excluir campanha"
                          className="p-2 vtt-muted hover:text-red-700 transition-colors"
                          aria-label={`Excluir ${camp.title}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Joined Campaigns as Player */}
        {memberships.filter((m) => m.role === 'player').length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center justify-between border-b vtt-border pb-3">
              <h2 className="text-lg font-bold font-typewriter">Mesas como Jogador</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {memberships
                .filter((m) => m.role === 'player')
                .map((m) => (
                  <div key={m.campaignId} className="vtt-surface border p-5 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-xs vtt-muted tabular-nums">Sala {m.roomCode}</p>
                      <h3 className="text-base font-bold font-typewriter truncate">{m.campaignTitle}</h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenPlayerRoom(m.campaignId)}
                      className="px-3.5 py-2 text-xs font-semibold border vtt-border hover:opacity-80 whitespace-nowrap shrink-0"
                    >
                      Abrir ficha
                    </button>
                  </div>
                ))}
            </div>
          </section>
        )}
      </main>

      {/* Create Campaign Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCampaign}
            className="w-full max-w-lg vtt-surface border p-6 space-y-5 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b vtt-border pb-3">
              <h2 className="text-xl font-bold font-typewriter">Nova Campanha</h2>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-xs vtt-muted hover:opacity-80"
              >
                Fechar
              </button>
            </div>

            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold">Título da campanha</span>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  placeholder="Ex: Sombras sobre o Cais"
                  className="w-full px-3 py-2 text-sm border vtt-border vtt-canvas"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold">Sistema de RPG</span>
                <input
                  type="text"
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  maxLength={80}
                  placeholder="Ex: Call of Cthulhu, D&D 5e, Cyberpunk, Próprio"
                  className="w-full px-3 py-2 text-sm border vtt-border vtt-canvas"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-semibold">Resumo curto (opcional)</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Tema, época ou lembrete rápido da campanha"
                  className="w-full px-3 py-2 text-sm border vtt-border vtt-canvas resize-none"
                />
              </label>

              <div className="space-y-2 pt-1">
                <span className="text-xs font-semibold block">Tema visual inicial da campanha</span>
                <div className="grid grid-cols-2 gap-2.5">
                  {THEME_PRESETS.map((preset) => {
                    const active = selectedTheme.preset === preset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setSelectedTheme(preset.theme)}
                        className={`p-3 border text-left transition-colors ${
                          active ? 'ring-2' : 'vtt-border'
                        }`}
                        style={{
                          backgroundColor: preset.theme.bgSurface,
                          color: preset.theme.textPrimary,
                          borderColor: active ? preset.theme.accentColor : preset.theme.borderColor,
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold truncate">{preset.name}</span>
                          <span
                            className="w-3.5 h-3.5 shrink-0 border"
                            style={{
                              backgroundColor: preset.theme.accentColor,
                              borderColor: preset.theme.borderColor,
                            }}
                          />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="flex items-start gap-2.5 pt-2 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={withStarter}
                  onChange={(e) => setWithStarter(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Incluir kit inicial pronto (3 cenas ilustradas, handouts e notas de exemplo)
                </span>
              </label>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t vtt-border">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-xs border vtt-border whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={creating || !title.trim()}
                className="px-5 py-2 text-xs font-semibold vtt-accent-btn disabled:opacity-60 whitespace-nowrap"
              >
                {creating ? 'Criando...' : 'Criar campanha'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
