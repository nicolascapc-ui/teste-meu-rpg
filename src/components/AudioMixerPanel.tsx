import { useEffect, useRef, useState } from 'react';
import {
  CloudRain,
  Link2,
  Loader2,
  Music,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Square,
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
  const [musicVol, setMusicVol] = useState(vols.music);
  const [ambVol, setAmbVol] = useState(vols.ambience);
  const [sfxVol, setSfxVol] = useState(vols.sfx);

  const [uploadingLayer, setUploadingLayer] = useState<AudioLayer | null>(null);
  const [uploadPct, setUploadPct] = useState(0);

  // Expanded advanced DSP drawer per track (progressive disclosure: clean by default)
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
  const [urlLayer, setUrlLayer] = useState<AudioLayer>('music');
  const [urlLink, setUrlLink] = useState('');
  const [resolvingLink, setResolvingLink] = useState(false);

  const musicList = tracks.filter((t) => t.layer === 'music');
  const ambienceList = tracks.filter((t) => t.layer === 'ambience');
  const sfxList = tracks.filter((t) => t.layer === 'sfx');

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

    // Apply immediately in real-time if this track is playing
    if (track.layer === 'music' && activeMusicId === track.id) {
      audioEngine.updateLiveDsp('music', next);
    } else if (track.layer === 'ambience' && activeAmbienceId === track.id) {
      audioEngine.updateLiveDsp('ambience', next);
    }

    // Debounce persistence to Firestore so dragging sliders stays silky smooth
    const prevTimer = saveTimersRef.current[track.id];
    if (prevTimer) window.clearTimeout(prevTimer);
    saveTimersRef.current[track.id] = window.setTimeout(() => {
      void onUpdateTrackDsp(track.id, next);
    }, 380);
  }

  async function handlePlayOrStop(track: AudioTrack) {
    try {
      if (track.layer === 'music' && activeMusicId === track.id) {
        audioEngine.stopLayer('music');
        onSyncAudioUi();
        return;
      }
      if (track.layer === 'ambience' && activeAmbienceId === track.id) {
        audioEngine.stopLayer('ambience');
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

  async function handleDirectFileUpload(layer: AudioLayer, files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingLayer(layer);
    setUploadPct(5);

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
      setUploadingLayer(null);
      setUploadPct(0);
    }
  }

  async function handleSubmitUrl(e: React.FormEvent) {
    e.preventDefault();
    if (!urlLink.trim()) return;
    setResolvingLink(true);
    try {
      const data = await resolveMediaLinkInBrowser(urlLink.trim());
      const finalName = (urlName.trim() || data.title || 'Faixa por Link').slice(0, 96);
      await onAddTrack({
        name: finalName,
        layer: urlLayer,
        sourceType: data.sourceType === 'youtube' ? 'youtube' : 'url',
        url: data.url,
        mediaId: '',
      });
      setUrlName('');
      setUrlLink('');
      setShowUrlForm(false);
      onNotify(
        data.sourceType === 'youtube'
          ? `Áudio do YouTube "${finalName}" adicionado (modo só áudio).`
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
        {/* Live Timeline Scrubbing (when playing) + Saved Start Position */}
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
              value={Math.min(Math.floor(layerTiming.duration), Math.floor(layerTiming.currentTime))}
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

        {/* Speed */}
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

        {/* Pitch & Muffle (Full DSP for uploaded & direct links; noted clearly for YouTube) */}
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
            Links do YouTube suportam posição e velocidade. Para pitch e abafamento em tempo real, envie o arquivo de áudio.
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

  function renderLoopTrackRow(track: AudioTrack, playing: boolean) {
    const expanded = expandedTrackId === track.id;
    const dsp = getTrackDsp(track);
    const hasDsp = dsp.startSec > 0 || dsp.speed !== 1 || dsp.pitch !== 0 || dsp.muffle > 0;

    return (
      <div
        key={track.id}
        className={`border ${playing ? 'vtt-subtle border-current' : 'vtt-canvas vtt-border'}`}
      >
        <div className="flex items-center justify-between gap-1.5 p-2">
          <button
            type="button"
            onClick={() => void handlePlayOrStop(track)}
            className="flex-1 flex items-center gap-2 text-left min-w-0"
          >
            {playing ? (
              <Square className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
            ) : (
              <Play className="w-3.5 h-3.5 vtt-muted shrink-0" />
            )}
            <span className="text-xs font-semibold truncate">{track.name}</span>
            {track.sourceType === 'youtube' && (
              <Youtube className="w-3.5 h-3.5 text-red-600 shrink-0" aria-label="YouTube áudio" />
            )}
          </button>
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
        {expanded && renderAdvancedDrawer(track, playing)}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-6">
      {/* Header & Master Stop */}
      <div className="flex items-center justify-between gap-2 border-b vtt-border pb-3">
        <div>
          <p className="text-xs font-bold font-typewriter">Seus Áudios da Campanha</p>
          <p className="text-[11px] vtt-muted">
            Envie arquivos (otimizados automaticamente) ou cole links do YouTube/vídeo
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
              value={urlLayer}
              onChange={(e) => setUrlLayer(e.target.value as AudioLayer)}
              className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
            >
              <option value="music">Música de Fundo (Loop)</option>
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

      {/* Layer 1: Background Music (Loop) */}
      <section className="space-y-2.5 border-t vtt-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5 vtt-accent-text" />
            Música de Fundo (Loop)
          </span>
          <div className="flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 vtt-muted" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={musicVol}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMusicVol(v);
                audioEngine.setVolume('music', v);
              }}
              className="w-20"
              aria-label="Volume da música"
            />
          </div>
        </div>

        <label className="w-full py-2 px-3 border border-dashed vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center justify-center gap-2 text-xs font-semibold transition-colors">
          {uploadingLayer === 'music' ? (
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
            disabled={uploadingLayer !== null}
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
            {musicList.map((track) => renderLoopTrackRow(track, activeMusicId === track.id))}
          </div>
        )}
      </section>

      {/* Layer 2: Ambience (Layered over Music) */}
      <section className="space-y-2.5 border-t vtt-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold flex items-center gap-1.5">
            <CloudRain className="w-3.5 h-3.5 vtt-accent-text" />
            Ambiente (Por cima da música)
          </span>
          <div className="flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 vtt-muted" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={ambVol}
              onChange={(e) => {
                const v = Number(e.target.value);
                setAmbVol(v);
                audioEngine.setVolume('ambience', v);
              }}
              className="w-20"
              aria-label="Volume do ambiente"
            />
          </div>
        </div>

        <label className="w-full py-2 px-3 border border-dashed vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center justify-center gap-2 text-xs font-semibold transition-colors">
          {uploadingLayer === 'ambience' ? (
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
            disabled={uploadingLayer !== null}
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
            {ambienceList.map((track) => renderLoopTrackRow(track, activeAmbienceId === track.id))}
          </div>
        )}
      </section>

      {/* Layer 3: One-Shot SFX Pad */}
      <section className="space-y-2.5 border-t vtt-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 vtt-accent-text" />
            Efeitos Sonoros (One-Shot)
          </span>
          <div className="flex items-center gap-1.5">
            <Volume2 className="w-3.5 h-3.5 vtt-muted" />
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sfxVol}
              onChange={(e) => {
                const v = Number(e.target.value);
                setSfxVol(v);
                audioEngine.setVolume('sfx', v);
              }}
              className="w-20"
              aria-label="Volume dos efeitos sonoros"
            />
          </div>
        </div>

        <label className="w-full py-2 px-3 border border-dashed vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center justify-center gap-2 text-xs font-semibold transition-colors">
          {uploadingLayer === 'sfx' ? (
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
            disabled={uploadingLayer !== null}
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
              const hasDsp = dsp.startSec > 0 || dsp.speed !== 1 || dsp.pitch !== 0 || dsp.muffle > 0;
              return (
                <div key={track.id} className="border vtt-border vtt-canvas">
                  <div className="flex items-center justify-between gap-1 pr-1">
                    <button
                      type="button"
                      onClick={() => void handlePlayOrStop(track)}
                      className="flex-1 py-2 px-2.5 text-xs font-semibold hover:vtt-subtle active:scale-[0.98] transition-transform truncate text-left flex items-center gap-1.5"
                    >
                      <span>▶ {track.name}</span>
                      {track.sourceType === 'youtube' && (
                        <Youtube className="w-3 h-3 text-red-600 shrink-0" />
                      )}
                    </button>
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
                  {expanded && renderAdvancedDrawer(track, false)}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
