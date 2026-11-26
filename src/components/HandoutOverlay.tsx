import { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import type { ActiveHandoutProjection } from '../types/vtt';
import { resolveMediaUrl } from '../lib/mediaStore';

interface HandoutOverlayProps {
  campaignId?: string;
  handout: ActiveHandoutProjection | null;
  canDismiss: boolean;
  dismissLabel?: string;
  onDismiss?: () => void;
}

export function HandoutOverlay({
  campaignId,
  handout,
  canDismiss,
  dismissLabel = 'Fechar',
  onDismiss,
}: HandoutOverlayProps) {
  const [resolvedUrl, setResolvedUrl] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setImgFailed(false);
    if (!handout) {
      setResolvedUrl('');
      return;
    }
    void resolveMediaUrl(handout.mediaId, handout.imageUrl, campaignId).then((url) => {
      if (active) setResolvedUrl(url);
    });
    return () => {
      active = false;
    };
  }, [handout, campaignId]);

  if (!handout) return null;

  const kindLabels: Record<string, string> = {
    clue: 'Pista',
    npc: 'Personagem',
    letter: 'Documento',
    map: 'Mapa',
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/82 backdrop-blur-xs flex items-center justify-center p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-label={handout.title}
    >
      <div className="max-w-4xl w-full max-h-[92vh] vtt-surface border flex flex-col overflow-hidden">
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
