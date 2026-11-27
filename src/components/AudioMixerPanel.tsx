import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CloudRain,
  Link2,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Square,
  Swords,
  Trash2,
  Upload,
  Volume2,
  Youtube,
  Zap,
} from 'lucide-react';
import {
  DEFAULT_AUDIO_DSP,
  type AudioDspSettings,
  type AudioLayer,
  type AudioTrack,
} from '../types/vtt';
import { audioEngine, type LayerTimingInfo } from '../lib/audioEngine';
import { uploadMediaFile, type CampaignUploadContext } from '../lib/mediaStore';
import { resolveMediaLinkInBrowser } from '../lib/clientMediaLinkResolver';

type UploadCategory = 'music' | 'duel' | 'ambience' | 'sfx';

interface AudioMixerPanelProps {
  uploadContext: CampaignUploadContext;
  tracks: AudioTrack[];
  activeMusicId: string | null;
  activeAmbienceId: string | null;
  onSyncAudioUi: () => void;
  onAddTrack: (data: {
    name: string;
    layer: AudioLayer;
    sourceType: 'url' | 'media' | 'youtube';
    url: string;
    mediaId: string;
    synthPreset?: string;
  }) => Promise<void>;
  onUpdateTrackDsp: (trackId: string, dsp: AudioDspSettings) => Promise<void>;
  onDeleteTrack: (trackId: string) => Promise<void>;
  onNotify: (msg: string) => void;
}

function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export function AudioMixerPanel({
  uploadContext,
  tracks,
  activeMusicId,
  activeAmbienceId,
  onSyncAudioUi,
  onAddTrack,
  onUpdateTrackDsp,
  onDeleteTrack,
  onNotify,
}: AudioMixerPanelProps) {
  const vols = audioEngine.getVolumes();
  const [masterVol, setMasterVol] = useState(vols.master);
  const [musicVol, setMusicVol] = useState(vols.music);
  const [ambVol, setAmbVol] = useState(vols.ambience);
  const [sfxVol, setSfxVol] = useState(vols.sfx);
  const [autoPlaySceneAudio, setAutoPlaySceneAudio] = useState(() =>
    audioEngine.isAutoPlayEnabled()
  );

  // Collapsible sections for clean progressive disclosure
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    master: false,
    music: true,
    duel: false,
    ambience: false,
    sfx: false,
  });

  function toggleSection(key: string) {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  useEffect(() => {
    return audioEngine.subscribe(() => {
      const v = audioEngine.getVolumes();
      setMasterVol(v.master);
      setMusicVol(v.music);
      setAmbVol(v.ambience);
      setSfxVol(v.sfx);
      setAutoPlaySceneAudio(audioEngine.isAutoPlayEnabled());
    });
  }, []);

  const [uploadingCategory, setUploadingCategory] = useState<UploadCategory | null>(null);
  const [uploadPct, setUploadPct] = useState(0);

  // Expanded advanced DSP drawer per track
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);
  const [draftDsps, setDraftDsps] = useState<Record<string, AudioDspSettings>>({});
  const [liveTiming, setLiveTiming] = useState<Record<'music' | 'ambience', LayerTimingInfo | null>>({
    music: null,
    ambience: null,
  });
  const saveTimersRef = useRef<Record<string, number>>({});

  // External link drawer (YouTube, direct audio, or video audio-only)
  const [showUrlForm, setShowUrlForm] = useState(false);
  const [urlName, setUrlName] = useState('');
  const [urlCategory, setUrlCategory] = useState<UploadCategory>('music');
  const [urlLink, setUrlLink] = useState('');
  const [resolvingLink, setResolvingLink] = useState(false);

  const musicList = tracks.filter((t) => t.layer === 'music' && t.synthPreset !== 'duel');
  const duelMusicList = tracks.filter((t) => t.layer === 'music' && t.synthPreset === 'duel');
  const ambienceList = tracks.filter((t) => t.layer === 'ambience');
  const sfxList = tracks.filter((t) => t.layer === 'sfx');

  const musicPaused = audioEngine.isLayerPaused('music');
  const ambiencePaused = audioEngine.isLayerPaused('ambience');

  // Poll live playback timeline when an advanced drawer is open
  useEffect(() => {
    if (!expandedTrackId) return;
    const poll = () => {
      setLiveTiming({
        music: audioEngine.getLayerTiming('music'),
        ambience: audioEngine.getLayerTiming('ambience'),
      });
    };
    poll();
    const id = window.setInterval(poll, 450);
    return () => window.clearInterval(id);
  }, [expandedTrackId, activeMusicId, activeAmbienceId]);

  useEffect(() => {
    return () => {
      Object.values(saveTimersRef.current).forEach((id) => window.clearTimeout(id));
    };
  }, []);

  function getTrackDsp(track: AudioTrack): AudioDspSettings {
    return draftDsps[track.id] || { ...DEFAULT_AUDIO_DSP, ...(track.dsp || {}) };
  }

  function handleChangeDsp(track: AudioTrack, patch: Partial<AudioDspSettings>) {
    const next: AudioDspSettings = { ...getTrackDsp(track), ...patch };
    setDraftDsps((prev) => ({ ...prev, [track.id]: next }));

    if (track.layer === 'music' && activeMusicId === track.id) {
      audioEngine.updateLiveDsp('music', next);
    } else if (track.layer === 'ambience' && activeAmbienceId === track.id) {
      audioEngine.updateLiveDsp('ambience', next);
    }

    const prevTimer = saveTimersRef.current[track.id];
    if (prevTimer) window.clearTimeout(prevTimer);
    saveTimersRef.current[track.id] = window.setTimeout(() => {
      void onUpdateTrackDsp(track.id, next);
    }, 380);
  }

  async function handlePlayOrTogglePause(track: AudioTrack) {
    try {
      if (track.layer === 'music' && activeMusicId === track.id) {
        audioEngine.togglePauseLayer('music');
        onSyncAudioUi();
        return;
      }
      if (track.layer === 'ambience' && activeAmbienceId === track.id) {
        audioEngine.togglePauseLayer('ambience');
        onSyncAudioUi();
        return;
      }
      const effectiveTrack: AudioTrack = { ...track, dsp: getTrackDsp(track) };
      await audioEngine.playTrack(effectiveTrack, uploadContext.campaignId);
      onSyncAudioUi();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Não foi possível reproduzir esta faixa.');
    }
  }

  function handleStopTrack(track: AudioTrack) {
    if (track.layer === 'music' && activeMusicId === track.id) {
      audioEngine.stopLayer('music');
      onSyncAudioUi();
    } else if (track.layer === 'ambience' && activeAmbienceId === track.id) {
      audioEngine.stopLayer('ambience');
      onSyncAudioUi();
    }
  }

  async function handleDirectFileUpload(category: UploadCategory, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingCategory(category);
    setUploadPct(5);

    const layer: AudioLayer = category === 'duel' ? 'music' : category;
    const synthPreset = category === 'duel' ? 'duel' : '';

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const res = await uploadMediaFile(file, {
          ...uploadContext,
          optimizeFor: 'audio',
          onProgress: (p) => setUploadPct(p),
        });
        const cleanName = file.name.replace(/\.[^.]+$/, '').slice(0, 90) || 'Faixa de Áudio';
        await onAddTrack({
          name: cleanName,
          layer,
          sourceType: 'media',
          url: res.url,
          mediaId: res.mediaId,
          synthPreset,
        });
        const optNote = res.compressionSummary ? ` (${res.compressionSummary})` : '';
        onNotify(
          res.savedToCloud
            ? `Áudio "${cleanName}" salvo na nuvem${optNote}!`
            : `Áudio "${cleanName}" carregado na sessão${optNote}.`
        );
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao enviar arquivo de áudio.');
    } finally {
      setUploadingCategory(null);
      setUploadPct(0);
    }
  }

  async function handleSubmitUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!urlLink.trim()) return;
    setResolvingLink(true);
    const layer: AudioLayer = urlCategory === 'duel' ? 'music' : urlCategory;
    const synthPreset = urlCategory === 'duel' ? 'duel' : '';
    try {
      const data = await resolveMediaLinkInBrowser(urlLink.trim());
      const finalName = (urlName.trim() || data.title || 'Faixa por Link').slice(0, 96);
      await onAddTrack({
        name: finalName,
        layer,
        sourceType: data.sourceType === 'youtube' ? 'youtube' : 'url',
        url: data.url,
        mediaId: '',
        synthPreset,
      });
      setUrlName('');
      setUrlLink('');
      setShowUrlForm(false);
      onNotify(
        data.sourceType === 'youtube'
          ? `Áudio do YouTube "${finalName}" adicionado com fade suave.`
          : `Faixa "${finalName}" adicionada ao mixer.`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Não foi possível validar o link.');
    } finally {
      setResolvingLink(false);
    }
  }

  function renderAdvancedDrawer(track: AudioTrack, isPlaying: boolean) {
    const dsp = getTrackDsp(track);
    const isYt = track.sourceType === 'youtube';
    const layerTiming =
      track.layer === 'music'
        ? isPlaying
          ? liveTiming.music
          : null
        : track.layer === 'ambience'
          ? isPlaying
            ? liveTiming.ambience
            : null
          : null;

    const hasModified =
      dsp.startSec > 0 || dsp.speed !== 1 || dsp.pitch !== 0 || dsp.muffle > 0;

    return (
      <div className="border-t vtt-border p-2.5 space-y-2.5 vtt-surface text-[11px]">
        {isPlaying && layerTiming && layerTiming.duration > 0 && track.layer !== 'sfx' ? (
          <label className="block space-y-1">
            <div className="flex justify-between">
              <span className="font-semibold">Posição atual</span>
              <span className="vtt-muted tabular-nums">
                {formatClock(layerTiming.currentTime)} / {formatClock(layerTiming.duration)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(layerTiming.duration))}
              step={1}
              value={Math.min(
                Math.floor(layerTiming.duration),
                Math.floor(layerTiming.currentTime)
              )}
              onChange={(e) => {
                const sec = Number(e.target.value);
                if (track.layer === 'music' || track.layer === 'ambience') {
                  audioEngine.seekLayer(track.layer, sec);
                  setLiveTiming((prev) => ({
                    ...prev,
                    [track.layer]: prev[track.layer as 'music' | 'ambience']
                      ? { ...prev[track.layer as 'music' | 'ambience']!, currentTime: sec }
                      : null,
                  }));
                }
              }}
              className="w-full"
            />
          </label>
        ) : null}

        <label className="block space-y-1">
          <div className="flex justify-between">
            <span>Iniciar em (ponto inicial)</span>
            <span className="vtt-muted tabular-nums">{formatClock(dsp.startSec)}</span>
          </div>
          <input
            type="range"
            min={0}
            max={600}
            step={5}
            value={Math.min(600, dsp.startSec)}
            onChange={(e) => {
              const sec = Number(e.target.value);
              handleChangeDsp(track, { startSec: sec });
              if (isPlaying && (track.layer === 'music' || track.layer === 'ambience')) {
                audioEngine.seekLayer(track.layer, sec);
              }
            }}
            className="w-full"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex justify-between">
            <span>Velocidade</span>
            <span className="vtt-muted tabular-nums">{dsp.speed.toFixed(2)}x</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={2.0}
            step={0.05}
            value={dsp.speed}
            onChange={(e) => handleChangeDsp(track, { speed: Number(e.target.value) })}
            className="w-full"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex justify-between">
            <span>Pitch (Tom)</span>
            <span className="vtt-muted tabular-nums">
              {dsp.pitch > 0 ? `+${dsp.pitch}` : dsp.pitch} st
            </span>
          </div>
          <input
            type="range"
            min={-12}
            max={12}
            step={1}
            disabled={isYt}
            value={dsp.pitch}
            onChange={(e) => handleChangeDsp(track, { pitch: Number(e.target.value) })}
            className="w-full disabled:opacity-40"
          />
        </label>

        <label className="block space-y-1">
          <div className="flex justify-between">
            <span>Abafamento (atrás de muro/porta)</span>
            <span className="vtt-muted tabular-nums">{dsp.muffle}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            disabled={isYt}
            value={dsp.muffle}
            onChange={(e) => handleChangeDsp(track, { muffle: Number(e.target.value) })}
            className="w-full disabled:opacity-40"
          />
        </label>

        {isYt && (
          <p className="text-[10px] vtt-muted leading-snug">
            Links do YouTube suportam posição, velocidade e fade suave. Para pitch e abafamento em tempo real, envie o arquivo de áudio.
          </p>
        )}

        {hasModified && (
          <button
            type="button"
            onClick={() => handleChangeDsp(track, { ...DEFAULT_AUDIO_DSP })}
            className="w-full py-1.5 border vtt-border vtt-canvas hover:vtt-subtle flex items-center justify-center gap-1 text-[11px]"
          >
            <RotateCcw className="w-3 h-3" />
            Resetar ajustes
          </button>
        )}
      </div>
    );
  }

  function renderLoopTrackRow(track: AudioTrack, activeOnLayer: boolean, isPaused: boolean) {
    const expanded = expandedTrackId === track.id;
    const dsp = getTrackDsp(track);
    const hasDsp = dsp.startSec > 0 || dsp.speed !== 1 || dsp.pitch !== 0 || dsp.muffle > 0;

    return (
      <div
        key={track.id}
        className={`border ${activeOnLayer ? 'vtt-subtle border-current' : 'vtt-canvas vtt-border'}`}
      >
        <div className="flex items-center justify-between gap-1.5 p-2">
          <button
            type="button"
            onClick={() => void handlePlayOrTogglePause(track)}
            className="flex-1 flex items-center gap-2 text-left min-w-0"
            title={
              activeOnLayer
                ? isPaused
                  ? 'Retomar com fade suave'
                  : 'Pausar com fade suave'
                : 'Tocar com fade suave'
            }
          >
            {activeOnLayer && !isPaused ? (
              <Pause className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
            ) : (
              <Play
                className={`w-3.5 h-3.5 shrink-0 ${
                  activeOnLayer && isPaused ? 'vtt-accent-text' : 'vtt-muted'
                }`}
              />
            )}
            <span className="text-xs font-semibold truncate">{track.name}</span>
            {activeOnLayer && isPaused && (
              <span className="text-[10px] vtt-muted whitespace-nowrap">(Pausado)</span>
            )}
            {track.sourceType === 'youtube' && (
              <Youtube className="w-3.5 h-3.5 text-red-600 shrink-0" aria-label="YouTube áudio" />
            )}
          </button>

          {activeOnLayer && (
            <button
              type="button"
              onClick={() => handleStopTrack(track)}
              className="p-1 vtt-accent-text hover:opacity-80 shrink-0"
              title="Parar faixa (com fade suave)"
              aria-label={`Parar ${track.name}`}
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setExpandedTrackId((cur) => (cur === track.id ? null : track.id))}
            className={`p-1 shrink-0 ${
              expanded || hasDsp ? 'vtt-accent-text' : 'vtt-muted hover:opacity-100'
            }`}
            title="Opções avançadas (posição, velocidade, pitch, abafamento)"
            aria-label={`Opções avançadas de ${track.name}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void onDeleteTrack(track.id)}
            className="p-1 vtt-muted hover:text-red-700 shrink-0"
            aria-label={`Remover ${track.name}`}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
        {expanded && renderAdvancedDrawer(track, activeOnLayer)}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3.5 space-y-3">
      {/* Header & Master Stop */}
      <div className="flex items-center justify-between gap-2 border-b vtt-border pb-3">
        <div>
          <p className="text-xs font-bold font-typewriter">Áudios da Campanha</p>
          <p className="text-[11px] vtt-muted">
            Clique nos títulos para expandir ou recolher cada categoria
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            audioEngine.stopAll();
            onSyncAudioUi();
          }}
          className="px-2.5 py-1.5 text-xs border vtt-border hover:opacity-80 flex items-center gap-1.5 whitespace-nowrap shrink-0"
        >
          <Square className="w-3 h-3" />
          Parar tudo
        </button>
      </div>

      {/* Auto-Play Scene & Combat Audio Switch (Always accessible at top) */}
      <div className="border vtt-border vtt-canvas p-2.5 space-y-1.5">
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="text-xs font-semibold">Áudio Automático nas Cenas e Combate</span>
          <input
            type="checkbox"
            checked={autoPlaySceneAudio}
            onChange={(e) => {
              const next = e.target.checked;
              audioEngine.setAutoPlayEnabled(next);
              setAutoPlaySceneAudio(next);
              onNotify(
                next
                  ? 'Áudio automático ligado: cenas e duelos tocarão suas trilhas vinculadas.'
                  : 'Áudio automático desligado: trocar de cena não inicia nem interrompe o que está tocando.'
              );
            }}
          />
        </label>
        <p className="text-[10px] vtt-muted leading-snug">
          {autoPlaySceneAudio
            ? 'Ligado: ao trocar de cena ou iniciar Duelo, a trilha vinculada começa automaticamente.'
            : 'Desligado: você controla manualmente. Trocar ou sair da cena não altera nem interrompe o áudio atual.'}
        </p>
      </div>

      {/* Collapsible Master Standard Section */}
      <section className="border vtt-border vtt-canvas">
        <button
          type="button"
          onClick={() => toggleSection('master')}
          className="w-full px-3 py-2.5 flex items-center justify-between text-xs font-semibold hover:vtt-subtle"
        >
          <span className="flex items-center gap-1.5">
            {openSections.master ? (
              <ChevronDown className="w-3.5 h-3.5 vtt-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 vtt-muted" />
            )}
            <Volume2 className="w-3.5 h-3.5 vtt-accent-text" />
            Padrão Master & Volumes
          </span>
          <span className="text-[10px] vtt-muted tabular-nums">{Math.round(masterVol * 100)}%</span>
        </button>

        {openSections.master && (
          <div className="px-3 pb-3 pt-2 border-t vtt-border space-y-2.5 text-[11px]">
            <label className="flex items-center gap-2">
              <span className="w-16 font-semibold">Master</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={masterVol}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMasterVol(v);
                  audioEngine.setMasterVolume(v);
                }}
                className="flex-1"
              />
              <span className="w-9 text-right tabular-nums">{Math.round(masterVol * 100)}%</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-16 vtt-muted">Música</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={musicVol}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setMusicVol(v);
                  audioEngine.setVolume('music', v);
                }}
                className="flex-1"
              />
              <span className="w-9 text-right tabular-nums">{Math.round(musicVol * 100)}%</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-16 vtt-muted">Ambiente</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={ambVol}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setAmbVol(v);
                  audioEngine.setVolume('ambience', v);
                }}
                className="flex-1"
              />
              <span className="w-9 text-right tabular-nums">{Math.round(ambVol * 100)}%</span>
            </label>
            <label className="flex items-center gap-2">
              <span className="w-16 vtt-muted">Efeitos</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={sfxVol}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setSfxVol(v);
                  audioEngine.setVolume('sfx', v);
                }}
                className="flex-1"
              />
              <span className="w-9 text-right tabular-nums">{Math.round(sfxVol * 100)}%</span>
            </label>

            <div className="grid grid-cols-2 gap-1.5 pt-1">
              <button
                type="button"
                onClick={() => {
                  audioEngine.saveMasterDefaults();
                  onNotify('Padrão Master de volumes salvo!');
                }}
                className="py-1.5 px-2 text-[11px] font-semibold vtt-accent-btn flex items-center justify-center gap-1"
              >
                <Save className="w-3 h-3" />
                Salvar como Padrão
              </button>
              <button
                type="button"
                onClick={() => {
                  audioEngine.applyMasterDefaults();
                  onNotify('Volumes restaurados ao Padrão Master.');
                }}
                className="py-1.5 px-2 text-[11px] border vtt-border vtt-surface hover:opacity-80 flex items-center justify-center gap-1"
              >
                <RotateCcw className="w-3 h-3" />
                Aplicar Padrão
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Quick Add Link (YouTube or Direct Audio/Video URL — Audio-Only Extraction) */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setShowUrlForm((v) => !v)}
          className="w-full py-2 px-3 text-xs font-semibold vtt-accent-btn flex items-center justify-center gap-1.5"
        >
          <Link2 className="w-3.5 h-3.5" />
          {showUrlForm ? 'Fechar adição por link' : 'Adicionar por link (YouTube, áudio ou vídeo)'}
        </button>

        {showUrlForm && (
          <form onSubmit={handleSubmitUrl} className="space-y-2.5 border vtt-border p-3 vtt-canvas">
            <input
              type="url"
              required
              value={urlLink}
              onChange={(e) => setUrlLink(e.target.value)}
              placeholder="https://youtube.com/watch?v=... ou link .mp3/.mp4"
              className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
            />
            <input
              type="text"
              value={urlName}
              onChange={(e) => setUrlName(e.target.value)}
              maxLength={100}
              placeholder="Nome da faixa (opcional — puxa título do YouTube)"
              className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
            />
            <select
              value={urlCategory}
              onChange={(e) => setUrlCategory(e.target.value as UploadCategory)}
              className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
            >
              <option value="music">Música de Fundo (Exploração / Loop)</option>
              <option value="duel">Música de Modo Duelo (Combate 3D)</option>
              <option value="ambience">Ambiente (Por cima da música)</option>
              <option value="sfx">Efeito Sonoro (One-Shot)</option>
            </select>
            <button
              type="submit"
              disabled={!urlLink.trim() || resolvingLink}
              className="w-full py-2 text-xs font-semibold vtt-accent-btn flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              {resolvingLink ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Validando link...
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  Extrair só áudio e salvar
                </>
              )}
            </button>
          </form>
        )}
      </div>

      {/* Layer 1: Background Music (Collapsible) */}
      <section className="border vtt-border vtt-surface">
        <button
          type="button"
          onClick={() => toggleSection('music')}
          className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold hover:vtt-subtle"
        >
          <span className="flex items-center gap-1.5">
            {openSections.music ? (
              <ChevronDown className="w-3.5 h-3.5 vtt-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 vtt-muted" />
            )}
            <Music className="w-3.5 h-3.5 vtt-accent-text" />
            Música de Fundo ({musicList.length})
          </span>
          <span className="text-[10px] vtt-muted tabular-nums">
            {Math.round(musicVol * 100)}%
          </span>
        </button>

        {openSections.music && (
          <div className="p-2.5 pt-2 border-t vtt-border space-y-2.5">
            <label className="w-full py-2 px-3 border border-dashed vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center justify-center gap-2 text-xs font-semibold transition-colors">
              {uploadingCategory === 'music' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin vtt-accent-text" />
                  <span>Otimizando e salvando ({uploadPct}%)...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5 vtt-accent-text" />
                  <span>Enviar música (.mp3, .wav, .ogg)</span>
                </>
              )}
              <input
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                disabled={uploadingCategory !== null}
                onChange={(e) => {
                  void handleDirectFileUpload('music', e.target.files);
                  e.target.value = '';
                }}
              />
            </label>

            {musicList.length === 0 ? (
              <p className="text-[11px] vtt-muted px-1">Nenhuma música adicionada ainda.</p>
            ) : (
              <div className="space-y-1.5">
                {musicList.map((track) =>
                  renderLoopTrackRow(track, activeMusicId === track.id, musicPaused)
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Layer 1B: Duel Mode Combat Music (Collapsible) */}
      <section className="border vtt-border vtt-surface">
        <button
          type="button"
          onClick={() => toggleSection('duel')}
          className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold hover:vtt-subtle"
        >
          <span className="flex items-center gap-1.5">
            {openSections.duel ? (
              <ChevronDown className="w-3.5 h-3.5 vtt-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 vtt-muted" />
            )}
            <Swords className="w-3.5 h-3.5 vtt-accent-text" />
            Músicas de Modo Duelo ({duelMusicList.length})
          </span>
        </button>

        {openSections.duel && (
          <div className="p-2.5 pt-2 border-t vtt-border space-y-2.5">
            <label className="w-full py-2 px-3 border border-dashed vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center justify-center gap-2 text-xs font-semibold transition-colors">
              {uploadingCategory === 'duel' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin vtt-accent-text" />
                  <span>Otimizando e salvando ({uploadPct}%)...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5 vtt-accent-text" />
                  <span>Enviar trilha de duelo (.mp3, .wav, .ogg)</span>
                </>
              )}
              <input
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                disabled={uploadingCategory !== null}
                onChange={(e) => {
                  void handleDirectFileUpload('duel', e.target.files);
                  e.target.value = '';
                }}
              />
            </label>

            {duelMusicList.length === 0 ? (
              <p className="text-[11px] vtt-muted px-1">
                Nenhuma música de duelo cadastrada ainda.
              </p>
            ) : (
              <div className="space-y-1.5">
                {duelMusicList.map((track) =>
                  renderLoopTrackRow(track, activeMusicId === track.id, musicPaused)
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Layer 2: Ambience (Collapsible) */}
      <section className="border vtt-border vtt-surface">
        <button
          type="button"
          onClick={() => toggleSection('ambience')}
          className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold hover:vtt-subtle"
        >
          <span className="flex items-center gap-1.5">
            {openSections.ambience ? (
              <ChevronDown className="w-3.5 h-3.5 vtt-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 vtt-muted" />
            )}
            <CloudRain className="w-3.5 h-3.5 vtt-accent-text" />
            Ambiente ({ambienceList.length})
          </span>
          <span className="text-[10px] vtt-muted tabular-nums">
            {Math.round(ambVol * 100)}%
          </span>
        </button>

        {openSections.ambience && (
          <div className="p-2.5 pt-2 border-t vtt-border space-y-2.5">
            <label className="w-full py-2 px-3 border border-dashed vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center justify-center gap-2 text-xs font-semibold transition-colors">
              {uploadingCategory === 'ambience' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin vtt-accent-text" />
                  <span>Otimizando e salvando ({uploadPct}%)...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5 vtt-accent-text" />
                  <span>Enviar ambiente (chuva, cidade, vento...)</span>
                </>
              )}
              <input
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                disabled={uploadingCategory !== null}
                onChange={(e) => {
                  void handleDirectFileUpload('ambience', e.target.files);
                  e.target.value = '';
                }}
              />
            </label>

            {ambienceList.length === 0 ? (
              <p className="text-[11px] vtt-muted px-1">Nenhum ambiente adicionado ainda.</p>
            ) : (
              <div className="space-y-1.5">
                {ambienceList.map((track) =>
                  renderLoopTrackRow(track, activeAmbienceId === track.id, ambiencePaused)
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Layer 3: One-Shot SFX Pad (Collapsible) */}
      <section className="border vtt-border vtt-surface">
        <button
          type="button"
          onClick={() => toggleSection('sfx')}
          className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-xs font-semibold hover:vtt-subtle"
        >
          <span className="flex items-center gap-1.5">
            {openSections.sfx ? (
              <ChevronDown className="w-3.5 h-3.5 vtt-muted" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 vtt-muted" />
            )}
            <Zap className="w-3.5 h-3.5 vtt-accent-text" />
            Efeitos Sonoros ({sfxList.length})
          </span>
          <span className="text-[10px] vtt-muted tabular-nums">
            {Math.round(sfxVol * 100)}%
          </span>
        </button>

        {openSections.sfx && (
          <div className="p-2.5 pt-2 border-t vtt-border space-y-2.5">
            <label className="w-full py-2 px-3 border border-dashed vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center justify-center gap-2 text-xs font-semibold transition-colors">
              {uploadingCategory === 'sfx' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin vtt-accent-text" />
                  <span>Otimizando e salvando ({uploadPct}%)...</span>
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5 vtt-accent-text" />
                  <span>Enviar efeito sonoro (tiro, porta, trovão...)</span>
                </>
              )}
              <input
                type="file"
                accept="audio/*"
                multiple
                className="hidden"
                disabled={uploadingCategory !== null}
                onChange={(e) => {
                  void handleDirectFileUpload('sfx', e.target.files);
                  e.target.value = '';
                }}
              />
            </label>

            {sfxList.length === 0 ? (
              <p className="text-[11px] vtt-muted px-1">Nenhum efeito sonoro adicionado ainda.</p>
            ) : (
              <div className="space-y-1.5">
                {sfxList.map((track) => {
                  const expanded = expandedTrackId === track.id;
                  const dsp = getTrackDsp(track);
                  const hasDsp =
                    dsp.startSec > 0 || dsp.speed !== 1 || dsp.pitch !== 0 || dsp.muffle > 0;
                  return (
                    <div key={track.id} className="border vtt-border vtt-canvas">
                      <div className="flex items-center justify-between gap-1 pr-1">
                        <button
                          type="button"
                          onClick={() => void handlePlayOrTogglePause(track)}
                          className="flex-1 py-2 px-2.5 text-xs font-semibold hover:vtt-subtle active:scale-[0.98] transition-transform truncate text-left flex items-center gap-1.5"
                        >
                          <span>▶ {track.name}</span>
                          {track.sourceType === 'youtube' && (
                            <Youtube className="w-3 h-3 text-red-600 shrink-0" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedTrackId((cur) => (cur === track.id ? null : track.id))
                          }
                          className={`p-1 shrink-0 ${
                            expanded || hasDsp ? 'vtt-accent-text' : 'vtt-muted hover:opacity-100'
                          }`}
                          title="Opções avançadas (posição, velocidade, pitch, abafamento)"
                          aria-label={`Opções avançadas de ${track.name}`}
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteTrack(track.id)}
                          className="p-1 vtt-muted hover:text-red-700 shrink-0"
                          aria-label={`Remover ${track.name}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                      {expanded && renderAdvancedDrawer(track, false)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
