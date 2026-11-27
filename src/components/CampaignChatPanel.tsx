import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  FileText,
  Image as ImageIcon,
  Layers,
  Lock,
  MessageSquare,
  PackagePlus,
  Paperclip,
  Reply,
  Send,
  Shield,
  Sword,
  Upload,
  User as UserIcon,
  Users,
  X,
} from 'lucide-react';
import type {
  CampaignMember,
  CharacterSheet,
  ChatAttachment,
  ChatMessage,
  ChatReplyRef,
  ChatRosterEntry,
  LiveCampaignChat,
  Scene,
  SheetBlock,
} from '../types/vtt';
import {
  resolveMediaUrl,
  uploadMediaFile,
  type CampaignUploadContext,
} from '../lib/mediaStore';
import {
  buildDmChannelId,
  sendGeneralChatMessage,
  sendPrivateChatMessage,
  subscribeLiveGeneralChat,
  subscribePrivateChatMessages,
  syncChatRoster,
} from '../lib/vttService';

interface CampaignChatPanelProps {
  campaignId: string;
  gmUid: string;
  gmName?: string;
  currentUid: string;
  currentName: string;
  isGM: boolean;
  uploadContext: CampaignUploadContext;
  members?: CampaignMember[];
  sheets: CharacterSheet[];
  scenes?: Scene[];
  activeScene?: Scene | null;
  onAddItemToSheet?: (sheetId: string, itemBlock: SheetBlock) => Promise<void>;
  onSelectSceneById?: (sceneId: string) => void;
  onNotify?: (msg: string) => void;
}

type AttachMenuTab = 'none' | 'item' | 'character' | 'scene';

const DICE_CHOICES = ['1d20', '2d6', '1d100', '1d12', '1d10', '1d8', '1d6', '1d4'];

export function CampaignChatPanel({
  campaignId,
  gmUid,
  gmName = 'Mestre',
  currentUid,
  currentName,
  isGM,
  uploadContext,
  members = [],
  sheets,
  scenes = [],
  activeScene,
  onAddItemToSheet,
  onSelectSceneById,
  onNotify,
}: CampaignChatPanelProps) {
  const [liveChat, setLiveChat] = useState<LiveCampaignChat | null>(null);
  const [privateMessages, setPrivateMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<'general' | 'private'>('general');
  const [selectedPeerUid, setSelectedPeerUid] = useState<string>('');

  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<ChatReplyRef | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<ChatAttachment | null>(null);
  const [attachMenu, setAttachMenu] = useState<AttachMenuTab>('none');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [sending, setSending] = useState(false);

  // Quick custom item creator inside attachment menu
  const [itemName, setItemName] = useState('');
  const [itemDice, setItemDice] = useState('1d20');
  const [itemAttr, setItemAttr] = useState('');
  const [itemBonus, setItemBonus] = useState(0);
  const [itemDamage, setItemDamage] = useState('');
  const [itemNotes, setItemNotes] = useState('');

  // Target sheet picker when adding received item to inventory
  const [targetSheetId, setTargetSheetId] = useState<string>('');
  const [claimedMsgIds, setClaimedMsgIds] = useState<Record<string, boolean>>({});
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!campaignId) return;
    const unsubGeneral = subscribeLiveGeneralChat(campaignId, setLiveChat);
    const unsubPrivate = subscribePrivateChatMessages(
      campaignId,
      currentUid,
      isGM,
      setPrivateMessages
    );
    return () => {
      unsubGeneral();
      unsubPrivate();
    };
  }, [campaignId, currentUid, isGM]);

  // Keep roster synced when GM opens chat or members change
  useEffect(() => {
    if (!isGM || !campaignId || !gmUid) return;
    const rosterMap = new Map<string, ChatRosterEntry>();
    rosterMap.set(gmUid, { uid: gmUid, displayName: gmName || currentName || 'Mestre', role: 'gm' });
    for (const m of members) {
      rosterMap.set(m.uid, {
        uid: m.uid,
        displayName: m.displayName || 'Jogador',
        role: m.role,
      });
    }
    const nextRoster = Array.from(rosterMap.values());
    const prevKey = JSON.stringify((liveChat?.roster || []).map((r) => `${r.uid}:${r.displayName}`).sort());
    const nextKey = JSON.stringify(nextRoster.map((r) => `${r.uid}:${r.displayName}`).sort());
    if (prevKey !== nextKey && nextRoster.length > 0) {
      void syncChatRoster(campaignId, gmUid, nextRoster, liveChat).catch(() => {});
    }
  }, [isGM, campaignId, gmUid, gmName, currentName, members, liveChat]);

  // Combined roster of participants available for Private DM
  const peers = useMemo<ChatRosterEntry[]>(() => {
    const map = new Map<string, ChatRosterEntry>();
    if (gmUid) {
      map.set(gmUid, { uid: gmUid, displayName: gmName || 'Mestre', role: 'gm' });
    }
    for (const r of liveChat?.roster || []) {
      map.set(r.uid, r);
    }
    for (const m of members) {
      map.set(m.uid, { uid: m.uid, displayName: m.displayName, role: m.role });
    }
    for (const pm of privateMessages) {
      if (pm.senderUid && pm.senderUid !== currentUid && !map.has(pm.senderUid)) {
        map.set(pm.senderUid, {
          uid: pm.senderUid,
          displayName: pm.senderName,
          role: pm.senderRole,
        });
      }
      if (pm.recipientUid && pm.recipientUid !== currentUid && !map.has(pm.recipientUid)) {
        map.set(pm.recipientUid, {
          uid: pm.recipientUid,
          displayName: pm.recipientName || 'Jogador',
          role: pm.recipientUid === gmUid ? 'gm' : 'player',
        });
      }
    }
    map.delete(currentUid);
    return Array.from(map.values()).sort((a, b) => {
      if (a.role === 'gm' && b.role !== 'gm') return -1;
      if (b.role === 'gm' && a.role !== 'gm') return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }, [gmUid, gmName, liveChat?.roster, members, privateMessages, currentUid]);

  useEffect(() => {
    if (mode === 'private' && !selectedPeerUid && peers.length > 0) {
      setSelectedPeerUid(peers[0].uid);
    }
  }, [mode, selectedPeerUid, peers]);

  useEffect(() => {
    if (!targetSheetId && sheets.length > 0) {
      setTargetSheetId(sheets[0].id);
    }
  }, [sheets, targetSheetId]);

  const activePeer = peers.find((p) => p.uid === selectedPeerUid) || null;

  const visibleMessages = useMemo(() => {
    if (mode === 'general') {
      return liveChat?.messages || [];
    }
    if (!activePeer) return [];
    const chanId = buildDmChannelId(currentUid, activePeer.uid);
    return privateMessages.filter((m) => m.channelId === chanId);
  }, [mode, liveChat?.messages, activePeer, currentUid, privateMessages]);

  // Resolve media URLs for any attached photos/files/characters/scenes
  useEffect(() => {
    let alive = true;
    const toResolve = visibleMessages.filter(
      (m) => m.attachment && (m.attachment.mediaId || m.attachment.url)
    );
    if (toResolve.length === 0) return;
    Promise.all(
      toResolve.map(async (m) => {
        const att = m.attachment!;
        const url = await resolveMediaUrl(att.mediaId || '', att.url || '', campaignId);
        return [m.id, url] as const;
      })
    ).then((entries) => {
      if (!alive) return;
      setMediaUrls((prev) => {
        const next = { ...prev };
        for (const [id, url] of entries) {
          if (url) next[id] = url;
        }
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [visibleMessages, campaignId]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleMessages.length, mode, selectedPeerUid]);

  async function handleFileUpload(file: File | undefined) {
    if (!file) return;
    setUploadingFile(true);
    try {
      const isImg = file.type.startsWith('image/');
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: isImg ? 'handout' : 'none',
      });
      setPendingAttachment({
        kind: isImg ? 'image' : 'file',
        title: file.name,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        url: res.url,
        mediaId: res.mediaId,
      });
      setAttachMenu('none');
      onNotify?.(`Anexo "${file.name}" pronto para envio.`);
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao anexar arquivo.');
    } finally {
      setUploadingFile(false);
    }
  }

  function handleAttachCustomItem(e: React.FormEvent) {
    e.preventDefault();
    const cleanName = itemName.trim();
    if (!cleanName) return;
    const bonusPart = itemBonus > 0 ? ` + ${itemBonus}` : itemBonus < 0 ? ` - ${Math.abs(itemBonus)}` : '';
    const attrPart = itemAttr.trim() ? ` + {${itemAttr.trim()}}` : '';
    const formula = `${itemDice}${attrPart}${bonusPart}`;
    const block: SheetBlock = {
      id: `itm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      type: 'item',
      section: 'Itens & Habilidades',
      label: cleanName,
      diceType: itemDice,
      linkedAttribute: itemAttr.trim() || undefined,
      bonus: itemBonus || 0,
      formula,
      damageFormula: itemDamage.trim() || undefined,
      damageLabel: itemDamage.trim() ? 'Dano' : undefined,
      text: itemNotes.trim() || undefined,
    };
    setPendingAttachment({
      kind: 'item',
      title: cleanName,
      subtitle: `${formula}${itemDamage.trim() ? ` · Dano: ${itemDamage.trim()}` : ''}`,
      itemBlock: block,
    });
    setItemName('');
    setItemAttr('');
    setItemBonus(0);
    setItemDamage('');
    setItemNotes('');
    setAttachMenu('none');
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed && !pendingAttachment) return;
    if (mode === 'private' && !activePeer) {
      onNotify?.('Selecione um participante para enviar mensagem privada.');
      return;
    }

    setSending(true);
    try {
      if (mode === 'general') {
        await sendGeneralChatMessage({
          campaignId,
          gmUid,
          senderUid: currentUid,
          senderName: currentName,
          senderRole: isGM ? 'gm' : 'player',
          text: trimmed,
          replyTo,
          attachment: pendingAttachment,
          currentMessages: liveChat?.messages || [],
          currentRoster: liveChat?.roster || [],
        });
      } else if (activePeer) {
        await sendPrivateChatMessage({
          campaignId,
          gmUid,
          senderUid: currentUid,
          senderName: currentName,
          senderRole: isGM ? 'gm' : 'player',
          recipientUid: activePeer.uid,
          recipientName: activePeer.displayName,
          text: trimmed,
          replyTo,
          attachment: pendingAttachment,
        });
      }
      setText('');
      setReplyTo(null);
      setPendingAttachment(null);
      setAttachMenu('none');
    } catch (err) {
      onNotify?.(err instanceof Error ? err.message : 'Erro ao enviar mensagem.');
    } finally {
      setSending(false);
    }
  }

  async function handleClaimItem(msgId: string, itemBlock: SheetBlock) {
    if (!onAddItemToSheet) return;
    const sheetId = targetSheetId || sheets[0]?.id;
    if (!sheetId) {
      onNotify?.('Crie uma ficha primeiro para adicionar este item ao inventário.');
      return;
    }
    try {
      const cloned: SheetBlock = {
        ...itemBlock,
        id: `itm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      };
      await onAddItemToSheet(sheetId, cloned);
      setClaimedMsgIds((prev) => ({ ...prev, [msgId]: true }));
      const targetName = sheets.find((s) => s.id === sheetId)?.name || 'Ficha';
      onNotify?.(`"${itemBlock.label}" adicionado automaticamente à ficha "${targetName}"!`);
    } catch {
      onNotify?.('Não foi possível adicionar o item à ficha.');
    }
  }

  const sceneTokens = (activeScene?.tokens || []).filter(
    (t) => t.layerKind !== 'brush' && t.layerKind !== 'text'
  );

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Header + Channel Switcher */}
      <div className="p-3 border-b vtt-border space-y-2 shrink-0">
        <div className="grid grid-cols-2 border vtt-border vtt-canvas">
          <button
            type="button"
            onClick={() => setMode('general')}
            className={`py-2 text-xs font-semibold flex items-center justify-center gap-1.5 ${
              mode === 'general' ? 'vtt-accent-btn' : 'vtt-muted hover:opacity-100'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            Chat Geral
          </button>
          <button
            type="button"
            onClick={() => setMode('private')}
            className={`py-2 text-xs font-semibold flex items-center justify-center gap-1.5 ${
              mode === 'private' ? 'vtt-accent-btn' : 'vtt-muted hover:opacity-100'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            Privado
          </button>
        </div>

        {/* Private Peer Selector */}
        {mode === 'private' && (
          <div className="space-y-1">
            {peers.length === 0 ? (
              <p className="text-[11px] vtt-muted">
                Nenhum outro participante conectado ainda. Assim que jogadores entrarem na sala, você poderá conversar em privado aqui.
              </p>
            ) : (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                {peers.map((peer) => {
                  const active = peer.uid === selectedPeerUid;
                  return (
                    <button
                      key={peer.uid}
                      type="button"
                      onClick={() => setSelectedPeerUid(peer.uid)}
                      className={`px-2.5 py-1 text-[11px] border whitespace-nowrap shrink-0 flex items-center gap-1 ${
                        active
                          ? 'vtt-accent-btn border-transparent font-semibold'
                          : 'vtt-canvas vtt-border vtt-muted hover:opacity-100'
                      }`}
                    >
                      {peer.role === 'gm' ? (
                        <Shield className="w-3 h-3" />
                      ) : (
                        <UserIcon className="w-3 h-3" />
                      )}
                      {peer.displayName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {visibleMessages.length === 0 ? (
          <div className="py-10 text-center space-y-2 vtt-muted">
            <MessageSquare className="w-6 h-6 mx-auto opacity-50" />
            <p className="text-xs font-semibold">
              {mode === 'general'
                ? 'Chat Geral da Campanha'
                : activePeer
                  ? `Conversa privada com ${activePeer.displayName}`
                  : 'Selecione alguém para conversar em privado'}
            </p>
            <p className="text-[11px] max-w-[240px] mx-auto">
              Envie mensagens, fotos, arquivos ou itens que os jogadores podem adicionar direto na ficha.
            </p>
          </div>
        ) : (
          visibleMessages.map((msg) => {
            const isMine = msg.senderUid === currentUid;
            const resolvedUrl = mediaUrls[msg.id] || msg.attachment?.url || '';
            const timeStr = new Date(msg.timestampMs || Date.now()).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            });

            return (
              <div
                key={msg.id}
                className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[92%] border p-2.5 space-y-1.5 ${
                    isMine
                      ? 'vtt-subtle border-current/20'
                      : 'vtt-surface vtt-border'
                  }`}
                >
                  {/* Sender Header + Reply Action */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-bold flex items-center gap-1 truncate">
                      {msg.senderRole === 'gm' && (
                        <Shield className="w-3 h-3 vtt-accent-text shrink-0" />
                      )}
                      <span className="truncate">{msg.senderName}</span>
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] vtt-muted tabular-nums">{timeStr}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setReplyTo({
                            id: msg.id,
                            senderName: msg.senderName,
                            textPreview:
                              msg.text.slice(0, 80) ||
                              msg.attachment?.title ||
                              'Anexo',
                          })
                        }
                        className="p-0.5 vtt-muted hover:opacity-100"
                        title="Responder esta mensagem"
                        aria-label="Responder mensagem"
                      >
                        <Reply className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Quoted Reply */}
                  {msg.replyTo && (
                    <div className="px-2 py-1 border-l-2 border-amber-500 vtt-canvas text-[10px] space-y-0.5">
                      <p className="font-semibold vtt-accent-text">{msg.replyTo.senderName}</p>
                      <p className="vtt-muted truncate">{msg.replyTo.textPreview}</p>
                    </div>
                  )}

                  {/* Text Body */}
                  {msg.text && (
                    <p className="text-xs leading-relaxed whitespace-pre-wrap break-words">
                      {msg.text}
                    </p>
                  )}

                  {/* Rich Attachment Card */}
                  {msg.attachment && (
                    <div className="border vtt-border vtt-canvas p-2 space-y-2">
                      {msg.attachment.kind === 'image' && resolvedUrl && (
                        <button
                          type="button"
                          onClick={() => setLightboxUrl(resolvedUrl)}
                          className="block w-full overflow-hidden border vtt-border"
                        >
                          <img
                            src={resolvedUrl}
                            alt={msg.attachment.title}
                            className="w-full max-h-52 object-cover"
                          />
                        </button>
                      )}

                      {msg.attachment.kind === 'file' && (
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <FileText className="w-4 h-4 vtt-accent-text shrink-0" />
                            <span className="text-[11px] font-semibold truncate">
                              {msg.attachment.fileName || msg.attachment.title}
                            </span>
                          </div>
                          {resolvedUrl && (
                            <a
                              href={resolvedUrl}
                              download={msg.attachment.fileName || msg.attachment.title}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2 py-1 text-[10px] font-semibold vtt-accent-btn flex items-center gap-1 shrink-0"
                            >
                              <Download className="w-3 h-3" />
                              Baixar
                            </a>
                          )}
                        </div>
                      )}

                      {msg.attachment.kind === 'item' && msg.attachment.itemBlock && (
                        <div className="space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-wider vtt-muted flex items-center gap-1">
                                <Sword className="w-3 h-3 vtt-accent-text" />
                                Item / Equipamento
                              </p>
                              <p className="text-xs font-bold font-typewriter truncate">
                                {msg.attachment.itemBlock.label}
                              </p>
                              {msg.attachment.subtitle && (
                                <p className="text-[10px] vtt-accent-text font-mono">
                                  {msg.attachment.subtitle}
                                </p>
                              )}
                            </div>
                          </div>
                          {msg.attachment.itemBlock.text && (
                            <p className="text-[11px] vtt-muted leading-snug">
                              {msg.attachment.itemBlock.text}
                            </p>
                          )}

                          {onAddItemToSheet && sheets.length > 0 && (
                            <div className="pt-1 border-t vtt-border flex items-center gap-1.5 flex-wrap">
                              {sheets.length > 1 && (
                                <select
                                  value={targetSheetId}
                                  onChange={(e) => setTargetSheetId(e.target.value)}
                                  className="px-1.5 py-1 text-[10px] border vtt-border vtt-surface max-w-[120px]"
                                  aria-label="Escolher ficha de destino"
                                >
                                  {sheets.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <button
                                type="button"
                                disabled={claimedMsgIds[msg.id]}
                                onClick={() =>
                                  void handleClaimItem(msg.id, msg.attachment!.itemBlock!)
                                }
                                className={`flex-1 py-1.5 px-2 text-[11px] font-semibold flex items-center justify-center gap-1 whitespace-nowrap ${
                                  claimedMsgIds[msg.id]
                                    ? 'bg-emerald-700 text-white'
                                    : 'vtt-accent-btn'
                                }`}
                              >
                                {claimedMsgIds[msg.id] ? (
                                  <>
                                    <Check className="w-3 h-3" />
                                    Adicionado à Ficha
                                  </>
                                ) : (
                                  <>
                                    <PackagePlus className="w-3.5 h-3.5" />
                                    Adicionar ao Inventário
                                  </>
                                )}
                              </button>
                            </div>
                          )}
                        </div>
                      )}

                      {(msg.attachment.kind === 'character' || msg.attachment.kind === 'npc') && (
                        <div className="flex items-center gap-2.5">
                          {resolvedUrl ? (
                            <img
                              src={resolvedUrl}
                              alt={msg.attachment.title}
                              className="w-10 h-10 rounded-full object-cover border vtt-border shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full vtt-subtle border vtt-border flex items-center justify-center shrink-0">
                              <UserIcon className="w-4 h-4 vtt-muted" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase tracking-wider vtt-muted">
                              {msg.attachment.kind === 'npc' ? 'NPC / Token' : 'Personagem'}
                            </p>
                            <p className="text-xs font-bold font-typewriter truncate">
                              {msg.attachment.title}
                            </p>
                            {msg.attachment.subtitle && (
                              <p className="text-[10px] vtt-muted truncate">
                                {msg.attachment.subtitle}
                              </p>
                            )}
                            {msg.attachment.statsSummary && (
                              <p className="text-[10px] vtt-accent-text truncate">
                                {msg.attachment.statsSummary}
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {msg.attachment.kind === 'scene' && (
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            {resolvedUrl ? (
                              <img
                                src={resolvedUrl}
                                alt={msg.attachment.title}
                                className="w-14 h-10 object-cover border vtt-border shrink-0"
                              />
                            ) : (
                              <div className="w-14 h-10 vtt-subtle border vtt-border flex items-center justify-center shrink-0">
                                <Layers className="w-4 h-4 vtt-muted" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] uppercase tracking-wider vtt-muted">
                                Cena
                              </p>
                              <p className="text-xs font-bold font-typewriter truncate">
                                {msg.attachment.title}
                              </p>
                              {msg.attachment.subtitle && (
                                <p className="text-[10px] vtt-muted truncate">
                                  {msg.attachment.subtitle}
                                </p>
                              )}
                            </div>
                            {isGM && msg.attachment.entityId && onSelectSceneById && (
                              <button
                                type="button"
                                onClick={() => onSelectSceneById(msg.attachment!.entityId!)}
                                className="px-2 py-1 text-[10px] vtt-accent-btn shrink-0"
                              >
                                Abrir
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
        <div ref={listEndRef} />
      </div>

      {/* Attachment Builder Drawer */}
      {attachMenu !== 'none' && (
        <div className="border-t vtt-border vtt-subtle p-3 space-y-2.5 shrink-0 max-h-64 overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold font-typewriter">
              {attachMenu === 'item'
                ? 'Criar ou Escolher Item / Arma'
                : attachMenu === 'character'
                  ? 'Anexar Personagem ou NPC'
                  : 'Anexar Cena'}
            </span>
            <button
              type="button"
              onClick={() => setAttachMenu('none')}
              className="p-0.5 vtt-muted hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {attachMenu === 'item' && (
            <form onSubmit={handleAttachCustomItem} className="space-y-2">
              <input
                type="text"
                required
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder="Nome do item / arma (ex: Espada Runica, Pistola .38)"
                className="w-full px-2 py-1.5 text-xs border vtt-border vtt-canvas"
              />
              <div className="grid grid-cols-3 gap-1.5">
                <select
                  value={itemDice}
                  onChange={(e) => setItemDice(e.target.value)}
                  className="px-1.5 py-1.5 text-[11px] border vtt-border vtt-canvas"
                >
                  {DICE_CHOICES.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={itemAttr}
                  onChange={(e) => setItemAttr(e.target.value)}
                  placeholder="Atributo (ex: Força)"
                  className="px-2 py-1.5 text-[11px] border vtt-border vtt-canvas"
                />
                <input
                  type="number"
                  value={itemBonus}
                  onChange={(e) => setItemBonus(Number(e.target.value))}
                  placeholder="Bônus"
                  className="px-2 py-1.5 text-[11px] border vtt-border vtt-canvas tabular-nums"
                />
              </div>
              <input
                type="text"
                value={itemDamage}
                onChange={(e) => setItemDamage(e.target.value)}
                placeholder="Dano opcional (ex: 1d8 + 2)"
                className="w-full px-2 py-1.5 text-[11px] border vtt-border vtt-canvas"
              />
              <input
                type="text"
                value={itemNotes}
                onChange={(e) => setItemNotes(e.target.value)}
                placeholder="Descrição ou efeito especial..."
                className="w-full px-2 py-1.5 text-[11px] border vtt-border vtt-canvas"
              />
              <button
                type="submit"
                className="w-full py-1.5 text-xs font-semibold vtt-accent-btn"
              >
                Anexar Item à Mensagem
              </button>
            </form>
          )}

          {attachMenu === 'character' && (
            <div className="space-y-2">
              {sheets.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider vtt-muted">Fichas</p>
                  {sheets.map((s) => {
                    const barSummary = s.blocks
                      .filter((b) => b.type === 'bar')
                      .slice(0, 2)
                      .map((b) => `${b.label}: ${b.current ?? 0}/${b.max ?? 0}`)
                      .join(' · ');
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setPendingAttachment({
                            kind: 'character',
                            title: s.name,
                            subtitle: s.subtitle || s.templateId,
                            url: s.avatarUrl || '',
                            mediaId: s.avatarMediaId || '',
                            entityId: s.id,
                            statsSummary: barSummary,
                          });
                          setAttachMenu('none');
                        }}
                        className="w-full p-2 border vtt-border vtt-canvas hover:opacity-90 text-left flex items-center justify-between gap-2"
                      >
                        <span className="font-semibold truncate">{s.name}</span>
                        <span className="text-[10px] vtt-muted truncate">{s.subtitle}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {sceneTokens.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider vtt-muted">
                    NPCs / Tokens da Cena Atual
                  </p>
                  {sceneTokens.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        setPendingAttachment({
                          kind: 'npc',
                          title: t.name,
                          subtitle: t.notes?.slice(0, 80) || 'Token na cena',
                          url: t.imageUrl || '',
                          mediaId: t.mediaId || '',
                          entityId: t.id,
                        });
                        setAttachMenu('none');
                      }}
                      className="w-full p-2 border vtt-border vtt-canvas hover:opacity-90 text-left flex items-center justify-between gap-2"
                    >
                      <span className="font-semibold truncate">{t.name}</span>
                      <span className="text-[10px] vtt-muted">Token</span>
                    </button>
                  ))}
                </div>
              )}

              {sheets.length === 0 && sceneTokens.length === 0 && (
                <p className="text-[11px] vtt-muted">Nenhum personagem ou NPC disponível.</p>
              )}
            </div>
          )}

          {attachMenu === 'scene' && (
            <div className="space-y-1">
              {scenes.length === 0 ? (
                <p className="text-[11px] vtt-muted">Nenhuma cena cadastrada.</p>
              ) : (
                scenes.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => {
                      setPendingAttachment({
                        kind: 'scene',
                        title: sc.name,
                        subtitle: sc.folder ? `Pasta: ${sc.folder}` : sc.category,
                        url: sc.imageUrl || '',
                        mediaId: sc.mediaId || '',
                        entityId: sc.id,
                      });
                      setAttachMenu('none');
                    }}
                    className="w-full p-2 border vtt-border vtt-canvas hover:opacity-90 text-left flex items-center justify-between gap-2"
                  >
                    <span className="font-semibold truncate">{sc.name}</span>
                    {sc.folder && (
                      <span className="text-[10px] vtt-muted shrink-0">{sc.folder}</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Composer */}
      <div className="border-t vtt-border p-2.5 space-y-2 shrink-0 vtt-surface">
        {/* Active Reply Banner */}
        {replyTo && (
          <div className="px-2 py-1.5 border-l-2 border-amber-500 vtt-canvas flex items-center justify-between gap-2 text-[11px]">
            <div className="min-w-0">
              <span className="font-semibold">Respondendo {replyTo.senderName}: </span>
              <span className="vtt-muted truncate">{replyTo.textPreview}</span>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="p-0.5 vtt-muted hover:opacity-100 shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Pending Attachment Pill */}
        {pendingAttachment && (
          <div className="px-2 py-1.5 border vtt-border vtt-canvas flex items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <Paperclip className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
              <span className="font-semibold truncate">{pendingAttachment.title}</span>
              <span className="text-[10px] vtt-muted shrink-0">({pendingAttachment.kind})</span>
            </div>
            <button
              type="button"
              onClick={() => setPendingAttachment(null)}
              className="p-0.5 vtt-muted hover:opacity-100 shrink-0"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}

        {/* Quick Attachment Toolbar */}
        <div className="flex items-center gap-1 flex-wrap">
          <label
            className="px-2 py-1 text-[10px] border vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center gap-1"
            title="Anexar foto ou arquivo"
          >
            {uploadingFile ? (
              <Upload className="w-3 h-3 animate-pulse" />
            ) : (
              <ImageIcon className="w-3 h-3" />
            )}
            <span>{uploadingFile ? 'Enviando...' : 'Foto/Arquivo'}</span>
            <input
              type="file"
              className="hidden"
              disabled={uploadingFile}
              onChange={(e) => {
                void handleFileUpload(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => setAttachMenu((m) => (m === 'item' ? 'none' : 'item'))}
            className={`px-2 py-1 text-[10px] border flex items-center gap-1 ${
              attachMenu === 'item'
                ? 'vtt-accent-btn border-transparent font-semibold'
                : 'vtt-canvas vtt-border hover:vtt-subtle'
            }`}
            title="Criar e enviar arma/item que pode ser adicionado ao inventário"
          >
            <Sword className="w-3 h-3" />
            Item
          </button>

          <button
            type="button"
            onClick={() => setAttachMenu((m) => (m === 'character' ? 'none' : 'character'))}
            className={`px-2 py-1 text-[10px] border flex items-center gap-1 ${
              attachMenu === 'character'
                ? 'vtt-accent-btn border-transparent font-semibold'
                : 'vtt-canvas vtt-border hover:vtt-subtle'
            }`}
            title="Anexar personagem ou NPC"
          >
            <UserIcon className="w-3 h-3" />
            NPC/Pers.
          </button>

          {isGM && scenes.length > 0 && (
            <button
              type="button"
              onClick={() => setAttachMenu((m) => (m === 'scene' ? 'none' : 'scene'))}
              className={`px-2 py-1 text-[10px] border flex items-center gap-1 ${
                attachMenu === 'scene'
                  ? 'vtt-accent-btn border-transparent font-semibold'
                  : 'vtt-canvas vtt-border hover:vtt-subtle'
              }`}
              title="Anexar referência de uma cena"
            >
              <Layers className="w-3 h-3" />
              Cena
            </button>
          )}
        </div>

        {/* Message Input + Send */}
        <form onSubmit={(e) => void handleSend(e)} className="flex items-center gap-1.5">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              mode === 'general'
                ? 'Mensagem no chat geral...'
                : activePeer
                  ? `Privado para ${activePeer.displayName}...`
                  : 'Selecione um participante...'
            }
            disabled={sending || (mode === 'private' && !activePeer)}
            className="flex-1 min-w-0 px-2.5 py-2 text-xs border vtt-border vtt-canvas"
          />
          <button
            type="submit"
            disabled={sending || (!text.trim() && !pendingAttachment) || (mode === 'private' && !activePeer)}
            className="px-3 py-2 vtt-accent-btn disabled:opacity-40 flex items-center justify-center shrink-0"
            aria-label="Enviar mensagem"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>
      </div>

      {/* Image Lightbox */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          className="fixed inset-0 z-[70] bg-black/85 flex items-center justify-center p-6"
        >
          <img
            src={lightboxUrl}
            alt="Prévia da imagem"
            className="max-w-full max-h-[88vh] object-contain border border-white/20 shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
