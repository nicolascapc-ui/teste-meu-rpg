import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { ColorFilterPreset, SceneEffects } from '../types/vtt';

interface SceneEffectsStageProps {
  effects: SceneEffects;
  shakePulseMs?: number;
  className?: string;
  children: ReactNode;
}

function buildCssFilter(effects: SceneEffects): string {
  const parts: string[] = [];

  const colorMap: Record<ColorFilterPreset, string> = {
    none: '',
    sepia: 'sepia(0.75)',
    noir: 'grayscale(0.98) contrast(1.1)',
    cold: 'hue-rotate(175deg) saturate(0.88) brightness(0.94)',
    warm: 'sepia(0.32) hue-rotate(-10deg) saturate(1.22)',
    high_contrast: 'contrast(1.3) saturate(1.12)',
  };

  if (effects.colorFilter && effects.colorFilter !== 'none') {
    parts.push(colorMap[effects.colorFilter]);
  }
  if (effects.saturation !== 100) {
    parts.push(`saturate(${Math.max(0, Math.min(200, effects.saturation)) / 100})`);
  }
  if (effects.contrast !== 100) {
    parts.push(`contrast(${Math.max(50, Math.min(180, effects.contrast)) / 100})`);
  }

  return parts.length > 0 ? parts.join(' ') : 'none';
}

export function SceneEffectsStage({
  effects,
  shakePulseMs = 0,
  className = '',
  children,
}: SceneEffectsStageProps) {
  const [pulseActive, setPulseActive] = useState(false);

  useEffect(() => {
    if (!shakePulseMs) return;
    // Trigger if pulse happened within the last 3 seconds (prevents stale pulse on page reload)
    if (Date.now() - shakePulseMs > 3000) return;
    setPulseActive(true);
    const timer = window.setTimeout(() => setPulseActive(false), 760);
    return () => window.clearTimeout(timer);
  }, [shakePulseMs]);

  const effectiveShake = pulseActive ? Math.max(effects.shake, 92) : effects.shake;
  const shakePx = Math.max(1.8, (effectiveShake / 100) * 13).toFixed(1);
  const filterCss = buildCssFilter(effects);

  const stageStyle = {
    '--fx-shake-px': `${shakePx}px`,
  } as CSSProperties;

  const crtOpacity = Math.max(0, Math.min(1, effects.crt / 100));
  const noiseOpacity = Math.max(0, Math.min(0.42, (effects.noise / 100) * 0.38));
  const glitchOpacity = Math.max(0, Math.min(0.92, (effects.glitch / 100) * 0.92));
  const bloodOpacity = Math.max(0, Math.min(0.95, (effects.bloodDanger / 100) * 0.95));
  const vignetteOpacity = Math.max(0, Math.min(0.9, (effects.vignette / 100) * 0.88));

  return (
    <div
      className={`relative overflow-hidden ${effectiveShake > 0 ? 'fx-shake-active' : ''} ${className}`}
      style={stageStyle}
    >
      {/* Isolated Scene Content with Live Color/Contrast/Saturation Filter */}
      <div
        className="w-full h-full relative"
        style={{
          isolation: 'isolate',
          filter: filterCss,
          transition: 'filter 180ms ease',
        }}
      >
        {children}
      </div>

      {/* Vignette Layer */}
      {vignetteOpacity > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[35]"
          style={{
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,${vignetteOpacity}) 100%)`,
          }}
        />
      )}

      {/* CRT Scanlines + Phosphor Curve Layer */}
      {crtOpacity > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[35] fx-crt-scanlines"
          style={{ '--fx-crt-opacity': crtOpacity } as CSSProperties}
        />
      )}

      {/* Film Noise Looping Layer */}
      {noiseOpacity > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -inset-4 z-[35] fx-noise-layer"
          style={{ opacity: noiseOpacity }}
        />
      )}

      {/* Glitch Chromatic Lines + Rolling Interference Bar */}
      {glitchOpacity > 0 && (
        <>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[35] fx-glitch-layer"
            style={{ '--fx-glitch-opacity': glitchOpacity } as CSSProperties}
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 h-16 z-[35] fx-glitch-bar"
            style={{ opacity: glitchOpacity * 0.75 }}
          />
        </>
      )}

      {/* Pulsing Blood / Danger Vignette Layer */}
      {bloodOpacity > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[35] fx-blood-vignette"
          style={{ '--fx-blood-opacity': bloodOpacity } as CSSProperties}
        />
      )}
    </div>
  );
}
