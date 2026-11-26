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
  private pausedLayers: Record<'music' | 'ambience', boolean> = {
    music: false,
    ambience: false,
  };
  private activeSfx = new Set<LayerNode>();

  private activeMusicTrackId: string | null = null;
  private activeAmbienceTrackId: string | null = null;

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

  private clearNodeFade(node: LayerNode | null) {
    if (!node || typeof node.fadeTimerId !== 'number') return;
    window.clearInterval(node.fadeTimerId);
    node.fadeTimerId = undefined;
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
    } else {
      this.activeAmbienceTrackId = null;
    }

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
    } else {
      this.stopLayer(track.layer, 480);
      this.layers[track.layer] = node;
      this.pausedLayers[track.layer] = false;
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
        this.fadeNodeTo(node, this.effectiveVolume('sfx'), 140);
        return;
      }

      const layer: 'music' | 'ambience' = track.layer;
      // Smoothly crossfade out any previous track on this layer
      this.stopLayer(layer, 480);
      this.layers[layer] = node;
      this.pausedLayers[layer] = false;
      if (layer === 'music') this.activeMusicTrackId = track.id;
      else this.activeAmbienceTrackId = track.id;

      this.setNodeVolumeImmediate(node, 0.01);
      await node.el.play();
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
