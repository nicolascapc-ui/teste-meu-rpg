import { useCallback, useEffect, useState } from 'react';
import { audioEngine } from '../lib/audioEngine';
import type { LiveAudioState } from '../types/vtt';

interface UseSyncedLiveAudioResult {
  blockedByAutoplay: boolean;
  localMuted: boolean;
  hasActiveAudio: boolean;
  activeTrackLabel: string;
  toggleLocalMute: () => void;
  unlockAudio: () => Promise<void>;
}

/**
 * Keeps Second Screen TV and Player devices synchronized in real-time with
 * the GM's active music, ambience, one-shot SFX pulses, mixer volumes, and DSP.
 */
export function useSyncedLiveAudio(
  campaignId: string,
  liveAudio: LiveAudioState | null | undefined,
  opts?: { defaultLocalMuted?: boolean }
): UseSyncedLiveAudioResult {
  const [localMuted, setLocalMuted] = useState<boolean>(Boolean(opts?.defaultLocalMuted));
  const [blockedByAutoplay, setBlockedByAutoplay] = useState(false);

  const hasActiveAudio = Boolean(
    liveAudio &&
      ((liveAudio.music && !liveAudio.music.paused) ||
        (liveAudio.ambience && !liveAudio.ambience.paused))
  );

  const activeTrackLabel =
    liveAudio?.music && !liveAudio.music.paused
      ? liveAudio.music.name
      : liveAudio?.ambience && !liveAudio.ambience.paused
        ? liveAudio.ambience.name
        : '';

  useEffect(() => {
    if (!campaignId) return;
    let cancelled = false;

    void audioEngine
      .applyRemoteAudioState(liveAudio, campaignId, { localMuted })
      .then((res) => {
        if (!cancelled) {
          setBlockedByAutoplay(res.blockedByAutoplay);
        }
      })
      .catch(() => {
        // ignore network/audio decode errors
      });

    return () => {
      cancelled = true;
    };
  }, [campaignId, liveAudio, localMuted]);

  // Stop remote layers cleanly on unmount
  useEffect(() => {
    return () => {
      audioEngine.stopAll(200);
    };
  }, []);

  const unlockAudio = useCallback(async () => {
    const res = await audioEngine.unlockAutoplay();
    setBlockedByAutoplay(res.blockedByAutoplay);
  }, []);

  // Automatically unlock on the very first pointer/keyboard interaction if blocked
  useEffect(() => {
    if (!blockedByAutoplay) return;
    const handleGesture = () => {
      void unlockAudio();
    };
    window.addEventListener('pointerdown', handleGesture, { once: true });
    window.addEventListener('keydown', handleGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', handleGesture);
      window.removeEventListener('keydown', handleGesture);
    };
  }, [blockedByAutoplay, unlockAudio]);

  const toggleLocalMute = useCallback(() => {
    setLocalMuted((prev) => !prev);
  }, []);

  return {
    blockedByAutoplay,
    localMuted,
    hasActiveAudio,
    activeTrackLabel,
    toggleLocalMute,
    unlockAudio,
  };
}
