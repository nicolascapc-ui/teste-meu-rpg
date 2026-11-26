import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, ExternalLink, Smartphone, Tv, Users, X } from 'lucide-react';
import type { Campaign, CampaignMember } from '../types/vtt';
import { buildAppUrl } from '../lib/router';

interface RoomQrModalProps {
  campaign: Campaign;
  members: CampaignMember[];
  onClose: () => void;
}

export function RoomQrModal({ campaign, members, onClose }: RoomQrModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const joinUrl = buildAppUrl(`/join/${campaign.roomCode}`);
  const secondScreenUrl = buildAppUrl(`/screen/${campaign.id}`);

  useEffect(() => {
    void QRCode.toDataURL(joinUrl, {
      width: 220,
      margin: 1,
      color: { dark: '#1b1917', light: '#fdfbf7' },
    }).then(setQrDataUrl);
  }, [joinUrl]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback ignored gracefully
    }
  }

  const players = members.filter((m) => m.role === 'player');

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Conectar Mesa Presencial e Online"
    >
      <div className="w-full max-w-2xl vtt-surface border p-6 space-y-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b vtt-border pb-3">
          <div>
            <p className="text-xs vtt-muted">Mesa Presencial &amp; Online</p>
            <h2 className="text-xl font-bold font-typewriter">Conectar TV e Celulares</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 border vtt-border vtt-muted hover:opacity-80"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Mobile Pass-and-Play QR Code */}
          <div className="space-y-4 border vtt-border p-4 vtt-canvas">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Smartphone className="w-4 h-4 vtt-accent-text" />
              <span>Jogadores no Celular / Tablet</span>
            </div>
            <p className="text-xs vtt-muted leading-relaxed">
              Escaneie o QR Code ou digite o código para abrir a ficha modular/PDF, rolar dados na TV e receber pistas secretas.
            </p>
            <div className="flex justify-center py-2">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR Code da sala ${campaign.roomCode}`}
                  className="w-44 h-44 border vtt-border bg-white p-1"
                />
              ) : (
                <div className="w-44 h-44 border vtt-border animate-pulse" />
              )}
            </div>
            <div className="text-center space-y-1">
              <p className="text-xs vtt-muted">Código da sala</p>
              <p className="text-2xl font-bold font-typewriter tracking-[0.25em] tabular-nums">
                {campaign.roomCode}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={joinUrl}
                className="flex-1 px-2.5 py-2 text-xs border vtt-border vtt-surface truncate"
              />
              <button
                type="button"
                onClick={() => void handleCopy()}
                className="px-3 py-2 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>

          {/* Second Screen TV & Connected Players */}
          <div className="flex flex-col justify-between gap-5">
            <div className="space-y-3 border vtt-border p-4 vtt-canvas">
              <div className="flex items-center gap-2 text-xs font-semibold">
                <Tv className="w-4 h-4 vtt-accent-text" />
                <span>Segunda Tela (TV / Monitor)</span>
              </div>
              <p className="text-xs vtt-muted leading-relaxed">
                Abre uma janela limpa sem barra do mestre, sem anotações secretas e com névoa de guerra 100% opaca. Arraste para a TV da mesa.
              </p>
              <a
                href={secondScreenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 text-xs font-semibold vtt-accent-btn flex items-center justify-center gap-2 whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Abrir Tela dos Jogadores
              </a>
            </div>

            <div className="flex-1 space-y-2.5 border vtt-border p-4 vtt-canvas">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-2">
                  <Users className="w-4 h-4 vtt-accent-text" />
                  Jogadores na sala
                </span>
                <span className="vtt-muted tabular-nums">{players.length}</span>
              </div>
              {players.length === 0 ? (
                <p className="text-xs vtt-muted leading-relaxed">
                  Nenhum jogador entrou ainda. Assim que escanearem o QR Code, eles aparecerão aqui para receber bilhetes individuais.
                </p>
              ) : (
                <ul className="divide-y vtt-border text-xs">
                  {players.map((p) => (
                    <li key={p.uid} className="py-2 flex items-center justify-between">
                      <span className="font-semibold truncate">{p.displayName}</span>
                      <span className="vtt-muted">Conectado</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
