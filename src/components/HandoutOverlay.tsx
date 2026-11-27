import { useEffect, useState } from 'react';
import { FileText, Package, RotateCcw, Shield, User, X } from 'lucide-react';
import type { ActiveHandoutProjection } from '../types/vtt';
import { resolveMediaUrl } from '../lib/mediaStore';

interface HandoutOverlayProps {
  campaignId?: string;
  handout: ActiveHandoutProjection | null;
  canDismiss: boolean;
  dismissLabel?: string;
  onDismiss?: () => void;
  onReplay?: () => void;
}

const AMBIENT_MOTES = [
  { left: '12%', bottom: '14%', size: 4, delay: '0.2s', duration: '3.6s' },
  { left: '24%', bottom: '8%', size: 6, delay: '1.1s', duration: '4.2s' },
  { left: '38%', bottom: '18%', size: 3, delay: '0.6s', duration: '3.2s' },
  { left: '54%', bottom: '10%', size: 5, delay: '1.8s', duration: '4.4s' },
  { left: '68%', bottom: '16%', size: 4, delay: '0.9s', duration: '3.7s' },
  { left: '82%', bottom: '12%', size: 5, delay: '1.5s', duration: '4.1s' },
  { left: '90%', bottom: '20%', size: 3, delay: '0.4s', duration: '3.5s' },
];

export function HandoutOverlay({
  campaignId,
  handout,
  canDismiss,
  dismissLabel = 'Fechar',
  onDismiss,
  onReplay,
}: HandoutOverlayProps) {
  const [resolvedUrl, setResolvedUrl] = useState('');
  const [resolvedSpriteUrl, setResolvedSpriteUrl] = useState('');
  const [imgFailed, setImgFailed] = useState(false);
  const [spriteFailed, setSpriteFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setImgFailed(false);
    setSpriteFailed(false);
    if (!handout) {
      setResolvedUrl('');
      setResolvedSpriteUrl('');
      return;
    }
    void resolveMediaUrl(handout.mediaId, handout.imageUrl, campaignId).then((url) => {
      if (active) setResolvedUrl(url);
    });
    if (handout.combatSpriteMediaId || handout.combatSpriteUrl) {
      void resolveMediaUrl(
        handout.combatSpriteMediaId || '',
        handout.combatSpriteUrl || '',
        campaignId
      ).then((url) => {
        if (active) setResolvedSpriteUrl(url);
      });
    } else {
      setResolvedSpriteUrl('');
    }
    return () => {
      active = false;
    };
  }, [handout, campaignId]);

  if (!handout) return null;

  const spotlightMode =
    handout.spotlightMode || (handout.kind === 'npc' ? 'npc' : 'handout');
  const isJrpgShowcase =
    spotlightMode === 'character' ||
    spotlightMode === 'npc' ||
    spotlightMode === 'item';

  const animKey = `${handout.id}_${handout.presentedAtMs || 0}`;

  if (isJrpgShowcase) {
    const isItem = spotlightMode === 'item';
    const hasFullBodySprite = Boolean(resolvedSpriteUrl && !spriteFailed && !isItem);
    const visualUrl = hasFullBodySprite ? resolvedSpriteUrl : resolvedUrl;
    const visualFailed = hasFullBodySprite ? spriteFailed : imgFailed;

    const accent =
      handout.accentColor && handout.accentColor.trim()
        ? handout.accentColor
        : isItem
          ? '#d97706'
          : 'var(--accent-primary)';

    const roleLabel =
      spotlightMode === 'character'
        ? 'Personagem'
        : spotlightMode === 'item'
          ? 'Item & Artefato'
          : 'NPC';

    const subtitleClean = (handout.subtitle || '').trim();
    const bioClean = (handout.body || '').trim();

    return (
      <div
        key={animKey}
        className="fixed inset-0 z-50 overflow-hidden flex items-center justify-center select-none jrpg-backdrop-in"
        style={{
          background:
            'radial-gradient(ellipse at 32% 50%, rgba(22, 18, 16, 0.88) 0%, rgba(7, 7, 9, 0.96) 72%, rgba(0, 0, 0, 0.98) 100%)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={handout.title}
      >
        {/* Cinematic JRPG Letterbox Bars */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 top-0 h-8 sm:h-11 bg-black/95 border-b border-white/10 z-20 jrpg-letterbox-top"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none fixed inset-x-0 bottom-0 h-8 sm:h-11 bg-black/95 border-t border-white/10 z-20 jrpg-letterbox-bottom"
        />

        {/* Diagonal Graphic Cut-In Ribbon */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 -left-16 w-[56%] sm:w-[46%] jrpg-diagonal-ribbon"
          style={{
            background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 34%, transparent) 0%, color-mix(in srgb, ${accent} 10%, transparent) 68%, transparent 100%)`,
            borderRight: `2px solid color-mix(in srgb, ${accent} 65%, transparent)`,
            boxShadow: `inset -24px 0 60px color-mix(in srgb, ${accent} 18%, transparent)`,
          }}
        />

        {/* Secondary Sharp Diagonal Accent Strip */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-[44%] sm:left-[38%] w-3 sm:w-4 jrpg-diagonal-ribbon opacity-65"
          style={{
            backgroundColor: accent,
            animationDelay: '130ms',
          }}
        />

        {/* Rapid Kinetic Slash Streak */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-44 jrpg-slash-streak"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.28) 50%, transparent 100%)',
          }}
        />

        {/* Subtle Rising Light Motes */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          {AMBIENT_MOTES.map((m, idx) => (
            <span
              key={idx}
              className="absolute rounded-full jrpg-mote-rise"
              style={{
                left: m.left,
                bottom: m.bottom,
                width: `${m.size}px`,
                height: `${m.size}px`,
                backgroundColor: idx % 2 === 0 ? accent : '#ffffff',
                boxShadow: `0 0 12px ${accent}`,
                animationDelay: m.delay,
                animationDuration: m.duration,
              }}
            />
          ))}
        </div>

        {/* Top-Right GM Controls (Replay & Close) */}
        {canDismiss && (onDismiss || onReplay) && (
          <div className="fixed top-2.5 sm:top-3 right-4 z-30 flex items-center gap-2">
            {onReplay && (
              <button
                type="button"
                onClick={onReplay}
                className="px-3 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/20 flex items-center gap-1.5 whitespace-nowrap transition-colors"
                title="Reexecutar a animação de entrada na TV"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Replay
              </button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="px-3.5 py-1.5 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap shadow-lg"
              >
                <X className="w-3.5 h-3.5" />
                {dismissLabel}
              </button>
            )}
          </div>
        )}

        {/* Main JRPG Stage Grid */}
        <div className="relative z-10 w-full max-w-6xl mx-auto px-6 sm:px-12 py-14 sm:py-16 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center max-h-[92vh] overflow-y-auto">
          {/* Visual Cut-In Column */}
          <div className="lg:col-span-5 flex items-center justify-center relative">
            {/* Ambient Radial Aura Behind Character / Item */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute w-72 h-72 sm:w-96 sm:h-96 rounded-full blur-3xl opacity-35"
              style={{
                background: `radial-gradient(circle, ${accent} 0%, transparent 70%)`,
              }}
            />

            {isItem && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute w-64 h-64 sm:w-80 sm:h-80 rounded-full border border-dashed opacity-35 jrpg-halo-spin"
                style={{ borderColor: accent }}
              />
            )}

            <div className={`relative ${isItem ? 'jrpg-item-reveal' : 'jrpg-portrait-slam'}`}>
              <div className="jrpg-hero-float">
                {visualUrl && !visualFailed ? (
                  hasFullBodySprite ? (
                    <img
                      src={visualUrl}
                      alt={handout.title}
                      referrerPolicy="no-referrer"
                      onError={() => setSpriteFailed(true)}
                      className="max-h-[64vh] lg:max-h-[74vh] w-auto object-contain select-none"
                      style={{
                        filter: `drop-shadow(0 18px 32px rgba(0,0,0,0.85)) drop-shadow(0 0 24px color-mix(in srgb, ${accent} 45%, transparent))`,
                      }}
                    />
                  ) : isItem ? (
                    <div
                      className="relative w-60 h-60 sm:w-72 sm:h-72 p-4 flex items-center justify-center border bg-black/50 backdrop-blur-sm overflow-hidden shadow-2xl"
                      style={{
                        borderColor: `color-mix(in srgb, ${accent} 70%, rgba(255,255,255,0.2))`,
                        boxShadow: `0 24px 60px rgba(0,0,0,0.8), 0 0 36px color-mix(in srgb, ${accent} 25%, transparent)`,
                        clipPath:
                          'polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px)',
                      }}
                    >
                      <img
                        src={visualUrl}
                        alt={handout.title}
                        referrerPolicy="no-referrer"
                        onError={() => setImgFailed(true)}
                        className="max-w-full max-h-full object-contain"
                      />
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 left-0 w-24 jrpg-flash-sweep"
                        style={{
                          background:
                            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)',
                        }}
                      />
                    </div>
                  ) : (
                    <div
                      className="relative max-w-[320px] sm:max-w-[390px] w-full overflow-hidden border bg-black/45 shadow-2xl"
                      style={{
                        borderColor: `color-mix(in srgb, ${accent} 75%, rgba(255,255,255,0.22))`,
                        boxShadow: `0 26px 64px rgba(0,0,0,0.85), 0 0 34px color-mix(in srgb, ${accent} 28%, transparent)`,
                        clipPath:
                          'polygon(0 0, calc(100% - 22px) 0, 100% 22px, 100% 100%, 22px 100%, 0 calc(100% - 22px))',
                      }}
                    >
                      <img
                        src={visualUrl}
                        alt={handout.title}
                        referrerPolicy="no-referrer"
                        onError={() => setImgFailed(true)}
                        className="w-full max-h-[58vh] lg:max-h-[66vh] object-cover object-top"
                      />
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/75 via-black/20 to-transparent"
                      />
                      <div
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 left-0 w-28 jrpg-flash-sweep"
                        style={{
                          background:
                            'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.42) 50%, transparent 100%)',
                        }}
                      />
                    </div>
                  )
                ) : (
                  <div
                    className="w-56 h-64 sm:w-64 sm:h-72 border bg-black/55 flex flex-col items-center justify-center gap-3 p-6 text-center"
                    style={{
                      borderColor: `color-mix(in srgb, ${accent} 65%, rgba(255,255,255,0.18))`,
                      clipPath:
                        'polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 18px 100%, 0 calc(100% - 18px))',
                    }}
                  >
                    {isItem ? (
                      <Package className="w-12 h-12 text-amber-400" />
                    ) : spotlightMode === 'character' ? (
                      <User className="w-12 h-12 text-stone-200" />
                    ) : (
                      <Shield className="w-12 h-12 text-stone-200" />
                    )}
                    <span className="text-xs text-stone-300 font-typewriter">
                      {handout.title}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Typographic Hierarchy & Bio Column */}
          <div className="lg:col-span-7 flex flex-col justify-center space-y-5 text-left">
            {/* Clean Unboxed Kicker Metadata */}
            <div className="jrpg-kicker-in flex items-center flex-wrap gap-2.5 text-xs sm:text-sm font-semibold tracking-wider text-stone-300">
              <span style={{ color: accent }}>{roleLabel}</span>
              {subtitleClean && (
                <>
                  <span aria-hidden="true" className="text-stone-500">
                    ·
                  </span>
                  <span className="text-stone-200">{subtitleClean}</span>
                </>
              )}
            </div>

            {/* Hero Character / Item Name */}
            <div className="space-y-3">
              <h2
                className="jrpg-title-slash font-typewriter font-bold text-white tracking-tight leading-[1.02]"
                style={{
                  fontSize: 'clamp(2.1rem, 5vw, 4.25rem)',
                  textShadow: `0 6px 28px rgba(0, 0, 0, 0.85), 0 0 28px color-mix(in srgb, ${accent} 32%, transparent)`,
                }}
              >
                {handout.title}
              </h2>

              {/* Expanding Accent Rule */}
              <div className="flex items-center gap-2 jrpg-rule-expand">
                <div
                  className="h-[3px] w-28 sm:w-44"
                  style={{ backgroundColor: accent }}
                />
                <div className="h-[1px] flex-1 bg-white/20" />
              </div>
            </div>

            {/* Character Bio / Item Description */}
            {bioClean && (
              <div className="jrpg-bio-fade-up bg-black/55 backdrop-blur-md border border-white/15 p-5 sm:p-6 space-y-2.5 max-h-[38vh] overflow-y-auto shadow-xl">
                <p className="text-[11px] font-semibold tracking-wider text-stone-400">
                  {isItem ? 'Descrição do Item' : 'Biografia'}
                </p>
                <p className="text-sm sm:text-base text-stone-100 leading-relaxed whitespace-pre-wrap">
                  {bioClean}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Standard Editorial Document / Clue / Map Handout Presentation
  const kindLabels: Record<string, string> = {
    clue: 'Pista',
    npc: 'Personagem',
    letter: 'Documento',
    map: 'Mapa',
  };

  return (
    <div
      key={animKey}
      className="fixed inset-0 z-50 bg-black/82 backdrop-blur-xs flex items-center justify-center p-4 sm:p-8 jrpg-backdrop-in"
      role="dialog"
      aria-modal="true"
      aria-label={handout.title}
    >
      <div className="max-w-4xl w-full max-h-[92vh] vtt-surface border flex flex-col overflow-hidden jrpg-bio-fade-up">
        <div className="px-5 py-3.5 border-b vtt-border flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs vtt-muted">{kindLabels[handout.kind] || 'Handout'}</p>
            <h2 className="text-lg sm:text-xl font-bold font-typewriter truncate">{handout.title}</h2>
          </div>
          {canDismiss && onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="px-3.5 py-2 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              {dismissLabel}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-5 sm:p-6 flex flex-col lg:flex-row gap-6 items-center justify-center">
          {resolvedUrl && !imgFailed ? (
            <div className="w-full lg:flex-1 flex items-center justify-center bg-black/5">
              <img
                src={resolvedUrl}
                alt={handout.title}
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="max-h-[68vh] w-auto object-contain"
              />
            </div>
          ) : handout.imageUrl ? (
            <div className="w-full lg:w-72 h-56 vtt-subtle border flex flex-col items-center justify-center gap-2 p-4 text-center">
              <FileText className="w-8 h-8 vtt-muted" />
              <span className="text-xs vtt-muted">{handout.title}</span>
            </div>
          ) : null}

          {handout.body && (
            <div className="w-full lg:max-w-md space-y-3 self-stretch flex flex-col justify-center">
              <p className="text-sm sm:text-base leading-relaxed whitespace-pre-wrap font-typewriter">
                {handout.body}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
