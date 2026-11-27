import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  CloudRain,
  Music,
  Pause,
  Play,
  RotateCcw,
  Save,
  Sliders,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  DEFAULT_AUDIO_DSP,
  type AudioDspSettings,
  type AudioTrack,
} from '../types/vtt';
import { audioEngine, type LayerTimingInfo } from '../lib/audioEngine';

interface FloatingAudioPlayerProps {
  open: boolean;
  tracks: AudioTrack[];
  onClose: () => void;
  onSyncAudioUi: () => void;
  onNotify?: (msg: string) => void;
}

function formatClock(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const total = Math.floor(sec);
  const mins = Math.floor(total / 60);
  const rem = total % 60;
  return `${mins}:${rem.toString().padStart(2, '0')}`;
}

export function FloatingAudioPlayer({
  open,
  tracks,
  onClose,
  onSyncAudioUi,
  onNotify,
}: FloatingAudioPlayerProps) {
  const [volumes, setVolumes] = useState(() => audioEngine.getVolumes());
  const [activeIds, setActiveIds] = useState(() => audioEngine.getActiveTrackIds());
  const [autoPlay, setAutoPlay] = useState(() => audioEngine.isAutoPlayEnabled());
  const [musicTiming, setMusicTiming] = useState<LayerTimingInfo | null>(null);
  const [ambTiming, setAmbTiming] = useState<LayerTimingInfo | null>(null);
  const [showDsp, setShowDsp] = useState(false);
  const [showMaster, setShowMaster] = useState(false);

  const [musicDsp, setMusicDsp] = useState<AudioDspSettings>(DEFAULT_AUDIO_DSP);
  const [ambDsp, setAmbDsp] = useState<AudioDspSettings>(DEFAULT_AUDIO_DSP);

  useEffect(() => {
    const syncState = () => {
      setVolumes(audioEngine.getVolumes());
      setActiveIds(audioEngine.getActiveTrackIds());
      setAutoPlay(audioEngine.isAutoPlayEnabled());
      const mDsp = audioEngine.getLayerDsp('music');
      if (mDsp) setMusicDsp(mDsp);
      const aDsp = audioEngine.getLayerDsp('ambience');
      if (aDsp) setAmbDsp(aDsp);
    };
    syncState();
    const unsub = audioEngine.subscribe(syncState);
    const timer = window.setInterval(() => {
      setMusicTiming(audioEngine.getLayerTiming('music'));
      setAmbTiming(audioEngine.getLayerTiming('ambience'));
    }, 500);
    return () => {
      unsub();
      window.clearInterval(timer);
    };
  }, []);

  if (!open) return null;

  const activeMusicTrack = tracks.find((t) => t.id === activeIds.musicId) || null;
  const activeAmbTrack = tracks.find((t) => t.id === activeIds.ambienceId) || null;
  const hasAnyActive = Boolean(activeMusicTrack || activeAmbTrack);

  function updateDspLive(layer: 'music' | 'ambience', partial: Partial<AudioDspSettings>) {
    const base = layer === 'music' ? musicDsp : ambDsp;
    const next = { ...base, ...partial };
    if (layer === 'music') setMusicDsp(next);
    else setAmbDsp(next);
    audioEngine.updateLiveDsp(layer, next);
  }

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      className="fixed bottom-28 right-20 z-50 w-80 max-w-[92vw] vtt-surface border vtt-border shadow-2xl text-xs overflow-hidden flex flex-col"
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b vtt-border vtt-subtle flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Music className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
          <span className="font-bold font-typewriter truncate">Player de Áudio</span>
          {hasAnyActive && (
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              audioEngine.setMuted(!volumes.muted);
              onSyncAudioUi();
            }}
            className={`p-1 border vtt-border ${
              volumes.muted ? 'bg-red-700 text-white border-red-600' : 'vtt-canvas vtt-muted hover:opacity-100'
            }`}
            title={volumes.muted ? 'Desmutar áudio' : 'Silenciar tudo'}
            aria-label="Mutar"
          >
            {volumes.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 vtt-muted hover:opacity-100"
            title="Minimizar player"
            aria-label="Fechar player"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-3 space-y-3 max-h-[70vh] overflow-y-auto">
        {/* Active Music Row */}
        <div className="p-2.5 border vtt-border vtt-canvas space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Music className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider vtt-muted">Música</p>
                <p className="text-xs font-semibold truncate">
                  {activeMusicTrack ? activeMusicTrack.name : 'Nenhuma tocando'}
                </p>
              </div>
            </div>
            {activeMusicTrack && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    audioEngine.togglePauseLayer('music');
                    onSyncAudioUi();
                  }}
                  className="p-1.5 vtt-accent-btn"
                  title={activeIds.musicPaused ? 'Retomar (fade in)' : 'Pausar (fade out)'}
                >
                  {activeIds.musicPaused ? (
                    <Play className="w-3 h-3" />
                  ) : (
                    <Pause className="w-3 h-3" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    audioEngine.stopLayer('music');
                    onSyncAudioUi();
                  }}
                  className="p-1.5 border vtt-border vtt-surface hover:opacity-80"
                  title="Parar música (fade out)"
                >
                  <Square className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {activeMusicTrack && musicTiming && musicTiming.duration > 0 && (
            <div className="space-y-1">
              <input
                type="range"
                min={0}
                max={Math.floor(musicTiming.duration)}
                value={Math.min(Math.floor(musicTiming.duration), Math.floor(musicTiming.currentTime))}
                onChange={(e) => audioEngine.seekLayer('music', Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] vtt-muted tabular-nums">
                <span>{formatClock(musicTiming.currentTime)}</span>
                <span>{formatClock(musicTiming.duration)}</span>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2">
            <span className="text-[10px] vtt-muted w-12 shrink-0">Vol.</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={volumes.music}
              onChange={(e) => audioEngine.setVolume('music', Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-[10px] vtt-muted tabular-nums w-8 text-right">
              {Math.round(volumes.music * 100)}%
            </span>
          </label>
        </div>

        {/* Active Ambience Row */}
        <div className="p-2.5 border vtt-border vtt-canvas space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <CloudRain className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider vtt-muted">Ambiente</p>
                <p className="text-xs font-semibold truncate">
                  {activeAmbTrack ? activeAmbTrack.name : 'Nenhum tocando'}
                </p>
              </div>
            </div>
            {activeAmbTrack && (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    audioEngine.togglePauseLayer('ambience');
                    onSyncAudioUi();
                  }}
                  className="p-1.5 vtt-accent-btn"
                  title={activeIds.ambiencePaused ? 'Retomar (fade in)' : 'Pausar (fade out)'}
                >
                  {activeIds.ambiencePaused ? (
                    <Play className="w-3 h-3" />
                  ) : (
                    <Pause className="w-3 h-3" />
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    audioEngine.stopLayer('ambience');
                    onSyncAudioUi();
                  }}
                  className="p-1.5 border vtt-border vtt-surface hover:opacity-80"
                  title="Parar ambiente (fade out)"
                >
                  <Square className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {activeAmbTrack && ambTiming && ambTiming.duration > 0 && (
            <div className="space-y-1">
              <input
                type="range"
                min={0}
                max={Math.floor(ambTiming.duration)}
                value={Math.min(Math.floor(ambTiming.duration), Math.floor(ambTiming.currentTime))}
                onChange={(e) => audioEngine.seekLayer('ambience', Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between text-[10px] vtt-muted tabular-nums">
                <span>{formatClock(ambTiming.currentTime)}</span>
                <span>{formatClock(ambTiming.duration)}</span>
              </div>
            </div>
          )}

          <label className="flex items-center gap-2">
            <span className="text-[10px] vtt-muted w-12 shrink-0">Vol.</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={volumes.ambience}
              onChange={(e) => audioEngine.setVolume('ambience', Number(e.target.value))}
              className="flex-1"
            />
            <span className="text-[10px] vtt-muted tabular-nums w-8 text-right">
              {Math.round(volumes.ambience * 100)}%
            </span>
          </label>
        </div>

        {/* Collapsible Real-Time DSP Effects */}
        {hasAnyActive && (
          <div className="border vtt-border vtt-canvas">
            <button
              type="button"
              onClick={() => setShowDsp((v) => !v)}
              className="w-full px-2.5 py-2 flex items-center justify-between text-[11px] font-semibold hover:vtt-subtle"
            >
              <span className="flex items-center gap-1.5">
                <Sliders className="w-3.5 h-3.5 vtt-accent-text" />
                Efeitos em Tempo Real (DSP)
              </span>
              {showDsp ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>

            {showDsp && (
              <div className="px-2.5 pb-2.5 pt-1 border-t vtt-border space-y-2.5">
                {activeMusicTrack && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider vtt-muted">
                        Música
                      </span>
                      <button
                        type="button"
                        onClick={() => updateDspLive('music', DEFAULT_AUDIO_DSP)}
                        className="text-[10px] vtt-muted hover:underline flex items-center gap-0.5"
                      >
                        <RotateCcw className="w-2.5 h-2.5" /> Resetar
                      </button>
                    </div>
                    <label className="flex items-center gap-2 text-[10px]">
                      <span className="w-16 vtt-muted">Velocidade</span>
                      <input
                        type="range"
                        min={0.5}
                        max={2}
                        step={0.05}
                        value={musicDsp.speed}
                        onChange={(e) => updateDspLive('music', { speed: Number(e.target.value) })}
                        className="flex-1"
                      />
                      <span className="w-8 text-right tabular-nums">{musicDsp.speed.toFixed(2)}x</span>
                    </label>
                    <label className="flex items-center gap-2 text-[10px]">
                      <span className="w-16 vtt-muted">Tom</span>
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={1}
                        value={musicDsp.pitch}
                        onChange={(e) => updateDspLive('music', { pitch: Number(e.target.value) })}
                        className="flex-1"
                      />
                      <span className="w-8 text-right tabular-nums">
                        {musicDsp.pitch > 0 ? `+${musicDsp.pitch}` : musicDsp.pitch}
                      </span>
                    </label>
                    <label className="flex items-center gap-2 text-[10px]">
                      <span className="w-16 vtt-muted">Abafado</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={musicDsp.muffle}
                        onChange={(e) => updateDspLive('music', { muffle: Number(e.target.value) })}
                        className="flex-1"
                      />
                      <span className="w-8 text-right tabular-nums">{musicDsp.muffle}%</span>
                    </label>
                  </div>
                )}

                {activeAmbTrack && (
                  <div className="space-y-1.5 border-t vtt-border pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider vtt-muted">
                        Ambiente
                      </span>
                      <button
                        type="button"
                        onClick={() => updateDspLive('ambience', DEFAULT_AUDIO_DSP)}
                        className="text-[10px] vtt-muted hover:underline flex items-center gap-0.5"
                      >
                        <RotateCcw className="w-2.5 h-2.5" /> Resetar
                      </button>
                    </div>
                    <label className="flex items-center gap-2 text-[10px]">
                      <span className="w-16 vtt-muted">Velocidade</span>
                      <input
                        type="range"
                        min={0.5}
                        max={2}
                        step={0.05}
                        value={ambDsp.speed}
                        onChange={(e) => updateDspLive('ambience', { speed: Number(e.target.value) })}
                        className="flex-1"
                      />
                      <span className="w-8 text-right tabular-nums">{ambDsp.speed.toFixed(2)}x</span>
                    </label>
                    <label className="flex items-center gap-2 text-[10px]">
                      <span className="w-16 vtt-muted">Abafado</span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={ambDsp.muffle}
                        onChange={(e) => updateDspLive('ambience', { muffle: Number(e.target.value) })}
                        className="flex-1"
                      />
                      <span className="w-8 text-right tabular-nums">{ambDsp.muffle}%</span>
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Collapsible Master Standard & Auto-Play */}
        <div className="border vtt-border vtt-canvas">
          <button
            type="button"
            onClick={() => setShowMaster((v) => !v)}
            className="w-full px-2.5 py-2 flex items-center justify-between text-[11px] font-semibold hover:vtt-subtle"
          >
            <span className="flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 vtt-accent-text" />
              Master & Padrão ({Math.round(volumes.master * 100)}%)
            </span>
            {showMaster ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {showMaster && (
            <div className="px-2.5 pb-2.5 pt-1.5 border-t vtt-border space-y-2">
              <label className="flex items-center gap-2 text-[10px]">
                <span className="w-14 font-semibold">Master</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={volumes.master}
                  onChange={(e) => audioEngine.setMasterVolume(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="w-8 text-right tabular-nums">{Math.round(volumes.master * 100)}%</span>
              </label>

              <label className="flex items-center gap-2 text-[10px]">
                <span className="w-14 vtt-muted">SFX</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={volumes.sfx}
                  onChange={(e) => audioEngine.setVolume('sfx', Number(e.target.value))}
                  className="flex-1"
                />
                <span className="w-8 text-right tabular-nums">{Math.round(volumes.sfx * 100)}%</span>
              </label>

              <label className="flex items-center justify-between gap-2 pt-1 cursor-pointer">
                <span className="text-[10px]">Áudio automático nas cenas</span>
                <input
                  type="checkbox"
                  checked={autoPlay}
                  onChange={(e) => {
                    audioEngine.setAutoPlayEnabled(e.target.checked);
                    onNotify?.(
                      e.target.checked
                        ? 'Áudio automático nas cenas e combates ativado.'
                        : 'Áudio automático desligado: suas faixas continuam tocando ao trocar de cena.'
                    );
                  }}
                />
              </label>

              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    audioEngine.saveMasterDefaults();
                    onNotify?.('Volumes atuais salvos como padrão Master!');
                  }}
                  className="py-1.5 px-2 text-[10px] font-semibold vtt-accent-btn flex items-center justify-center gap-1"
                >
                  <Save className="w-3 h-3" />
                  Salvar Padrão
                </button>
                <button
                  type="button"
                  onClick={() => {
                    audioEngine.applyMasterDefaults();
                    onNotify?.('Padrão Master restaurado.');
                  }}
                  className="py-1.5 px-2 text-[10px] border vtt-border vtt-surface hover:opacity-80 flex items-center justify-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" />
                  Aplicar Padrão
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
