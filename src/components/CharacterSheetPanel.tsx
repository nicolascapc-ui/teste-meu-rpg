import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  Copy,
  Dices,
  FileText,
  FileUp,
  Layers,
  Loader2,
  Minus,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import type { CharacterSheet, SheetBlock, SheetBlockType } from '../types/vtt';
import {
  resolveMediaUrl,
  uploadMediaFile,
  type CampaignUploadContext,
} from '../lib/mediaStore';

export interface CreateSheetPayload {
  name: string;
  subtitle?: string;
  systemName?: string;
  mode?: 'modular' | 'pdf';
  avatarUrl?: string;
  avatarMediaId?: string;
  pdfUrl?: string;
  pdfMediaId?: string;
  pdfFileName?: string;
  blocks?: SheetBlock[];
}

interface CharacterSheetPanelProps {
  uploadContext: CampaignUploadContext;
  sheets: CharacterSheet[];
  onCreateSheet: (payload: CreateSheetPayload) => Promise<string>;
  onUpdateSheet: (sheet: CharacterSheet) => Promise<void>;
  onDeleteSheet: (sheetId: string) => Promise<void>;
  onRollFromSheet: (params: {
    sheetName: string;
    label: string;
    formula: string;
    blocks: SheetBlock[];
  }) => Promise<void>;
  onNotify: (msg: string) => void;
}

interface ParsedPdfSheetResponse {
  systemName: string;
  characterName: string;
  subtitle: string;
  blocks: SheetBlock[];
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Falha ao ler arquivo PDF.'));
    reader.readAsDataURL(file);
  });
}

export function CharacterSheetPanel({
  uploadContext,
  sheets,
  onCreateSheet,
  onUpdateSheet,
  onDeleteSheet,
  onRollFromSheet,
  onNotify,
}: CharacterSheetPanelProps) {
  const [selectedId, setSelectedId] = useState<string>(sheets[0]?.id || '');
  const [showNewDrawer, setShowNewDrawer] = useState(false);

  // Blank sheet form
  const [newName, setNewName] = useState('');
  const [newSystem, setNewSystem] = useState('');

  // PDF import / AI sheet builder state
  const [importingPdf, setImportingPdf] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [pdfResolvedUrl, setPdfResolvedUrl] = useState('');
  const [avatarResolvedUrl, setAvatarResolvedUrl] = useState('');

  const activeSheet = sheets.find((s) => s.id === selectedId) || sheets[0] || null;

  useEffect(() => {
    if (!activeSheet && sheets.length > 0) {
      setSelectedId(sheets[0].id);
    }
  }, [sheets, activeSheet]);

  useEffect(() => {
    let alive = true;
    if (!activeSheet || (!activeSheet.pdfMediaId && !activeSheet.pdfUrl)) {
      setPdfResolvedUrl('');
      return;
    }
    void resolveMediaUrl(
      activeSheet.pdfMediaId,
      activeSheet.pdfUrl,
      uploadContext.campaignId
    ).then((url) => {
      if (alive) setPdfResolvedUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [activeSheet?.id, activeSheet?.pdfMediaId, activeSheet?.pdfUrl, uploadContext.campaignId]);

  useEffect(() => {
    let alive = true;
    if (!activeSheet || (!activeSheet.avatarMediaId && !activeSheet.avatarUrl)) {
      setAvatarResolvedUrl('');
      return;
    }
    void resolveMediaUrl(
      activeSheet.avatarMediaId,
      activeSheet.avatarUrl,
      uploadContext.campaignId
    ).then((url) => {
      if (alive) setAvatarResolvedUrl(url);
    });
    return () => {
      alive = false;
    };
  }, [
    activeSheet?.id,
    activeSheet?.avatarMediaId,
    activeSheet?.avatarUrl,
    uploadContext.campaignId,
  ]);

  const groupedBlocks = useMemo(() => {
    if (!activeSheet) return [];
    const groups: Array<{ section: string; items: Array<{ block: SheetBlock; index: number }> }> = [];
    const map = new Map<string, Array<{ block: SheetBlock; index: number }>>();

    activeSheet.blocks.forEach((block, index) => {
      const sec = (block.section || 'Geral').trim() || 'Geral';
      let bucket = map.get(sec);
      if (!bucket) {
        bucket = [];
        map.set(sec, bucket);
        groups.push({ section: sec, items: bucket });
      }
      bucket.push({ block, index });
    });

    return groups;
  }, [activeSheet]);

  async function handleCreateBlank(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    const id = await onCreateSheet({
      name: newName.trim(),
      subtitle: newSystem.trim() || 'Ficha Livre',
      systemName: newSystem.trim() || 'Sistema Livre',
      mode: 'modular',
    });
    setSelectedId(id);
    setNewName('');
    setNewSystem('');
    setShowNewDrawer(false);
    onNotify('Ficha livre criada.');
  }

  async function handleDuplicateCurrent() {
    if (!activeSheet) return;
    const clonedBlocks = activeSheet.blocks.map((b, i) => ({
      ...b,
      id: `blk_${Date.now().toString(36)}_${i}`,
    }));
    const id = await onCreateSheet({
      name: `${activeSheet.name} (Cópia)`,
      subtitle: activeSheet.subtitle,
      systemName: activeSheet.templateId || 'Sistema Livre',
      mode: 'modular',
      blocks: clonedBlocks,
    });
    setSelectedId(id);
    setShowNewDrawer(false);
    onNotify('Ficha duplicada como modelo.');
  }

  async function handleSmartPdfImport(file: File | undefined) {
    if (!file) return;
    if (file.size > 11 * 1024 * 1024) {
      onNotify('O PDF ultrapassa o limite de 11 MB.');
      return;
    }

    setImportingPdf(true);
    setImportStatus('Enviando PDF para a nuvem da campanha...');
    try {
      const uploadRes = await uploadMediaFile(file, uploadContext);

      setImportStatus('Lendo o PDF e montando a ficha interativa...');
      const pdfBase64 = await fileToBase64(file);

      const apiRes = await fetch('/api/parse-sheet-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          pdfBase64,
        }),
      });

      if (!apiRes.ok) {
        const errBody = (await apiRes.json().catch(() => ({}))) as { error?: string };
        throw new Error(
          errBody.error ||
            'Não foi possível ler automaticamente o PDF. Ele foi anexado como PDF puro.'
        );
      }

      const parsed = (await apiRes.json()) as ParsedPdfSheetResponse;

      const id = await onCreateSheet({
        name: parsed.characterName || file.name.replace(/\.pdf$/i, ''),
        subtitle: parsed.subtitle || parsed.systemName,
        systemName: parsed.systemName || 'Importado de PDF',
        mode: 'modular',
        pdfUrl: uploadRes.url,
        pdfMediaId: uploadRes.mediaId,
        pdfFileName: uploadRes.fileName,
        blocks: parsed.blocks,
      });

      setSelectedId(id);
      setShowNewDrawer(false);
      onNotify(`Ficha montada automaticamente (${parsed.systemName})!`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao importar ficha PDF.');
    } finally {
      setImportingPdf(false);
      setImportStatus('');
    }
  }

  function patchSheet(next: CharacterSheet) {
    void onUpdateSheet(next);
  }

  function updateBlock(blockId: string, patch: Partial<SheetBlock>) {
    if (!activeSheet) return;
    const blocks = activeSheet.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b));
    patchSheet({ ...activeSheet, blocks });
  }

  function addBlock(type: SheetBlockType) {
    if (!activeSheet) return;
    const id = `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    const defaults: Record<SheetBlockType, SheetBlock> = {
      bar: {
        id,
        type: 'bar',
        section: 'Recursos',
        label: 'Recurso (Vida / Sanidade / Energia)',
        current: 10,
        max: 10,
        barColor: '#8f2d2d',
      },
      attribute: {
        id,
        type: 'attribute',
        section: 'Atributos',
        label: 'Novo Atributo',
        value: 2,
        formula: '1d20 + {Novo Atributo}',
      },
      counter: {
        id,
        type: 'counter',
        section: 'Recursos',
        label: 'Contador / Munição',
        count: 3,
        maxCount: 6,
      },
      text: {
        id,
        type: 'text',
        section: 'Notas',
        label: 'Equipamento / Habilidades',
        text: '',
      },
    };
    patchSheet({ ...activeSheet, blocks: [...activeSheet.blocks, defaults[type]] });
  }

  function removeBlock(blockId: string) {
    if (!activeSheet) return;
    patchSheet({
      ...activeSheet,
      blocks: activeSheet.blocks.filter((b) => b.id !== blockId),
    });
  }

  function moveBlock(idx: number, dir: -1 | 1) {
    if (!activeSheet) return;
    const target = idx + dir;
    if (target < 0 || target >= activeSheet.blocks.length) return;
    const copy = [...activeSheet.blocks];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    patchSheet({ ...activeSheet, blocks: copy });
  }

  async function handleAvatarUpload(file: File | undefined) {
    if (!file || !activeSheet) return;
    setUploadingAvatar(true);
    try {
      const res = await uploadMediaFile(file, {
        ...uploadContext,
        optimizeFor: 'token',
      });
      setAvatarResolvedUrl(res.previewUrl);
      await onUpdateSheet({
        ...activeSheet,
        avatarMediaId: res.mediaId,
        avatarUrl: res.url,
      });
      onNotify(
        res.compressionSummary
          ? `Retrato atualizado (${res.compressionSummary}).`
          : `Retrato atualizado: ${res.fileName}`
      );
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao enviar foto do personagem.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handlePdfUploadToActive(file: File | undefined, autoBuildBlocks: boolean) {
    if (!file || !activeSheet) return;
    setUploadingPdf(true);
    try {
      const res = await uploadMediaFile(file, uploadContext);
      if (autoBuildBlocks) {
        const pdfBase64 = await fileToBase64(file);
        const apiRes = await fetch('/api/parse-sheet-pdf', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName: file.name, pdfBase64 }),
        });
        if (apiRes.ok) {
          const parsed = (await apiRes.json()) as ParsedPdfSheetResponse;
          await onUpdateSheet({
            ...activeSheet,
            name: parsed.characterName || activeSheet.name,
            subtitle: parsed.subtitle || activeSheet.subtitle,
            templateId: parsed.systemName || activeSheet.templateId,
            mode: 'modular',
            pdfMediaId: res.mediaId,
            pdfUrl: res.url,
            pdfFileName: res.fileName,
            blocks: parsed.blocks,
          });
          onNotify(`PDF lido e ficha montada (${parsed.systemName})!`);
          return;
        }
      }

      await onUpdateSheet({
        ...activeSheet,
        mode: 'pdf',
        pdfMediaId: res.mediaId,
        pdfUrl: res.url,
        pdfFileName: res.fileName,
      });
      onNotify(`PDF anexado: ${res.fileName}`);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Erro ao anexar PDF.');
    } finally {
      setUploadingPdf(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Sheet selector + Create button */}
      <div className="p-3 border-b vtt-border flex items-center gap-2 vtt-subtle">
        <select
          value={activeSheet?.id || ''}
          onChange={(e) => setSelectedId(e.target.value)}
          className="flex-1 px-2.5 py-2 text-xs border vtt-border vtt-surface min-w-0"
          aria-label="Selecionar ficha"
        >
          {sheets.length === 0 && <option value="">Nenhuma ficha criada</option>}
          {sheets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} {s.templateId ? `· ${s.templateId}` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setShowNewDrawer((v) => !v)}
          className="px-3 py-2 text-xs font-semibold vtt-accent-btn flex items-center gap-1 whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Nova
        </button>
      </div>

      {/* Create / Import PDF Sheet Drawer (Zero Hardcoded RPG Systems) */}
      {showNewDrawer && (
        <div className="p-4 border-b vtt-border vtt-canvas space-y-4">
          {/* Option 1: Smart PDF Import */}
          <div className="border vtt-border vtt-surface p-3.5 space-y-2.5">
            <div className="flex items-start gap-2">
              <Sparkles className="w-4 h-4 vtt-accent-text shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold font-typewriter">
                  Importar PDF (Auto-montar ficha)
                </p>
                <p className="text-[11px] vtt-muted leading-relaxed mt-0.5">
                  Envie a ficha ou livro em PDF de qualquer RPG. O sistema identifica as regras, extrai atributos, barras e já cria os botões de rolagem prontos.
                </p>
              </div>
            </div>

            <label className="w-full py-2.5 px-3 text-xs font-semibold vtt-accent-btn cursor-pointer flex items-center justify-center gap-2">
              {importingPdf ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{importStatus || 'Processando PDF...'}</span>
                </>
              ) : (
                <>
                  <FileUp className="w-4 h-4" />
                  <span>Escolher PDF da ficha</span>
                </>
              )}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={importingPdf}
                onChange={(e) => {
                  void handleSmartPdfImport(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {/* Option 2: Blank Custom Freeform Sheet */}
          <form onSubmit={handleCreateBlank} className="space-y-2.5">
            <p className="text-xs font-semibold">Ou criar ficha livre do zero</p>
            <input
              type="text"
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={100}
              placeholder="Nome do personagem"
              className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
            />
            <input
              type="text"
              value={newSystem}
              onChange={(e) => setNewSystem(e.target.value)}
              maxLength={80}
              placeholder="Nome do sistema (opcional, ex: Meu Sistema)"
              className="w-full px-3 py-2 text-xs border vtt-border vtt-surface"
            />
            <div className="flex items-center justify-between gap-2 pt-1">
              {activeSheet ? (
                <button
                  type="button"
                  onClick={() => void handleDuplicateCurrent()}
                  className="px-3 py-1.5 text-xs border vtt-border vtt-surface flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Duplicar atual
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewDrawer(false)}
                  className="px-3 py-1.5 text-xs border vtt-border"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  disabled={!newName.trim() || importingPdf}
                  className="px-4 py-1.5 text-xs font-semibold vtt-accent-btn disabled:opacity-50"
                >
                  Criar livre
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Active Sheet Content */}
      {!activeSheet ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
          <FileText className="w-8 h-8 vtt-muted" />
          <div className="space-y-1.5 max-w-xs">
            <p className="text-sm font-bold font-typewriter">Suas fichas, no seu sistema</p>
            <p className="text-xs vtt-muted leading-relaxed">
              Importe um PDF de qualquer RPG para montar a ficha automaticamente com rolagens prontas, ou construa sua própria ficha livre bloco por bloco.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-2">
            <label className="px-4 py-2.5 text-xs font-semibold vtt-accent-btn cursor-pointer flex items-center gap-1.5">
              {importingPdf ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {importStatus || 'Lendo PDF...'}
                </>
              ) : (
                <>
                  <FileUp className="w-3.5 h-3.5" />
                  Importar PDF (Auto-montar)
                </>
              )}
              <input
                type="file"
                accept="application/pdf"
                className="hidden"
                disabled={importingPdf}
                onChange={(e) => {
                  void handleSmartPdfImport(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => setShowNewDrawer(true)}
              className="px-4 py-2.5 text-xs font-semibold border vtt-border vtt-surface"
            >
              Criar do zero
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Character Header with Local Portrait Photo Upload */}
          <div className="space-y-3 border-b vtt-border pb-3.5">
            <div className="flex items-start gap-3">
              {/* Portrait Avatar Uploader (NO URL required!) */}
              <label
                className="relative w-14 h-14 border vtt-border vtt-subtle shrink-0 overflow-hidden cursor-pointer group flex items-center justify-center"
                title="Enviar foto do personagem"
              >
                {avatarResolvedUrl ? (
                  <img
                    src={avatarResolvedUrl}
                    alt={activeSheet.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Camera className="w-5 h-5 vtt-muted group-hover:opacity-100" />
                )}
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Upload className="w-4 h-4 text-white" />
                </div>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingAvatar}
                  onChange={(e) => {
                    void handleAvatarUpload(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </label>

              <div className="flex-1 space-y-1 min-w-0">
                <input
                  type="text"
                  value={activeSheet.name}
                  onChange={(e) => patchSheet({ ...activeSheet, name: e.target.value })}
                  className="w-full text-base font-bold font-typewriter bg-transparent border-b border-transparent focus:border-current pb-0.5"
                />
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={activeSheet.subtitle}
                    onChange={(e) => patchSheet({ ...activeSheet, subtitle: e.target.value })}
                    placeholder="Classe, arquétipo ou papel"
                    className="flex-1 text-xs vtt-muted bg-transparent border-b border-transparent focus:border-current min-w-0"
                  />
                  <input
                    type="text"
                    value={activeSheet.templateId || ''}
                    onChange={(e) => patchSheet({ ...activeSheet, templateId: e.target.value })}
                    placeholder="Sistema"
                    className="w-28 text-[11px] vtt-muted text-right bg-transparent border-b border-transparent focus:border-current shrink-0"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={() => void onDeleteSheet(activeSheet.id)}
                className="p-1.5 vtt-muted hover:text-red-700 shrink-0"
                title="Excluir ficha"
                aria-label="Excluir ficha"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-1 p-1 vtt-subtle border vtt-border">
              <button
                type="button"
                onClick={() => patchSheet({ ...activeSheet, mode: 'modular' })}
                className={`flex-1 py-1.5 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  activeSheet.mode === 'modular' ? 'vtt-accent-btn' : 'vtt-muted'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Ficha Interativa
              </button>
              <button
                type="button"
                onClick={() => patchSheet({ ...activeSheet, mode: 'pdf' })}
                className={`flex-1 py-1.5 text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap ${
                  activeSheet.mode === 'pdf' ? 'vtt-accent-btn' : 'vtt-muted'
                }`}
              >
                <FileText className="w-3.5 h-3.5" />
                PDF Original
              </button>
            </div>
          </div>

          {activeSheet.mode === 'pdf' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="px-3.5 py-2 text-xs font-semibold vtt-accent-btn cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
                    <Sparkles className="w-3.5 h-3.5" />
                    {uploadingPdf ? 'Lendo PDF...' : 'Enviar PDF e Auto-montar Blocos'}
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      disabled={uploadingPdf}
                      onChange={(e) => {
                        void handlePdfUploadToActive(e.target.files?.[0], true);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <label className="px-3 py-2 text-xs border vtt-border vtt-surface cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
                    <Upload className="w-3.5 h-3.5" />
                    Só anexar PDF
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      disabled={uploadingPdf}
                      onChange={(e) => {
                        void handlePdfUploadToActive(e.target.files?.[0], false);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>

                <input
                  type="text"
                  value={activeSheet.pdfUrl}
                  onChange={(e) =>
                    patchSheet({
                      ...activeSheet,
                      pdfUrl: e.target.value,
                      pdfFileName: e.target.value ? 'PDF externo' : '',
                    })
                  }
                  placeholder="Ou cole o link direto de um PDF (opcional)"
                  className="w-full px-3 py-2 text-xs border vtt-border vtt-canvas"
                />
              </div>

              {pdfResolvedUrl ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs vtt-muted">
                    <span className="truncate">{activeSheet.pdfFileName || 'Ficha PDF'}</span>
                    <a
                      href={pdfResolvedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline whitespace-nowrap shrink-0"
                    >
                      Abrir em nova aba
                    </a>
                  </div>
                  <iframe
                    src={pdfResolvedUrl}
                    title={`PDF de ${activeSheet.name}`}
                    className="w-full h-[520px] border vtt-border bg-white"
                  />
                </div>
              ) : (
                <div className="border vtt-border p-8 text-center space-y-2 vtt-canvas">
                  <FileText className="w-7 h-7 mx-auto vtt-muted" />
                  <p className="text-xs font-semibold">Nenhum PDF anexado</p>
                  <p className="text-[11px] vtt-muted">
                    Envie o PDF da ficha do seu sistema para consultá-lo aqui ou convertê-lo em blocos interativos com botões de rolagem.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {groupedBlocks.map((group) => (
                <section key={group.section} className="space-y-2.5">
                  <h4 className="text-[11px] font-bold uppercase tracking-wider vtt-muted border-b vtt-border pb-1">
                    {group.section}
                  </h4>

                  <div className="space-y-2.5">
                    {group.items.map(({ block, index }) => (
                      <div key={block.id} className="border vtt-border p-3 space-y-2.5 vtt-canvas">
                        {/* Block Header */}
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={block.label}
                            onChange={(e) => updateBlock(block.id, { label: e.target.value })}
                            className="flex-1 text-xs font-bold bg-transparent border-b border-transparent focus:border-current min-w-0"
                          />
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => moveBlock(index, -1)}
                              disabled={index === 0}
                              className="p-1 vtt-muted hover:opacity-100 disabled:opacity-30"
                              aria-label="Mover para cima"
                            >
                              <ArrowUp className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveBlock(index, 1)}
                              disabled={index === activeSheet.blocks.length - 1}
                              className="p-1 vtt-muted hover:opacity-100 disabled:opacity-30"
                              aria-label="Mover para baixo"
                            >
                              <ArrowDown className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeBlock(block.id)}
                              className="p-1 vtt-muted hover:text-red-700"
                              aria-label="Remover bloco"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>

                        {/* Resource Bar */}
                        {block.type === 'bar' && (
                          <div className="space-y-2">
                            <div className="h-2.5 w-full vtt-subtle overflow-hidden border vtt-border">
                              <div
                                className="h-full transition-all duration-150"
                                style={{
                                  width: `${Math.max(
                                    0,
                                    Math.min(
                                      100,
                                      ((block.current || 0) / Math.max(1, block.max || 1)) * 100
                                    )
                                  )}%`,
                                  backgroundColor: block.barColor || 'var(--accent-primary)',
                                }}
                              />
                            </div>
                            <div className="flex items-center gap-1 flex-wrap">
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(block.id, {
                                    current: Math.max(0, (block.current || 0) - 5),
                                  })
                                }
                                className="px-2 py-1 text-[11px] border vtt-border tabular-nums"
                              >
                                -5
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(block.id, {
                                    current: Math.max(0, (block.current || 0) - 1),
                                  })
                                }
                                className="p-1.5 border vtt-border"
                                aria-label="Diminuir 1"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <input
                                type="number"
                                value={block.current ?? 0}
                                onChange={(e) =>
                                  updateBlock(block.id, { current: Number(e.target.value) })
                                }
                                className="w-14 px-1.5 py-1 text-xs text-center font-bold tabular-nums border vtt-border vtt-surface"
                              />
                              <span className="text-xs vtt-muted">/</span>
                              <input
                                type="number"
                                value={block.max ?? 10}
                                onChange={(e) =>
                                  updateBlock(block.id, { max: Math.max(1, Number(e.target.value)) })
                                }
                                className="w-14 px-1.5 py-1 text-xs text-center tabular-nums border vtt-border vtt-surface"
                              />
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(block.id, { current: (block.current || 0) + 1 })
                                }
                                className="p-1.5 border vtt-border"
                                aria-label="Aumentar 1"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(block.id, { current: (block.current || 0) + 5 })
                                }
                                className="px-2 py-1 text-[11px] border vtt-border tabular-nums"
                              >
                                +5
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Rollable Attribute / Skill */}
                        {block.type === 'attribute' && (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              value={block.value ?? 0}
                              onChange={(e) =>
                                updateBlock(block.id, { value: Number(e.target.value) })
                              }
                              className="w-16 px-2 py-2 text-sm font-bold text-center tabular-nums border vtt-border vtt-surface"
                              aria-label={`Valor de ${block.label}`}
                            />
                            <input
                              type="text"
                              value={block.formula || ''}
                              onChange={(e) => updateBlock(block.id, { formula: e.target.value })}
                              placeholder="Ex: 1d20 + {Força}, 1d100 <= {Perícia}, 5d10>=6"
                              className="flex-1 px-2.5 py-2 text-xs border vtt-border vtt-surface min-w-0 font-mono"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                void onRollFromSheet({
                                  sheetName: activeSheet.name,
                                  label: block.label,
                                  formula: block.formula || `1d20 + {${block.label}}`,
                                  blocks: activeSheet.blocks,
                                })
                              }
                              className="px-3 py-2 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap shrink-0"
                            >
                              <Dices className="w-3.5 h-3.5" />
                              Rolar
                            </button>
                          </div>
                        )}

                        {/* Counter / Checkbox Slots */}
                        {block.type === 'counter' && (
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {Array.from({
                                length: Math.min(20, Math.max(1, block.maxCount || 5)),
                              }).map((_, i) => {
                                const filled = i < (block.count || 0);
                                return (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() =>
                                      updateBlock(block.id, {
                                        count:
                                          filled && i === (block.count || 0) - 1 ? i : i + 1,
                                      })
                                    }
                                    className={`w-6 h-6 border transition-colors ${
                                      filled
                                        ? 'vtt-accent-btn border-transparent'
                                        : 'vtt-surface vtt-border'
                                    }`}
                                    aria-label={`Marcador ${i + 1}`}
                                  />
                                );
                              })}
                            </div>
                            <div className="flex items-center gap-1 text-[11px] vtt-muted tabular-nums">
                              <span>
                                {block.count || 0}/{block.maxCount || 5}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(block.id, {
                                    maxCount: Math.max(1, (block.maxCount || 5) - 1),
                                  })
                                }
                                className="px-1.5 py-0.5 border vtt-border"
                              >
                                -
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  updateBlock(block.id, {
                                    maxCount: Math.min(20, (block.maxCount || 5) + 1),
                                  })
                                }
                                className="px-1.5 py-0.5 border vtt-border"
                              >
                                +
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Free Text */}
                        {block.type === 'text' && (
                          <textarea
                            value={block.text || ''}
                            onChange={(e) => updateBlock(block.id, { text: e.target.value })}
                            rows={3}
                            placeholder="Escreva habilidades, equipamentos, magias ou anotações..."
                            className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface resize-y leading-relaxed"
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              ))}

              {/* Add Block Bar */}
              <div className="border-t vtt-border pt-3 space-y-2">
                <p className="text-[11px] vtt-muted">Adicionar bloco na ficha</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => addBlock('attribute')}
                    className="py-2 px-2.5 text-xs border vtt-border vtt-surface hover:opacity-80 flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Atributo / Rolagem
                  </button>
                  <button
                    type="button"
                    onClick={() => addBlock('bar')}
                    className="py-2 px-2.5 text-xs border vtt-border vtt-surface hover:opacity-80 flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Barra de Recurso
                  </button>
                  <button
                    type="button"
                    onClick={() => addBlock('counter')}
                    className="py-2 px-2.5 text-xs border vtt-border vtt-surface hover:opacity-80 flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Contador / Caixas
                  </button>
                  <button
                    type="button"
                    onClick={() => addBlock('text')}
                    className="py-2 px-2.5 text-xs border vtt-border vtt-surface hover:opacity-80 flex items-center justify-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" /> Bloco de Texto
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
