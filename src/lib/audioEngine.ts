import { resolveMediaUrl } from './mediaStore';
import {
  DEFAULT_AUDIO_DSP,
  type AudioDspSettings,
  type AudioLayer,
  type AudioTrack,
  type LiveAudioLayerSnapshot,
  type LiveAudioSfxPulse,
  type LiveAudioState,
} from '../types/vtt';

export interface MixerVolumes {
  master: number;
  music: number;
  ambience: number;
  sfx: number;
  muted: boolean;
}

export interface AudioMasterDefaults {
  master: number;
  music: number;
  ambience: number;
  sfx: number;
}

const STORAGE_MASTER_KEY = 'folio_audio_master_defaults_v1';
const STORAGE_AUTOPLAY_KEY = 'folio_audio_autoplay_v1';

const FALLBACK_MASTER_DEFAULTS: AudioMasterDefaults = {
  master: 1,
  music: 0.55,
  ambience: 0.45,
  sfx: 0.85,
};

function readStoredMasterDefaults(): AudioMasterDefaults {
  if (typeof window === 'undefined') return { ...FALLBACK_MASTER_DEFAULTS };
  try {
    const raw = window.localStorage.getItem(STORAGE_MASTER_KEY);
    if (!raw) return { ...FALLBACK_MASTER_DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<AudioMasterDefaults>;
    return {
      master: typeof parsed.master === 'number' ? Math.max(0, Math.min(1, parsed.master)) : 1,
      music: typeof parsed.music === 'number' ? Math.max(0, Math.min(1, parsed.music)) : 0.55,
      ambience:
        typeof parsed.ambience === 'number' ? Math.max(0, Math.min(1, parsed.ambience)) : 0.45,
      sfx: typeof parsed.sfx === 'number' ? Math.max(0, Math.min(1, parsed.sfx)) : 0.85,
    };
  } catch {
    return { ...FALLBACK_MASTER_DEFAULTS };
  }
}

function readStoredAutoPlay(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_AUTOPLAY_KEY);
    if (raw === null) return true;
    return raw !== 'false';
  } catch {
    return true;
  }
}

export interface LayerTimingInfo {
  currentTime: number;
  duration: number;
  isYouTube: boolean;
  supportsFullDsp: boolean;
}

interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  destroy: () => void;
  setVolume: (v: number) => void;
  seekTo: (sec: number, allowSeekAhead?: boolean) => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      height: string;
      width: string;
      videoId: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: (ev: { target: YTPlayerInstance }) => void;
        onStateChange?: (ev: { data: number; target: YTPlayerInstance }) => void;
        onError?: () => void;
      };
    }
  ) => YTPlayerInstance;
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;

function loadYouTubeIframeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) {
        resolve(window.YT);
      } else {
        reject(new Error('YouTube API indisponível.'));
      }
    };

    const existing = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existing) {
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.onerror = () =>
        reject(new Error('Não foi possível carregar o player de áudio do YouTube.'));
      document.head.appendChild(script);
    }

    window.setTimeout(() => {
      if (window.YT?.Player) {
        resolve(window.YT);
      }
    }, 5000);
  });

  return ytApiPromise;
}

export function extractYouTubeIdFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0] || '';
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      const v = u.searchParams.get('v') || '';
      if (/^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed' || parts[0] === 'live') && parts[1]) {
        return /^[a-zA-Z0-9_-]{11}$/.test(parts[1]) ? parts[1] : null;
      }
    }
  } catch {
    return null;
  }
  return null;
}

function muffleToFrequency(mufflePct: number): number {
  const pct = Math.max(0, Math.min(100, mufflePct));
  if (pct <= 0) return 22000;
  return Math.round(20000 * Math.pow(240 / 20000, pct / 100));
}

function applyElementPitchSpeed(el: HTMLMediaElement, dsp: AudioDspSettings) {
  const speed = Math.max(0.5, Math.min(2.0, dsp.speed || 1));
  const pitch = Math.max(-12, Math.min(12, dsp.pitch || 0));
  const anyEl = el as HTMLMediaElement & {
    preservesPitch?: boolean;
    mozPreservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
  };

  if (Math.abs(pitch) < 0.01) {
    anyEl.preservesPitch = true;
    anyEl.mozPreservesPitch = true;
    anyEl.webkitPreservesPitch = true;
    el.playbackRate = speed;
  } else {
    anyEl.preservesPitch = false;
    anyEl.mozPreservesPitch = false;
    anyEl.webkitPreservesPitch = false;
    const pitchRatio = Math.pow(2, pitch / 12);
    el.playbackRate = Math.max(0.25, Math.min(4.0, speed * pitchRatio));
  }
}

interface ActiveMediaNode {
  kind: 'media';
  el: HTMLMediaElement;
  filter: BiquadFilterNode | null;
  gain: GainNode | null;
  source: MediaElementAudioSourceNode | null;
  dsp: AudioDspSettings;
  supportsFullDsp: boolean;
  currentVol: number;
  fadeTimerId?: number;
}

interface ActiveYouTubeNode {
  kind: 'youtube';
  player: YTPlayerInstance;
  hostEl: HTMLDivElement;
  dsp: AudioDspSettings;
  ready: boolean;
  currentVol: number;
  fadeTimerId?: number;
}

type LayerNode = ActiveMediaNode | ActiveYouTubeNode;

class VttAudioEngine {
  private volumes: MixerVolumes = (() => {
    const d = readStoredMasterDefaults();
    return {
      master: d.master,
      music: d.music,
      ambience: d.ambience,
      sfx: d.sfx,
      muted: false,
    };
  })();

  private masterDefaults: AudioMasterDefaults = readStoredMasterDefaults();
  private autoPlayEnabled: boolean = readStoredAutoPlay();
  private listeners = new Set<() => void>();

  private audioCtx: AudioContext | null = null;
  private layers: Record<'music' | 'ambience', LayerNode | null> = {
    music: null,
    ambience: null,
  };
  private pausedLayers: Record<'music' | 'ambience', boolean> = {
    music: false,
    ambience: false,
  };
  private activeSfx = new Set<LayerNode>();

  private activeMusicTrackId: string | null = null;
  private activeAmbienceTrackId: string | null = null;
  private activeMusicTrack: AudioTrack | null = null;
  private activeAmbienceTrack: AudioTrack | null = null;
  private musicStartedAtMs = 0;
  private ambienceStartedAtMs = 0;
  private lastSfxPulse: LiveAudioSfxPulse | null = null;

  // Remote sync tracking (for Second Screen TV & Player devices)
  private appliedRemoteMusicKey = '';
  private appliedRemoteAmbienceKey = '';
  private lastPlayedRemoteSfxId = '';
  private pendingRemoteState: LiveAudioState | null = null;
  private pendingRemoteCampaignId = '';
  private remoteLocalMuted = false;

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        // ignore listener errors
      }
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (Ctx) {
        this.audioCtx = new Ctx();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      void this.audioCtx.resume().catch(() => undefined);
    }
    return this.audioCtx;
  }

  public getVolumes(): MixerVolumes {
    return { ...this.volumes };
  }

  public getMasterDefaults(): AudioMasterDefaults {
    return { ...this.masterDefaults };
  }

  public saveMasterDefaults(next?: Partial<AudioMasterDefaults>): AudioMasterDefaults {
    this.masterDefaults = {
      master: Math.max(0, Math.min(1, next?.master ?? this.volumes.master)),
      music: Math.max(0, Math.min(1, next?.music ?? this.volumes.music)),
      ambience: Math.max(0, Math.min(1, next?.ambience ?? this.volumes.ambience)),
      sfx: Math.max(0, Math.min(1, next?.sfx ?? this.volumes.sfx)),
    };
    try {
      window.localStorage.setItem(STORAGE_MASTER_KEY, JSON.stringify(this.masterDefaults));
    } catch {
      // ignore
    }
    this.emitChange();
    return { ...this.masterDefaults };
  }

  public applyMasterDefaults() {
    this.volumes.master = this.masterDefaults.master;
    this.volumes.music = this.masterDefaults.music;
    this.volumes.ambience = this.masterDefaults.ambience;
    this.volumes.sfx = this.masterDefaults.sfx;
    this.applyVolumes();
    this.emitChange();
  }

  public isAutoPlayEnabled(): boolean {
    return this.autoPlayEnabled;
  }

  public setAutoPlayEnabled(enabled: boolean) {
    this.autoPlayEnabled = enabled;
    try {
      window.localStorage.setItem(STORAGE_AUTOPLAY_KEY, enabled ? 'true' : 'false');
    } catch {
      // ignore
    }
    this.emitChange();
  }

  public getActiveTrackIds() {
    return {
      musicId: this.activeMusicTrackId,
      ambienceId: this.activeAmbienceTrackId,
      musicPaused: this.pausedLayers.music,
      ambiencePaused: this.pausedLayers.ambience,
    };
  }

  public isLayerPaused(layer: 'music' | 'ambience'): boolean {
    return this.pausedLayers[layer];
  }

  public getLayerDsp(layer: 'music' | 'ambience'): AudioDspSettings | null {
    const node = this.layers[layer];
    return node ? { ...node.dsp } : null;
  }

  private buildLayerSnapshot(layer: 'music' | 'ambience'): LiveAudioLayerSnapshot | null {
    const track = layer === 'music' ? this.activeMusicTrack : this.activeAmbienceTrack;
    const node = this.layers[layer];
    if (!track || !node) return null;
    return {
      trackId: track.id,
      name: (track.name || '').slice(0, 100),
      sourceType: track.sourceType,
      url: (track.url || '').slice(0, 1024),
      mediaId: (track.mediaId || '').slice(0, 128),
      dsp: {
        startSec: Number(node.dsp.startSec) || 0,
        speed: Number(node.dsp.speed) || 1,
        pitch: Number(node.dsp.pitch) || 0,
        muffle: Number(node.dsp.muffle) || 0,
      },
      paused: Boolean(this.pausedLayers[layer]),
      startedAtMs: layer === 'music' ? this.musicStartedAtMs : this.ambienceStartedAtMs,
    };
  }

  public getLiveAudioSnapshot(): LiveAudioState {
    return {
      music: this.buildLayerSnapshot('music'),
      ambience: this.buildLayerSnapshot('ambience'),
      sfxPulse: this.lastSfxPulse ? { ...this.lastSfxPulse } : null,
      volumes: {
        master: Math.max(0, Math.min(1, this.volumes.master)),
        music: Math.max(0, Math.min(1, this.volumes.music)),
        ambience: Math.max(0, Math.min(1, this.volumes.ambience)),
        sfx: Math.max(0, Math.min(1, this.volumes.sfx)),
        muted: Boolean(this.volumes.muted),
      },
      updatedAtMs: Date.now(),
    };
  }

  public async applyRemoteAudioState(
    remote: LiveAudioState | null | undefined,
    campaignId: string,
    opts?: { localMuted?: boolean }
  ): Promise<{ blockedByAutoplay: boolean }> {
    const localMuted = Boolean(opts?.localMuted);
    this.remoteLocalMuted = localMuted;
    this.pendingRemoteCampaignId = campaignId;

    if (!remote) {
      this.pendingRemoteState = null;
      if (this.activeMusicTrackId) {
        this.stopLayer('music', 320);
        this.appliedRemoteMusicKey = '';
      }
      if (this.activeAmbienceTrackId) {
        this.stopLayer('ambience', 320);
        this.appliedRemoteAmbienceKey = '';
      }
      return { blockedByAutoplay: false };
    }

    this.pendingRemoteState = remote;

    // 1. Sync volumes & mute immediately
    const v = remote.volumes;
    if (v) {
      this.volumes.master = Math.max(0, Math.min(1, Number(v.master ?? 1)));
      this.volumes.music = Math.max(0, Math.min(1, Number(v.music ?? 0.55)));
      this.volumes.ambience = Math.max(0, Math.min(1, Number(v.ambience ?? 0.45)));
      this.volumes.sfx = Math.max(0, Math.min(1, Number(v.sfx ?? 0.85)));
      this.volumes.muted = Boolean(v.muted) || localMuted;
      this.applyVolumes();
    }

    let blockedByAutoplay = false;

    const syncContinuousLayer = async (
      layer: 'music' | 'ambience',
      snap: LiveAudioLayerSnapshot | null
    ) => {
      const prevKey = layer === 'music' ? this.appliedRemoteMusicKey : this.appliedRemoteAmbienceKey;
      const setKey = (k: string) => {
        if (layer === 'music') this.appliedRemoteMusicKey = k;
        else this.appliedRemoteAmbienceKey = k;
      };

      if (!snap) {
        if (this.layers[layer]) {
          this.stopLayer(layer, 360);
        }
        setKey('');
        return;
      }

      const targetKey = `${snap.trackId}::${snap.startedAtMs}`;
      const isSameTrack = prevKey === targetKey && Boolean(this.layers[layer]);

      if (!isSameTrack) {
        if (snap.paused) {
          // Track is paused on GM side — don't start noisy playback yet, remember key only once unpaused
          if (this.layers[layer]) {
            this.stopLayer(layer, 260);
          }
          setKey('');
          return;
        }
        const syntheticTrack: AudioTrack = {
          id: snap.trackId,
          campaignId,
          gmUid: '',
          name: snap.name || 'Faixa',
          layer,
          sourceType: snap.sourceType,
          synthPreset: '',
          url: snap.url || '',
          mediaId: snap.mediaId || '',
          dsp: { ...DEFAULT_AUDIO_DSP, ...(snap.dsp || {}) },
          createdAt: Date.now(),
        };
        try {
          await this.playTrack(syntheticTrack, campaignId);
          setKey(targetKey);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const name = err instanceof Error ? err.name : '';
          if (
            name === 'NotAllowedError' ||
            /notallowed|autoplay|user gesture|play\(\) failed/i.test(msg)
          ) {
            blockedByAutoplay = true;
          }
        }
        return;
      }

      // Same track already playing locally: sync pause/resume & live DSP
      if (snap.paused && !this.pausedLayers[layer]) {
        this.pauseLayer(layer, 360);
      } else if (!snap.paused && this.pausedLayers[layer]) {
        try {
          this.resumeLayer(layer, 420);
        } catch {
          blockedByAutoplay = true;
        }
      }

      const currentNode = this.layers[layer];
      if (currentNode && snap.dsp) {
        const cur = currentNode.dsp;
        if (
          Math.abs((cur.speed || 1) - (snap.dsp.speed || 1)) > 0.01 ||
          Math.abs((cur.pitch || 0) - (snap.dsp.pitch || 0)) > 0.05 ||
          Math.abs((cur.muffle || 0) - (snap.dsp.muffle || 0)) > 0.5
        ) {
          this.updateLiveDsp(layer, {
            ...DEFAULT_AUDIO_DSP,
            ...snap.dsp,
          });
        }
      }
    };

    await syncContinuousLayer('music', remote.music);
    await syncContinuousLayer('ambience', remote.ambience);

    // 2. Sync one-shot SFX pulses (only if recent < 6.5s and not yet played)
    const pulse = remote.sfxPulse;
    if (
      pulse &&
      pulse.id &&
      pulse.id !== this.lastPlayedRemoteSfxId &&
      Date.now() - pulse.triggeredAtMs < 6500 &&
      !localMuted &&
      !remote.volumes?.muted
    ) {
      this.lastPlayedRemoteSfxId = pulse.id;
      const sfxTrack: AudioTrack = {
        id: pulse.trackId || pulse.id,
        campaignId,
        gmUid: '',
        name: pulse.name || 'SFX',
        layer: 'sfx',
        sourceType: pulse.sourceType,
        synthPreset: '',
        url: pulse.url || '',
        mediaId: pulse.mediaId || '',
        dsp: { ...DEFAULT_AUDIO_DSP, ...(pulse.dsp || {}) },
        createdAt: Date.now(),
      };
      try {
        await this.playTrack(sfxTrack, campaignId);
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotAllowedError') {
          blockedByAutoplay = true;
        }
      }
    }

    return { blockedByAutoplay };
  }

  public async unlockAutoplay(): Promise<{ blockedByAutoplay: boolean }> {
    const ctx = this.ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        // ignore
      }
    }
    if (this.pendingRemoteState && this.pendingRemoteCampaignId) {
      // Force retry any layer that failed to start due to autoplay
      if (!this.layers.music) this.appliedRemoteMusicKey = '';
      if (!this.layers.ambience) this.appliedRemoteAmbienceKey = '';
      return this.applyRemoteAudioState(
        this.pendingRemoteState,
        this.pendingRemoteCampaignId,
        { localMuted: this.remoteLocalMuted }
      );
    }
    return { blockedByAutoplay: false };
  }

  private clearNodeFade(node: LayerNode | null) {
    if (!node || typeof node.fadeTimerId !== 'number') return;
    window.clearInterval(node.fadeTimerId);
    node.fadeTimerId = undefined;
  }

  private effectiveVolume(layer: AudioLayer): number {
    if (this.volumes.muted) return 0;
    return Math.max(0, Math.min(1, this.volumes[layer] * this.volumes.master));
  }

  public setMasterVolume(value: number) {
    this.volumes.master = Math.max(0, Math.min(1, value));
    this.applyVolumes();
    this.emitChange();
  }

  public setVolume(layer: AudioLayer, value: number) {
    this.volumes[layer] = Math.max(0, Math.min(1, value));
    this.applyVolumes();
    this.emitChange();
  }

  public setMuted(muted: boolean) {
    this.volumes.muted = muted;
    this.applyVolumes();
    this.emitChange();
  }

  private setNodeVolumeImmediate(node: LayerNode, vol: number) {
    const clamped = Math.max(0, Math.min(1, vol));
    node.currentVol = clamped;
    if (node.kind === 'youtube') {
      if (node.ready) {
        try {
          node.player.setVolume(Math.round(clamped * 100));
        } catch {
          // ignore
        }
      }
      return;
    }
    if (node.gain && this.audioCtx) {
      node.gain.gain.setTargetAtTime(clamped, this.audioCtx.currentTime, 0.025);
      node.el.volume = 1;
    } else {
      node.el.volume = clamped;
    }
  }

  /**
   * Smoothly interpolates a node's volume from its current level to targetVol
   * for subtle, musical fade-in and fade-out transitions on Play, Pause, and Stop.
   */
  private fadeNodeTo(
    node: LayerNode,
    targetVol: number,
    durationMs: number,
    onDone?: () => void
  ) {
    this.clearNodeFade(node);
    const startVol = Number.isFinite(node.currentVol) ? node.currentVol : 0;
    const goal = Math.max(0, Math.min(1, targetVol));

    if (durationMs <= 16 || Math.abs(goal - startVol) < 0.008) {
      this.setNodeVolumeImmediate(node, goal);
      onDone?.();
      return;
    }

    const steps = Math.max(8, Math.min(28, Math.round(durationMs / 24)));
    const stepMs = Math.max(16, Math.round(durationMs / steps));
    let step = 0;

    node.fadeTimerId = window.setInterval(() => {
      step += 1;
      const t = Math.min(1, step / steps);
      // Smooth ease-in-out curve for natural auditory fade
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const nextVol = startVol + (goal - startVol) * eased;
      this.setNodeVolumeImmediate(node, nextVol);

      if (t >= 1) {
        this.clearNodeFade(node);
        this.setNodeVolumeImmediate(node, goal);
        onDone?.();
      }
    }, stepMs);
  }

  private applyVolumes() {
    if (this.layers.music && !this.pausedLayers.music) {
      this.fadeNodeTo(this.layers.music, this.effectiveVolume('music'), 180);
    }
    if (this.layers.ambience && !this.pausedLayers.ambience) {
      this.fadeNodeTo(this.layers.ambience, this.effectiveVolume('ambience'), 180);
    }
    for (const sfx of this.activeSfx) {
      this.setNodeVolumeImmediate(sfx, this.effectiveVolume('sfx'));
    }
  }

  private destroyNode(node: LayerNode | null) {
    if (!node) return;
    this.clearNodeFade(node);
    if (node.kind === 'youtube') {
      try {
        node.player.stopVideo();
        node.player.destroy();
      } catch {
        // ignore
      }
      node.hostEl.remove();
      return;
    }
    try {
      node.el.pause();
      node.el.currentTime = 0;
      node.el.removeAttribute('src');
      node.el.load();
      node.source?.disconnect();
      node.filter?.disconnect();
      node.gain?.disconnect();
    } catch {
      // ignore
    }
  }

  /**
   * Pauses a layer with a subtle fade-out (~440ms) before pausing playback.
   */
  public pauseLayer(layer: 'music' | 'ambience', fadeMs = 440) {
    const node = this.layers[layer];
    if (!node || this.pausedLayers[layer]) return;
    this.pausedLayers[layer] = true;
    this.emitChange();

    this.fadeNodeTo(node, 0, fadeMs, () => {
      if (this.layers[layer] !== node || !this.pausedLayers[layer]) return;
      if (node.kind === 'youtube') {
        if (node.ready) {
          try {
            node.player.pauseVideo();
          } catch {
            // ignore
          }
        }
      } else {
        try {
          node.el.pause();
        } catch {
          // ignore
        }
      }
    });
  }

  /**
   * Resumes a paused layer with a subtle fade-in (~540ms).
   */
  public resumeLayer(layer: 'music' | 'ambience', fadeMs = 540) {
    const node = this.layers[layer];
    if (!node || !this.pausedLayers[layer]) return;
    this.pausedLayers[layer] = false;
    this.emitChange();

    this.setNodeVolumeImmediate(node, 0.01);
    if (node.kind === 'youtube') {
      if (node.ready) {
        try {
          node.player.playVideo();
        } catch {
          // ignore
        }
      }
    } else {
      void node.el.play().catch(() => {});
    }

    this.fadeNodeTo(node, this.effectiveVolume(layer), fadeMs);
  }

  public togglePauseLayer(layer: 'music' | 'ambience') {
    if (this.pausedLayers[layer]) {
      this.resumeLayer(layer);
    } else {
      this.pauseLayer(layer);
    }
  }

  /**
   * Stops a layer with a subtle fade-out (~480ms) before releasing resources.
   * Detaches the node immediately so a new track can crossfade in concurrently.
   */
  public stopLayer(layer: 'music' | 'ambience', fadeMs = 480) {
    const oldNode = this.layers[layer];
    this.layers[layer] = null;
    this.pausedLayers[layer] = false;

    if (layer === 'music') {
      this.activeMusicTrackId = null;
      this.activeMusicTrack = null;
      this.musicStartedAtMs = 0;
    } else {
      this.activeAmbienceTrackId = null;
      this.activeAmbienceTrack = null;
      this.ambienceStartedAtMs = 0;
    }
    this.emitChange();

    if (!oldNode) return;
    if (fadeMs <= 0) {
      this.destroyNode(oldNode);
      return;
    }

    this.fadeNodeTo(oldNode, 0, fadeMs, () => {
      this.destroyNode(oldNode);
    });
  }

  public stopAll(fadeMs = 460) {
    this.stopLayer('music', fadeMs);
    this.stopLayer('ambience', fadeMs);
    const sfxNodes = Array.from(this.activeSfx);
    this.activeSfx.clear();
    for (const sfx of sfxNodes) {
      this.fadeNodeTo(sfx, 0, Math.min(320, fadeMs), () => {
        this.destroyNode(sfx);
      });
    }
  }

  public updateLiveDsp(layer: 'music' | 'ambience', dsp: AudioDspSettings) {
    const node = this.layers[layer];
    if (!node) return;
    node.dsp = { ...dsp };
    this.emitChange();

    if (node.kind === 'youtube') {
      if (node.ready) {
        try {
          node.player.setPlaybackRate(Math.max(0.5, Math.min(2, dsp.speed || 1)));
        } catch {
          // ignore
        }
      }
      return;
    }

    applyElementPitchSpeed(node.el, dsp);
    if (node.filter && this.audioCtx) {
      node.filter.frequency.setTargetAtTime(
        muffleToFrequency(dsp.muffle),
        this.audioCtx.currentTime,
        0.04
      );
    }
  }

  public seekLayer(layer: 'music' | 'ambience', seconds: number) {
    const node = this.layers[layer];
    if (!node) return;
    const sec = Math.max(0, seconds);
    if (node.kind === 'youtube') {
      if (node.ready) {
        try {
          node.player.seekTo(sec, true);
        } catch {
          // ignore
        }
      }
      return;
    }
    try {
      node.el.currentTime = sec;
    } catch {
      // ignore
    }
  }

  public getLayerTiming(layer: 'music' | 'ambience'): LayerTimingInfo | null {
    const node = this.layers[layer];
    if (!node) return null;
    if (node.kind === 'youtube') {
      if (!node.ready) {
        return { currentTime: 0, duration: 0, isYouTube: true, supportsFullDsp: false };
      }
      try {
        return {
          currentTime: Number(node.player.getCurrentTime()) || 0,
          duration: Number(node.player.getDuration()) || 0,
          isYouTube: true,
          supportsFullDsp: false,
        };
      } catch {
        return { currentTime: 0, duration: 0, isYouTube: true, supportsFullDsp: false };
      }
    }
    return {
      currentTime: Number.isFinite(node.el.currentTime) ? node.el.currentTime : 0,
      duration: Number.isFinite(node.el.duration) ? node.el.duration : 0,
      isYouTube: false,
      supportsFullDsp: node.supportsFullDsp,
    };
  }

  private createMediaNode(
    resolvedUrl: string,
    dsp: AudioDspSettings,
    loop: boolean,
    allowCorsDsp: boolean
  ): ActiveMediaNode {
    const isVideoSrc = /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(resolvedUrl);
    const el: HTMLMediaElement = isVideoSrc ? document.createElement('video') : new Audio();

    if (allowCorsDsp && !resolvedUrl.startsWith('blob:')) {
      el.crossOrigin = 'anonymous';
    }
    el.src = resolvedUrl;
    el.loop = loop;
    el.preload = 'auto';
    applyElementPitchSpeed(el, dsp);

    let filter: BiquadFilterNode | null = null;
    let gain: GainNode | null = null;
    let source: MediaElementAudioSourceNode | null = null;
    let supportsFullDsp = false;

    const ctx = this.ensureAudioContext();
    if (ctx && allowCorsDsp) {
      try {
        source = ctx.createMediaElementSource(el);
        filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 1.1;
        filter.frequency.value = muffleToFrequency(dsp.muffle);
        gain = ctx.createGain();
        gain.gain.value = 0;
        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        supportsFullDsp = true;
      } catch {
        source = null;
        filter = null;
        gain = null;
        supportsFullDsp = false;
      }
    }

    return {
      kind: 'media',
      el,
      filter,
      gain,
      source,
      dsp: { ...dsp },
      supportsFullDsp,
      currentVol: 0,
    };
  }

  private async playYouTubeTrack(track: AudioTrack, dsp: AudioDspSettings): Promise<void> {
    const videoId = extractYouTubeIdFromUrl(track.url);
    if (!videoId) {
      throw new Error('Link do YouTube inválido.');
    }

    const YT = await loadYouTubeIframeApi();
    const hostEl = document.createElement('div');
    hostEl.style.position = 'fixed';
    hostEl.style.left = '-9999px';
    hostEl.style.top = '-9999px';
    hostEl.style.width = '1px';
    hostEl.style.height = '1px';
    hostEl.style.opacity = '0';
    hostEl.style.pointerEvents = 'none';
    const mount = document.createElement('div');
    hostEl.appendChild(mount);
    document.body.appendChild(hostEl);

    const isLoop = track.layer !== 'sfx';
    const startSec = Math.max(0, Math.floor(dsp.startSec || 0));

    const node: ActiveYouTubeNode = {
      kind: 'youtube',
      player: null as unknown as YTPlayerInstance,
      hostEl,
      dsp: { ...dsp },
      ready: false,
      currentVol: 0,
    };

    if (track.layer === 'sfx') {
      this.activeSfx.add(node);
      this.lastSfxPulse = {
        id: `sfx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        trackId: track.id,
        name: (track.name || 'SFX').slice(0, 100),
        sourceType: track.sourceType,
        url: (track.url || '').slice(0, 1024),
        mediaId: (track.mediaId || '').slice(0, 128),
        dsp: { ...dsp },
        triggeredAtMs: Date.now(),
      };
      this.emitChange();
    } else {
      this.stopLayer(track.layer, 480);
      this.layers[track.layer] = node;
      this.pausedLayers[track.layer] = false;
      if (track.layer === 'music') {
        this.activeMusicTrackId = track.id;
        this.activeMusicTrack = { ...track, dsp: { ...dsp } };
        this.musicStartedAtMs = Date.now();
      } else {
        this.activeAmbienceTrackId = track.id;
        this.activeAmbienceTrack = { ...track, dsp: { ...dsp } };
        this.ambienceStartedAtMs = Date.now();
      }
      this.emitChange();
    }

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const done = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve();
      };

      node.player = new YT.Player(mount, {
        height: '1',
        width: '1',
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          rel: 0,
          start: startSec,
          playsinline: 1,
        },
        events: {
          onReady: (ev) => {
            node.ready = true;
            try {
              // Start at volume 0 and smoothly fade in
              ev.target.setVolume(0);
              if (dsp.speed && dsp.speed !== 1) {
                ev.target.setPlaybackRate(Math.max(0.5, Math.min(2, dsp.speed)));
              }
              if (startSec > 0) {
                ev.target.seekTo(startSec, true);
              }
              ev.target.playVideo();
              this.fadeNodeTo(
                node,
                this.effectiveVolume(track.layer),
                track.layer === 'sfx' ? 140 : 620
              );
            } catch {
              // ignore
            }
            done();
          },
          onStateChange: (ev) => {
            if (ev.data === 0) {
              if (isLoop) {
                ev.target.seekTo(Math.max(0, node.dsp.startSec || 0), true);
                ev.target.playVideo();
              } else {
                this.activeSfx.delete(node);
                this.destroyNode(node);
              }
            }
          },
          onError: () => {
            if (!isLoop) {
              this.activeSfx.delete(node);
            }
            done(new Error('O YouTube bloqueou a reprodução incorporada deste vídeo.'));
          },
        },
      });

      window.setTimeout(() => done(), 4000);
    });
  }

  public async playTrack(track: AudioTrack, campaignId?: string): Promise<void> {
    const dsp: AudioDspSettings = {
      ...DEFAULT_AUDIO_DSP,
      ...(track.dsp || {}),
    };

    if (track.sourceType === 'youtube' || extractYouTubeIdFromUrl(track.url)) {
      await this.playYouTubeTrack(track, dsp);
      return;
    }

    const resolvedUrl = await resolveMediaUrl(
      track.mediaId,
      track.url,
      campaignId || track.campaignId
    );
    if (!resolvedUrl) {
      throw new Error('Arquivo de áudio indisponível. Reenvie ou verifique o link desta faixa.');
    }

    const isSfx = track.layer === 'sfx';
    const isSameOriginOrBlob =
      resolvedUrl.startsWith('blob:') ||
      resolvedUrl.startsWith('/') ||
      resolvedUrl.startsWith(window.location.origin);

    const tryPlay = async (allowCorsDsp: boolean) => {
      const node = this.createMediaNode(resolvedUrl, dsp, !isSfx, allowCorsDsp);

      if (dsp.startSec > 0) {
        node.el.addEventListener(
          'loadedmetadata',
          () => {
            if (Number.isFinite(node.el.duration) && dsp.startSec < node.el.duration) {
              node.el.currentTime = dsp.startSec;
            }
          },
          { once: true }
        );
      }

      if (track.layer === 'sfx') {
        this.setNodeVolumeImmediate(node, 0.02);
        this.activeSfx.add(node);
        const cleanup = () => {
          this.activeSfx.delete(node);
          this.destroyNode(node);
        };
        node.el.addEventListener('ended', cleanup, { once: true });
        node.el.addEventListener('error', cleanup, { once: true });
        await node.el.play();
        if (dsp.startSec > 0 && node.el.readyState >= 1) {
          node.el.currentTime = dsp.startSec;
        }
        this.lastSfxPulse = {
          id: `sfx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          trackId: track.id,
          name: (track.name || 'SFX').slice(0, 100),
          sourceType: track.sourceType,
          url: (track.url || '').slice(0, 1024),
          mediaId: (track.mediaId || '').slice(0, 128),
          dsp: { ...dsp },
          triggeredAtMs: Date.now(),
        };
        this.emitChange();
        this.fadeNodeTo(node, this.effectiveVolume('sfx'), 140);
        return;
      }

      const layer: 'music' | 'ambience' = track.layer;
      // Smoothly crossfade out any previous track on this layer
      this.stopLayer(layer, 480);
      this.layers[layer] = node;
      this.pausedLayers[layer] = false;
      if (layer === 'music') {
        this.activeMusicTrackId = track.id;
        this.activeMusicTrack = { ...track, dsp: { ...dsp } };
        this.musicStartedAtMs = Date.now();
      } else {
        this.activeAmbienceTrackId = track.id;
        this.activeAmbienceTrack = { ...track, dsp: { ...dsp } };
        this.ambienceStartedAtMs = Date.now();
      }
      this.emitChange();

      this.setNodeVolumeImmediate(node, 0.01);
      try {
        await node.el.play();
      } catch (playErr) {
        // Clean up the node if autoplay blocked playback so retry works cleanly
        if (this.layers[layer] === node) {
          this.layers[layer] = null;
          if (layer === 'music') {
            this.activeMusicTrackId = null;
            this.activeMusicTrack = null;
          } else {
            this.activeAmbienceTrackId = null;
            this.activeAmbienceTrack = null;
          }
          this.destroyNode(node);
        }
        throw playErr;
      }
      if (dsp.startSec > 0 && node.el.readyState >= 1) {
        node.el.currentTime = dsp.startSec;
      }
      this.fadeNodeTo(node, this.effectiveVolume(layer), 620);
    };

    try {
      await tryPlay(true);
    } catch (err) {
      if (!isSameOriginOrBlob) {
        await tryPlay(false);
      } else {
        throw err;
      }
    }
  }
}

export const audioEngine = new VttAudioEngine();
