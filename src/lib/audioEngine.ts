import { resolveMediaUrl } from './mediaStore';
import {
  DEFAULT_AUDIO_DSP,
  type AudioDspSettings,
  type AudioLayer,
  type AudioTrack,
} from '../types/vtt';

export interface MixerVolumes {
  music: number;
  ambience: number;
  sfx: number;
  muted: boolean;
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
      script.onerror = () => reject(new Error('Não foi possível carregar o player de áudio do YouTube.'));
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
  // Logarithmic sweep from 20000 Hz (clear) down to 240 Hz (muffled behind wall / underwater)
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
}

interface ActiveYouTubeNode {
  kind: 'youtube';
  player: YTPlayerInstance;
  hostEl: HTMLDivElement;
  dsp: AudioDspSettings;
  ready: boolean;
}

type LayerNode = ActiveMediaNode | ActiveYouTubeNode;

class VttAudioEngine {
  private volumes: MixerVolumes = {
    music: 0.55,
    ambience: 0.45,
    sfx: 0.85,
    muted: false,
  };

  private audioCtx: AudioContext | null = null;
  private layers: Record<'music' | 'ambience', LayerNode | null> = {
    music: null,
    ambience: null,
  };
  private activeSfx = new Set<LayerNode>();
  private fadeTimers = new Map<'music' | 'ambience', number>();

  private activeMusicTrackId: string | null = null;
  private activeAmbienceTrackId: string | null = null;

  private ensureAudioContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.audioCtx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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

  public getActiveTrackIds() {
    return {
      musicId: this.activeMusicTrackId,
      ambienceId: this.activeAmbienceTrackId,
    };
  }

  private clearFade(layer: 'music' | 'ambience') {
    const id = this.fadeTimers.get(layer);
    if (typeof id === 'number') {
      window.clearInterval(id);
      this.fadeTimers.delete(layer);
    }
  }

  private effectiveVolume(layer: AudioLayer): number {
    if (this.volumes.muted) return 0;
    return Math.max(0, Math.min(1, this.volumes[layer]));
  }

  public setVolume(layer: AudioLayer, value: number) {
    this.volumes[layer] = Math.max(0, Math.min(1, value));
    this.applyVolumes();
  }

  public setMuted(muted: boolean) {
    this.volumes.muted = muted;
    this.applyVolumes();
  }

  private setNodeVolume(node: LayerNode, vol: number) {
    const clamped = Math.max(0, Math.min(1, vol));
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
      node.gain.gain.setTargetAtTime(clamped, this.audioCtx.currentTime, 0.03);
      node.el.volume = 1;
    } else {
      node.el.volume = clamped;
    }
  }

  private applyVolumes() {
    if (this.layers.music) {
      this.setNodeVolume(this.layers.music, this.effectiveVolume('music'));
    }
    if (this.layers.ambience) {
      this.setNodeVolume(this.layers.ambience, this.effectiveVolume('ambience'));
    }
    for (const sfx of this.activeSfx) {
      this.setNodeVolume(sfx, this.effectiveVolume('sfx'));
    }
  }

  private destroyNode(node: LayerNode | null) {
    if (!node) return;
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

  public stopLayer(layer: 'music' | 'ambience') {
    this.clearFade(layer);
    this.destroyNode(this.layers[layer]);
    this.layers[layer] = null;
    if (layer === 'music') {
      this.activeMusicTrackId = null;
    } else {
      this.activeAmbienceTrackId = null;
    }
  }

  public stopAll() {
    this.stopLayer('music');
    this.stopLayer('ambience');
    for (const sfx of this.activeSfx) {
      this.destroyNode(sfx);
    }
    this.activeSfx.clear();
  }

  public updateLiveDsp(layer: 'music' | 'ambience', dsp: AudioDspSettings) {
    const node = this.layers[layer];
    if (!node) return;
    node.dsp = { ...dsp };

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

  private fadeInNode(node: LayerNode, layer: 'music' | 'ambience', durationMs = 420) {
    this.clearFade(layer);
    const target = this.effectiveVolume(layer);
    if (target <= 0 || durationMs <= 0) {
      this.setNodeVolume(node, target);
      return;
    }
    this.setNodeVolume(node, 0.01);
    const steps = 14;
    const stepMs = Math.max(16, Math.round(durationMs / steps));
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      const goal = this.effectiveVolume(layer);
      const ratio = Math.min(1, step / steps);
      this.setNodeVolume(node, goal * ratio);
      if (ratio >= 1) {
        this.clearFade(layer);
      }
    }, stepMs);
    this.fadeTimers.set(layer, timer);
  }

  private createMediaNode(
    resolvedUrl: string,
    dsp: AudioDspSettings,
    loop: boolean,
    allowCorsDsp: boolean
  ): ActiveMediaNode {
    // Use <video> element when URL is an external video file so audio plays seamlessly with zero video rendered
    const isVideoSrc = /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(resolvedUrl);
    const el: HTMLMediaElement = isVideoSrc
      ? document.createElement('video')
      : new Audio();

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
    };

    if (track.layer === 'sfx') {
      this.activeSfx.add(node);
    } else {
      this.stopLayer(track.layer);
      this.layers[track.layer] = node;
      if (track.layer === 'music') this.activeMusicTrackId = track.id;
      else this.activeAmbienceTrackId = track.id;
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
              ev.target.setVolume(Math.round(this.effectiveVolume(track.layer) * 100));
              if (dsp.speed && dsp.speed !== 1) {
                ev.target.setPlaybackRate(Math.max(0.5, Math.min(2, dsp.speed)));
              }
              if (startSec > 0) {
                ev.target.seekTo(startSec, true);
              }
              ev.target.playVideo();
            } catch {
              // ignore
            }
            done();
          },
          onStateChange: (ev) => {
            // 0 === YT.PlayerState.ENDED
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
        this.setNodeVolume(node, this.effectiveVolume('sfx'));
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
        return;
      }

      const layer: 'music' | 'ambience' = track.layer;
      this.stopLayer(layer);
      this.layers[layer] = node;
      if (layer === 'music') this.activeMusicTrackId = track.id;
      else this.activeAmbienceTrackId = track.id;

      await node.el.play();
      if (dsp.startSec > 0 && node.el.readyState >= 1) {
        node.el.currentTime = dsp.startSec;
      }
      this.fadeInNode(node, layer, 420);
    };

    try {
      await tryPlay(true);
    } catch (err) {
      // If an external third-party URL fails due to missing CORS headers, fall back cleanly without Web Audio CORS
      if (!isSameOriginOrBlob) {
        await tryPlay(false);
      } else {
        throw err;
      }
    }
  }
}

export const audioEngine = new VttAudioEngine();
