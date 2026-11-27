import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Camera,
  ChevronDown,
  ChevronRight,
  Copy,
  Dices,
  Eye,
  EyeOff,
  FileText,
  FileUp,
  GripVertical,
  Layers,
  Loader2,
  Maximize2,
  Minus,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Trash2,
  Upload,
  X,
  Zap,
} from 'lucide-react';
import type { CharacterSheet, SheetBlock, SheetBlockType } from '../types/vtt';
import {
  resolveMediaUrl,
  uploadMediaFile,
  type CampaignUploadContext,
} from '../lib/mediaStore';
import { parseSheetPdfInBrowser } from '../lib/clientPdfParser';
import { buildAutoItemFormula } from '../lib/diceEngine';

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
  canDragToCanvas?: boolean;
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

export type SystemDicePresetId =
  | '1d20'
  | 'pool_d20'
  | '1d100'
  | '2d6'
  | 'pool_d10'
  | 'pool_d6';

export const SYSTEM_DICE_PRESETS: Array<{
  id: SystemDicePresetId;
  label: string;
  shortDesc: string;
}> = [
  { id: '1d20', label: '1d20 + Atributo', shortDesc: 'D20 clássico (D&D, Tormenta, Pathfinder)' },
  { id: 'pool_d20', label: 'Pool d20 (Maior)', shortDesc: 'Rola {Atributo}d20 e pega o maior (Ordem)' },
  { id: '1d100', label: 'd100 <= Atributo', shortDesc: 'Percentual (Call of Cthulhu, Delta Green)' },
  { id: '2d6', label: '2d6 + Atributo', shortDesc: 'Narrativo (PbtA, Apocalypse World)' },
  { id: 'pool_d10', label: 'Pool d10 (Sucessos)', shortDesc: 'Conta dados >= 6 (Storyteller / Vampiro)' },
  { id: 'pool_d6', label: 'Pool d6 + Bônus', shortDesc: 'Rola {Atributo}d6 somados' },
];

export const ITEM_DICE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: '1d20', label: '1d20 + Atributo' },
  { id: 'pool_d20', label: '{Atributo}d20 (Maior)' },
  { id: '1d100', label: '1d100 <= Atributo' },
  { id: '2d6', label: '2d6 + Atributo' },
  { id: 'pool_d10', label: '{Atributo}d10 (Sucessos >=6)' },
  { id: 'pool_d6', label: '{Atributo}d6 + Bônus' },
  { id: '1d12', label: '1d12 + Atributo' },
  { id: '1d10', label: '1d10 + Atributo' },
  { id: '1d8', label: '1d8 + Atributo' },
  { id: '1d6', label: '1d6 + Atributo' },
  { id: '1d4', label: '1d4 + Atributo' },
];

function buildStarterBlocksForPreset(
  preset: SystemDicePresetId,
  customAttrsCsv: string
): SheetBlock[] {
  const ts = Date.now().toString(36);
  const rawNames = customAttrsCsv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const attrNames =
    rawNames.length > 0
      ? rawNames
      : preset === '1d100'
        ? ['Força', 'Destreza', 'Inteligência', 'Poder', 'Investigação']
        : ['Força', 'Agilidade', 'Intelecto', 'Vigor', 'Presença'];

  const defaultVal = preset === '1d100' ? 50 : 2;

  const bars: SheetBlock[] = [
    {
      id: `blk_${ts}_hp`,
      type: 'bar',
      section: 'Recursos',
      label: 'Vida',
      current: 15,
      max: 15,
      barColor: '#8f2d2d',
    },
    {
      id: `blk_${ts}_energy`,
      type: 'bar',
      section: 'Recursos',
      label: 'Energia / Sanidade',
      current: 10,
      max: 10,
      barColor: '#37546e',
    },
  ];

  const attrs: SheetBlock[] = attrNames.map((name, idx) => ({
    id: `blk_${ts}_attr_${idx}`,
    type: 'attribute',
    section: 'Atributos',
    label: name,
    value: defaultVal,
    diceType: preset,
    formula: buildAutoItemFormula({
      diceType: preset,
      linkedAttribute: name,
    }),
  }));

  const firstAttr = attrNames[0] || 'Força';
  const starterItem: SheetBlock = {
    id: `blk_${ts}_item_0`,
    type: 'item',
    section: 'Itens & Habilidades',
    label: 'Arma / Habilidade Principal',
    linkedAttribute: firstAttr,
    secondaryAttribute: '',
    diceType: preset,
    bonus: 0,
    formula: buildAutoItemFormula({
      diceType: preset,
      linkedAttribute: firstAttr,
      bonus: 0,
    }),
    damageLabel: 'Dano',
    damageFormula: preset === '1d100' ? '1d8' : `1d8 + {${firstAttr}}`,
    text: 'Rola automaticamente usando o atributo escolhido.',
  };

  return [...bars, ...attrs, starterItem];
}

export function CharacterSheetPanel({
  uploadContext,
  sheets,
  canDragToCanvas = false,
  onCreateSheet,
  onUpdateSheet,
  onDeleteSheet,
  onRollFromSheet,
  onNotify,
}: CharacterSheetPanelProps) {
  const [selectedId, setSelectedId] = useState<string>(sheets[0]?.id || '');
  const [showNewDrawer, setShowNewDrawer] = useState(false);
  const [showA4Modal, setShowA4Modal] = useState(false);

  // Progressive disclosure: collapsible sub-sections & quick section visibility toggles
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [hiddenSections, setHiddenSections] = useState<Record<string, boolean>>({});
  const [showSectionFilterBar, setShowSectionFilterBar] = useState(false);
  const [showQuickTools, setShowQuickTools] = useState(false);
  const [showAddBlockMenu, setShowAddBlockMenu] = useState(false);

  // Blank / Custom System sheet creator form
  const [newName, setNewName] = useState('');
  const [newSystem, setNewSystem] = useState('');
  const [newSystemPreset, setNewSystemPreset] = useState<SystemDicePresetId>('1d20');
  const [newAttrsCsv, setNewAttrsCsv] = useState('Força, Agilidade, Intelecto, Vigor, Presença');

  // Quick add attribute / item states inside active sheet
  const [quickAttrName, setQuickAttrName] = useState('');
  const [quickAttrVal, setQuickAttrVal] = useState<number>(2);
  const [showItemCreator, setShowItemCreator] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemAttr1, setItemAttr1] = useState('');
  const [itemAttr2, setItemAttr2] = useState('');
  const [itemDice, setItemDice] = useState<string>('1d20');
  const [itemBonus, setItemBonus] = useState<number>(0);
  const [itemDamage, setItemDamage] = useState('');
  const [itemNotes, setItemNotes] = useState('');
  const [expandedItemConfigId, setExpandedItemConfigId] = useState<string | null>(null);

  // PDF import state
  const [importingPdf, setImportingPdf] = useState(false);
  const [importStatus, setImportStatus] = useState('');
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const [pdfResolvedUrl, setPdfResolvedUrl] = useState('');
  const [avatarResolvedUrl, setAvatarResolvedUrl] = useState('');

  const activeSheet = sheets.find((s) => s.id === selectedId) || sheets[0] || null;

  // All rollable attributes on the active sheet (available to link to items!)
  const sheetAttributes = useMemo(() => {
    if (!activeSheet) return [];
    return activeSheet.blocks.filter((b) => b.type === 'attribute');
  }, [activeSheet]);

  useEffect(() => {
    if (!activeSheet && sheets.length > 0) {
      setSelectedId(sheets[0].id);
    }
  }, [sheets, activeSheet]);

  useEffect(() => {
    if (sheetAttributes.length > 0 && !itemAttr1) {
      setItemAttr1(sheetAttributes[0].label);
      const inferredDice = sheetAttributes[0].diceType || '1d20';
      setItemDice(inferredDice);
    }
  }, [sheetAttributes, itemAttr1]);

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
      const defaultSec =
        block.type === 'item'
          ? 'Itens & Habilidades'
          : block.type === 'attribute'
            ? 'Atributos'
            : block.type === 'bar' || block.type === 'counter'
              ? 'Recursos'
              : 'Notas';
      const sec = (block.section || defaultSec).trim() || defaultSec;
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
    const starterBlocks = buildStarterBlocksForPreset(newSystemPreset, newAttrsCsv);
    const id = await onCreateSheet({
      name: newName.trim(),
      subtitle: newSystem.trim() || 'Sistema Personalizado',
      systemName: newSystem.trim() || 'Sistema Livre',
      mode: 'modular',
      blocks: starterBlocks,
    });
    setSelectedId(id);
    setNewName('');
    setNewSystem('');
    setShowNewDrawer(false);
    onNotify('Ficha personalizada criada com atributos e rolagens automáticas.');
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
    setImportStatus('Lendo PDF e montando atributos e rolagens...');
    try {
      const [uploadRes, parsed] = await Promise.all([
        uploadMediaFile(file, uploadContext),
        parseSheetPdfInBrowser(file),
      ]);

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
    const blocks = activeSheet.blocks.map((b) => {
      if (b.id !== blockId) return b;
      const merged = { ...b, ...patch };
      // Automatically keep item/attribute formula in sync when attribute link, diceType, or bonus changes
      if (
        (merged.type === 'item' || merged.type === 'attribute') &&
        ('linkedAttribute' in patch ||
          'secondaryAttribute' in patch ||
          'diceType' in patch ||
          'bonus' in patch ||
          (merged.type === 'attribute' && 'label' in patch))
      ) {
        merged.formula = buildAutoItemFormula({
          diceType: merged.diceType || '1d20',
          linkedAttribute:
            merged.type === 'attribute' ? merged.label : merged.linkedAttribute,
          secondaryAttribute: merged.secondaryAttribute,
          bonus: merged.bonus,
        });
      }
      return merged;
    });
    patchSheet({ ...activeSheet, blocks });
  }

  function handleQuickAddAttribute(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSheet || !quickAttrName.trim()) return;
    const label = quickAttrName.trim();
    const existingAttr = sheetAttributes[0];
    const dicePreset = existingAttr?.diceType || '1d20';
    const newBlock: SheetBlock = {
      id: `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      type: 'attribute',
      section: 'Atributos',
      label,
      value: quickAttrVal,
      diceType: dicePreset,
      formula: buildAutoItemFormula({
        diceType: dicePreset,
        linkedAttribute: label,
      }),
    };
    patchSheet({ ...activeSheet, blocks: [...activeSheet.blocks, newBlock] });
    setQuickAttrName('');
    onNotify(`Atributo "${label}" adicionado.`);
  }

  function handleCreateCustomItem(e: React.FormEvent) {
    e.preventDefault();
    if (!activeSheet || !itemName.trim()) return;
    const label = itemName.trim();
    const formula = buildAutoItemFormula({
      diceType: itemDice,
      linkedAttribute: itemAttr1,
      secondaryAttribute: itemAttr2,
      bonus: itemBonus,
    });
    const newBlock: SheetBlock = {
      id: `itm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      type: 'item',
      section: 'Itens & Habilidades',
      label,
      linkedAttribute: itemAttr1,
      secondaryAttribute: itemAttr2,
      diceType: itemDice,
      bonus: itemBonus,
      formula,
      damageLabel: 'Dano',
      damageFormula: itemDamage.trim(),
      text: itemNotes.trim(),
    };
    patchSheet({ ...activeSheet, blocks: [...activeSheet.blocks, newBlock] });
    setItemName('');
    setItemBonus(0);
    setItemDamage('');
    setItemNotes('');
    setShowItemCreator(false);
    onNotify(`Item "${label}" adicionado com rolagem automática!`);
  }

  function addBlock(type: SheetBlockType) {
    if (!activeSheet) return;
    const id = `blk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
    const firstAttr = sheetAttributes[0]?.label || '';
    const inferredDice = sheetAttributes[0]?.diceType || '1d20';
    const defaults: Record<SheetBlockType, SheetBlock> = {
      bar: {
        id,
        type: 'bar',
        section: 'Recursos',
        label: 'Recurso (Vida / Sanidade / Mana)',
        current: 10,
        max: 10,
        barColor: '#8f2d2d',
      },
      attribute: {
        id,
        type: 'attribute',
        section: 'Atributos',
        label: 'Novo Atributo',
        value: inferredDice === '1d100' ? 50 : 2,
        diceType: inferredDice,
        formula: buildAutoItemFormula({
          diceType: inferredDice,
          linkedAttribute: 'Novo Atributo',
        }),
      },
      item: {
        id,
        type: 'item',
        section: 'Itens & Habilidades',
        label: 'Novo Item / Habilidade',
        linkedAttribute: firstAttr,
        secondaryAttribute: '',
        diceType: inferredDice,
        bonus: 0,
        formula: buildAutoItemFormula({
          diceType: inferredDice,
          linkedAttribute: firstAttr,
          bonus: 0,
        }),
        damageLabel: 'Dano',
        damageFormula: firstAttr ? `1d8 + {${firstAttr}}` : '1d8',
        text: '',
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
        label: 'Anotações / Inventário',
        text: '',
      },
    };
    patchSheet({ ...activeSheet, blocks: [...activeSheet.blocks, defaults[type]] });
    if (type === 'item') {
      setExpandedItemConfigId(id);
    }
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
      if (autoBuildBlocks) {
        const [res, parsed] = await Promise.all([
          uploadMediaFile(file, uploadContext),
          parseSheetPdfInBrowser(file).catch(() => null),
        ]);
        if (parsed) {
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
        await onUpdateSheet({
          ...activeSheet,
          mode: 'pdf',
          pdfMediaId: res.mediaId,
          pdfUrl: res.url,
          pdfFileName: res.fileName,
        });
        onNotify(`PDF anexado: ${res.fileName}`);
        return;
      }

      const res = await uploadMediaFile(file, uploadContext);
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

  function toggleSectionCollapsed(section: string) {
    setCollapsedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  function toggleSectionHidden(section: string) {
    setHiddenSections((prev) => ({ ...prev, [section]: !prev[section] }));
  }

  function handleDragPortraitToCanvas(e: React.DragEvent) {
    if (!activeSheet || !canDragToCanvas) return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData(
      'application/x-folio-sheet-token',
      JSON.stringify({
        sheetId: activeSheet.id,
        name: activeSheet.name,
        layerKind: 'token',
        tokenCategory: 'player',
        shape: 'circle',
        imageUrl: activeSheet.avatarUrl || '',
        mediaId: activeSheet.avatarMediaId || '',
        notes: activeSheet.subtitle || '',
        sizePx: 58,
        widthPx: 58,
        heightPx: 58,
        color: '#2f5d46',
        outlineStyle: 'solid',
        outlineColor: '#2f5d46',
      })
    );
  }

  function renderActiveSheetBody(isA4View: boolean) {
    if (!activeSheet) return null;

    if (activeSheet.mode === 'pdf') {
      return (
        <div className="space-y-3 h-full flex flex-col">
          <div className="grid grid-cols-1 gap-2 shrink-0">
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
            <div className="space-y-2 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between text-xs vtt-muted shrink-0">
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
                className={`w-full border vtt-border bg-white ${
                  isA4View ? 'flex-1 min-h-[68vh]' : 'h-[520px]'
                }`}
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
      );
    }

    const visibleGroups = groupedBlocks.filter((g) => !hiddenSections[g.section]);

    return (
      <div className="space-y-4">
        {/* Compact Sub-bar: Section Visibility Toggles & Quick Add Collapsible */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => setShowQuickTools((v) => !v)}
              className="px-2.5 py-1.5 text-[11px] font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap"
            >
              {showQuickTools ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
              <Swords className="w-3 h-3" />
              + Item / Atributo
            </button>

            <button
              type="button"
              onClick={() => setShowSectionFilterBar((v) => !v)}
              className={`px-2.5 py-1.5 text-[11px] border flex items-center gap-1 whitespace-nowrap ${
                showSectionFilterBar
                  ? 'vtt-subtle border-amber-500/60 font-semibold'
                  : 'vtt-border vtt-canvas vtt-muted hover:opacity-100'
              }`}
              title="Escolher quais seções da ficha ficam visíveis"
            >
              <SlidersHorizontal className="w-3 h-3" />
              Seções ({visibleGroups.length}/{groupedBlocks.length})
              {showSectionFilterBar ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
          </div>

          {/* Toggleable Section Visibility Pills */}
          {showSectionFilterBar && groupedBlocks.length > 0 && (
            <div className="p-2.5 border vtt-border vtt-canvas space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider font-semibold vtt-muted">
                  Mostrar / Ocultar Subabas da Ficha
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setHiddenSections({});
                    setCollapsedSections({});
                  }}
                  className="text-[10px] vtt-accent-text hover:underline"
                >
                  Mostrar todas
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {groupedBlocks.map((g) => {
                  const isHidden = Boolean(hiddenSections[g.section]);
                  return (
                    <button
                      key={g.section}
                      type="button"
                      onClick={() => toggleSectionHidden(g.section)}
                      className={`px-2 py-1 text-[11px] border flex items-center gap-1 transition-colors ${
                        isHidden
                          ? 'vtt-canvas vtt-border vtt-muted opacity-55 line-through'
                          : 'vtt-surface vtt-border font-semibold'
                      }`}
                    >
                      {isHidden ? (
                        <EyeOff className="w-3 h-3" />
                      ) : (
                        <Eye className="w-3 h-3 vtt-accent-text" />
                      )}
                      <span>{g.section}</span>
                      <span className="text-[10px] vtt-muted tabular-nums">({g.items.length})</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Collapsible Quick Item / Attribute Creator */}
          {showQuickTools && (
            <div className="space-y-2 border vtt-border p-3 vtt-canvas">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setShowItemCreator((v) => !v)}
                  className="flex-1 py-2 px-3 text-xs font-semibold vtt-accent-btn flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Swords className="w-3.5 h-3.5" />
                  {showItemCreator ? 'Ocultar criador de item' : '+ Novo Item / Habilidade com Atributo'}
                </button>
              </div>

              {showItemCreator && (
                <form
                  onSubmit={handleCreateCustomItem}
                  className="border vtt-border p-3 vtt-surface space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold font-typewriter flex items-center gap-1.5">
                      <Swords className="w-3.5 h-3.5 vtt-accent-text" />
                      Novo Item, Arma ou Habilidade
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowItemCreator(false)}
                      className="text-[11px] vtt-muted"
                    >
                      Fechar
                    </button>
                  </div>

                  <input
                    type="text"
                    required
                    value={itemName}
                    onChange={(e) => setItemName(e.target.value)}
                    placeholder="Nome (ex: Espada Longa, Revólver, Feitiço, Furtividade)"
                    className="w-full px-3 py-2 text-xs border vtt-border vtt-canvas"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold block">Rolar com Atributo</span>
                      <select
                        value={itemAttr1}
                        onChange={(e) => setItemAttr1(e.target.value)}
                        className="w-full px-2 py-2 text-xs border vtt-border vtt-canvas"
                      >
                        <option value="">Sem atributo</option>
                        {sheetAttributes.map((attr) => (
                          <option key={attr.id} value={attr.label}>
                            {attr.label} ({attr.value ?? 0})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold block">
                        2º Atributo / Perícia (opc.)
                      </span>
                      <select
                        value={itemAttr2}
                        onChange={(e) => setItemAttr2(e.target.value)}
                        className="w-full px-2 py-2 text-xs border vtt-border vtt-canvas"
                      >
                        <option value="">Nenhum</option>
                        {sheetAttributes.map((attr) => (
                          <option key={attr.id} value={attr.label}>
                            + {attr.label} ({attr.value ?? 0})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="grid grid-cols-3 gap-2">
                    <label className="col-span-2 space-y-1">
                      <span className="text-[11px] font-semibold block">Regra do Dado</span>
                      <select
                        value={itemDice}
                        onChange={(e) => setItemDice(e.target.value)}
                        className="w-full px-2 py-2 text-xs border vtt-border vtt-canvas"
                      >
                        {ITEM_DICE_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1">
                      <span className="text-[11px] font-semibold block">Bônus Extra</span>
                      <input
                        type="number"
                        value={itemBonus}
                        onChange={(e) => setItemBonus(Number(e.target.value))}
                        className="w-full px-2 py-2 text-xs border vtt-border vtt-canvas text-center tabular-nums"
                      />
                    </label>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold">
                        Rolagem de Dano / Efeito (opcional)
                      </span>
                      {sheetAttributes.length > 0 && (
                        <div className="flex items-center gap-1 overflow-x-auto">
                          {sheetAttributes.slice(0, 3).map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() =>
                                setItemDamage((prev) =>
                                  prev ? `${prev} + {${a.label}}` : `1d8 + {${a.label}}`
                                )
                              }
                              className="px-1.5 py-0.5 text-[10px] border vtt-border vtt-canvas whitespace-nowrap"
                              title={`Somar ${a.label} no dano`}
                            >
                              + {a.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input
                      type="text"
                      value={itemDamage}
                      onChange={(e) => setItemDamage(e.target.value)}
                      placeholder="Ex: 1d8 + {Força} ou 2d6"
                      className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-canvas font-mono"
                    />
                  </div>

                  <input
                    type="text"
                    value={itemNotes}
                    onChange={(e) => setItemNotes(e.target.value)}
                    placeholder="Notas curtas (ex: Alcance médio, crítico 19-20)"
                    className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-canvas"
                  />

                  <button
                    type="submit"
                    disabled={!itemName.trim()}
                    className="w-full py-2 text-xs font-semibold vtt-accent-btn disabled:opacity-50"
                  >
                    Adicionar à Ficha
                  </button>
                </form>
              )}

              {/* Quick 1-Line Add Attribute Form */}
              <form onSubmit={handleQuickAddAttribute} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={quickAttrName}
                  onChange={(e) => setQuickAttrName(e.target.value)}
                  placeholder="Novo atributo rápido (ex: Destreza, Luta)..."
                  className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border vtt-border vtt-surface"
                />
                <input
                  type="number"
                  value={quickAttrVal}
                  onChange={(e) => setQuickAttrVal(Number(e.target.value))}
                  className="w-14 px-2 py-1.5 text-xs text-center tabular-nums border vtt-border vtt-surface"
                  title="Valor do atributo"
                />
                <button
                  type="submit"
                  disabled={!quickAttrName.trim()}
                  className="px-2.5 py-1.5 text-xs font-semibold border vtt-border vtt-surface hover:vtt-subtle disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  + Atributo
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Collapsible Grouped Sheet Sections (2-column grid in A4 mode!) */}
        <div className={isA4View ? 'grid grid-cols-1 md:grid-cols-2 gap-5 items-start' : 'space-y-4'}>
          {visibleGroups.map((group) => {
            const isCollapsed = Boolean(collapsedSections[group.section]);
            return (
              <section key={group.section} className="border vtt-border vtt-surface/60">
                <button
                  type="button"
                  onClick={() => toggleSectionCollapsed(group.section)}
                  className="w-full px-3 py-2 flex items-center justify-between gap-2 vtt-subtle hover:opacity-95 transition-opacity text-left"
                >
                  <span className="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5 vtt-accent-text" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 vtt-accent-text" />
                    )}
                    {group.section}
                  </span>
                  <span className="text-[10px] vtt-muted tabular-nums">
                    {group.items.length} {group.items.length === 1 ? 'bloco' : 'blocos'}
                  </span>
                </button>

                {!isCollapsed && (
                  <div className="p-2.5 space-y-2.5">
                    {group.items.map(({ block, index }) => {
                      const isItemExpanded = expandedItemConfigId === block.id;
                      const autoItemFormula =
                        block.formula ||
                        buildAutoItemFormula({
                          diceType: block.diceType || '1d20',
                          linkedAttribute:
                            block.type === 'attribute' ? block.label : block.linkedAttribute,
                          secondaryAttribute: block.secondaryAttribute,
                          bonus: block.bonus,
                        });

                      return (
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
                              {(block.type === 'item' || block.type === 'attribute') && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedItemConfigId((cur) =>
                                      cur === block.id ? null : block.id
                                    )
                                  }
                                  className={`p-1 ${
                                    isItemExpanded ? 'vtt-accent-text' : 'vtt-muted hover:opacity-100'
                                  }`}
                                  title="Configurar atributo e dados desta rolagem"
                                >
                                  <SlidersHorizontal className="w-3 h-3" />
                                </button>
                              )}
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
                                    updateBlock(block.id, {
                                      max: Math.max(1, Number(e.target.value)),
                                    })
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
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <div className="flex items-center border vtt-border vtt-surface">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateBlock(block.id, { value: (block.value ?? 0) - 1 })
                                    }
                                    className="px-2 py-1.5 text-xs vtt-muted hover:opacity-100"
                                  >
                                    -
                                  </button>
                                  <input
                                    type="number"
                                    value={block.value ?? 0}
                                    onChange={(e) =>
                                      updateBlock(block.id, { value: Number(e.target.value) })
                                    }
                                    className="w-12 py-1.5 text-sm font-bold text-center tabular-nums bg-transparent"
                                    aria-label={`Valor de ${block.label}`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      updateBlock(block.id, { value: (block.value ?? 0) + 1 })
                                    }
                                    className="px-2 py-1.5 text-xs vtt-muted hover:opacity-100"
                                  >
                                    +
                                  </button>
                                </div>

                                <select
                                  value={block.diceType || '1d20'}
                                  onChange={(e) =>
                                    updateBlock(block.id, { diceType: e.target.value })
                                  }
                                  className="flex-1 min-w-0 px-2 py-2 text-xs border vtt-border vtt-surface"
                                  title="Tipo de dado deste atributo"
                                >
                                  {ITEM_DICE_OPTIONS.map((opt) => (
                                    <option key={opt.id} value={opt.id}>
                                      {opt.label}
                                    </option>
                                  ))}
                                </select>

                                <button
                                  type="button"
                                  onClick={() =>
                                    void onRollFromSheet({
                                      sheetName: activeSheet.name,
                                      label: block.label,
                                      formula: autoItemFormula,
                                      blocks: activeSheet.blocks,
                                    })
                                  }
                                  className="px-3 py-2 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap shrink-0"
                                >
                                  <Dices className="w-3.5 h-3.5" />
                                  Rolar
                                </button>
                              </div>

                              {isItemExpanded && (
                                <input
                                  type="text"
                                  value={block.formula || autoItemFormula}
                                  onChange={(e) =>
                                    updateBlock(block.id, { formula: e.target.value })
                                  }
                                  placeholder="Fórmula customizada (ex: 1d20 + {Força})"
                                  className="w-full px-2.5 py-1.5 text-xs border vtt-border vtt-surface font-mono"
                                />
                              )}
                            </div>
                          )}

                          {/* Universal Custom Item / Weapon / Ability linked to Chosen Attributes */}
                          {block.type === 'item' && (
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 text-[11px] vtt-muted flex-wrap">
                                  <span>
                                    Usa:{' '}
                                    <strong className="text-stone-900 dark:text-stone-100">
                                      {block.linkedAttribute || 'Dado puro'}
                                      {block.secondaryAttribute
                                        ? ` + ${block.secondaryAttribute}`
                                        : ''}
                                    </strong>
                                  </span>
                                  {block.bonus ? (
                                    <span>
                                      · Bônus{' '}
                                      <strong className="tabular-nums">
                                        {block.bonus > 0 ? `+${block.bonus}` : block.bonus}
                                      </strong>
                                    </span>
                                  ) : null}
                                  <span className="font-mono text-[10px]">
                                    ({autoItemFormula})
                                  </span>
                                </div>

                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void onRollFromSheet({
                                        sheetName: activeSheet.name,
                                        label: block.label,
                                        formula: autoItemFormula,
                                        blocks: activeSheet.blocks,
                                      })
                                    }
                                    className="px-3 py-1.5 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap"
                                  >
                                    <Dices className="w-3.5 h-3.5" />
                                    Rolar
                                  </button>

                                  {block.damageFormula && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void onRollFromSheet({
                                          sheetName: activeSheet.name,
                                          label: `${block.label} (${block.damageLabel || 'Dano'})`,
                                          formula: block.damageFormula || '1d6',
                                          blocks: activeSheet.blocks,
                                        })
                                      }
                                      className="px-2.5 py-1.5 text-xs font-semibold border vtt-border vtt-surface hover:vtt-subtle flex items-center gap-1 whitespace-nowrap"
                                    >
                                      <Zap className="w-3.5 h-3.5 vtt-accent-text" />
                                      {block.damageLabel || 'Dano'}
                                    </button>
                                  )}
                                </div>
                              </div>

                              {block.text && !isItemExpanded && (
                                <p className="text-[11px] vtt-muted leading-relaxed">
                                  {block.text}
                                </p>
                              )}

                              {isItemExpanded && (
                                <div className="pt-2 border-t vtt-border space-y-2">
                                  <div className="grid grid-cols-2 gap-1.5">
                                    <label className="space-y-0.5">
                                      <span className="text-[10px] vtt-muted">Atributo Principal</span>
                                      <select
                                        value={block.linkedAttribute || ''}
                                        onChange={(e) =>
                                          updateBlock(block.id, {
                                            linkedAttribute: e.target.value,
                                          })
                                        }
                                        className="w-full px-2 py-1.5 text-xs border vtt-border vtt-surface"
                                      >
                                        <option value="">Sem atributo</option>
                                        {sheetAttributes.map((attr) => (
                                          <option key={attr.id} value={attr.label}>
                                            {attr.label} ({attr.value ?? 0})
                                          </option>
                                        ))}
                                      </select>
                                    </label>

                                    <label className="space-y-0.5">
                                      <span className="text-[10px] vtt-muted">2º Atributo (opc.)</span>
                                      <select
                                        value={block.secondaryAttribute || ''}
                                        onChange={(e) =>
                                          updateBlock(block.id, {
                                            secondaryAttribute: e.target.value,
                                          })
                                        }
                                        className="w-full px-2 py-1.5 text-xs border vtt-border vtt-surface"
                                      >
                                        <option value="">Nenhum</option>
                                        {sheetAttributes.map((attr) => (
                                          <option key={attr.id} value={attr.label}>
                                            + {attr.label} ({attr.value ?? 0})
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>

                                  <div className="grid grid-cols-3 gap-1.5">
                                    <label className="col-span-2 space-y-0.5">
                                      <span className="text-[10px] vtt-muted">Dado</span>
                                      <select
                                        value={block.diceType || '1d20'}
                                        onChange={(e) =>
                                          updateBlock(block.id, { diceType: e.target.value })
                                        }
                                        className="w-full px-2 py-1.5 text-xs border vtt-border vtt-surface"
                                      >
                                        {ITEM_DICE_OPTIONS.map((opt) => (
                                          <option key={opt.id} value={opt.id}>
                                            {opt.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>

                                    <label className="space-y-0.5">
                                      <span className="text-[10px] vtt-muted">Bônus</span>
                                      <input
                                        type="number"
                                        value={block.bonus ?? 0}
                                        onChange={(e) =>
                                          updateBlock(block.id, { bonus: Number(e.target.value) })
                                        }
                                        className="w-full px-2 py-1.5 text-xs border vtt-border vtt-surface text-center tabular-nums"
                                      />
                                    </label>
                                  </div>

                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] vtt-muted">
                                        Fórmula de Dano / Efeito
                                      </span>
                                      {sheetAttributes.length > 0 && (
                                        <div className="flex items-center gap-1">
                                          {sheetAttributes.slice(0, 3).map((a) => (
                                            <button
                                              key={a.id}
                                              type="button"
                                              onClick={() =>
                                                updateBlock(block.id, {
                                                  damageFormula: block.damageFormula
                                                    ? `${block.damageFormula} + {${a.label}}`
                                                    : `1d8 + {${a.label}}`,
                                                })
                                              }
                                              className="px-1.5 py-0.5 text-[10px] border vtt-border vtt-surface"
                                            >
                                              + {a.label}
                                            </button>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                    <input
                                      type="text"
                                      value={block.damageFormula || ''}
                                      onChange={(e) =>
                                        updateBlock(block.id, { damageFormula: e.target.value })
                                      }
                                      placeholder="Ex: 1d8 + {Força}"
                                      className="w-full px-2 py-1.5 text-xs border vtt-border vtt-surface font-mono"
                                    />
                                  </div>

                                  <input
                                    type="text"
                                    value={block.text || ''}
                                    onChange={(e) =>
                                      updateBlock(block.id, { text: e.target.value })
                                    }
                                    placeholder="Descrição ou propriedades do item..."
                                    className="w-full px-2 py-1.5 text-xs border vtt-border vtt-surface"
                                  />
                                </div>
                              )}
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
                              rows={isA4View ? 4 : 3}
                              placeholder="Escreva habilidades, equipamentos, magias ou anotações..."
                              className="w-full px-2.5 py-2 text-xs border vtt-border vtt-surface resize-y leading-relaxed"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        {/* Collapsible Add Block Sub-menu */}
        <div className="border-t vtt-border pt-3 space-y-2">
          <button
            type="button"
            onClick={() => setShowAddBlockMenu((v) => !v)}
            className="w-full py-2 px-3 text-xs font-semibold border vtt-border vtt-surface hover:vtt-subtle flex items-center justify-between"
          >
            <span className="flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 vtt-accent-text" />
              Adicionar bloco na ficha
            </span>
            {showAddBlockMenu ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )}
          </button>

          {showAddBlockMenu && (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => addBlock('item')}
                className="py-2 px-2.5 text-xs font-semibold border vtt-border vtt-surface hover:vtt-subtle flex items-center justify-center gap-1.5"
              >
                <Swords className="w-3.5 h-3.5 vtt-accent-text" /> + Item com Rolagem
              </button>
              <button
                type="button"
                onClick={() => addBlock('attribute')}
                className="py-2 px-2.5 text-xs border vtt-border vtt-surface hover:opacity-80 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> + Atributo
              </button>
              <button
                type="button"
                onClick={() => addBlock('bar')}
                className="py-2 px-2.5 text-xs border vtt-border vtt-surface hover:opacity-80 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> + Barra (Vida/Mana)
              </button>
              <button
                type="button"
                onClick={() => addBlock('counter')}
                className="py-2 px-2.5 text-xs border vtt-border vtt-surface hover:opacity-80 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> + Contador / Munição
              </button>
              <button
                type="button"
                onClick={() => addBlock('text')}
                className="col-span-2 py-2 px-2.5 text-xs border vtt-border vtt-surface hover:opacity-80 flex items-center justify-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> + Bloco de Texto / Notas
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Sheet selector + Fullscreen A4 + Create button */}
      <div className="p-3 border-b vtt-border flex items-center gap-1.5 vtt-subtle">
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
        {activeSheet && (
          <button
            type="button"
            onClick={() => setShowA4Modal(true)}
            className="px-2.5 py-2 text-xs font-semibold border vtt-border vtt-surface hover:vtt-canvas flex items-center gap-1 whitespace-nowrap shrink-0"
            title="Abrir ficha completa em tamanho folha A4"
          >
            <Maximize2 className="w-3.5 h-3.5 vtt-accent-text" />
            <span>A4</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowNewDrawer((v) => !v)}
          className="px-2.5 py-2 text-xs font-semibold vtt-accent-btn flex items-center gap-1 whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          Nova
        </button>
      </div>

      {/* Universal Custom RPG Sheet Builder & PDF Importer Drawer */}
      {showNewDrawer && (
        <div className="p-4 border-b vtt-border vtt-canvas space-y-4 overflow-y-auto max-h-[80vh]">
          {/* Option 1: Smart Custom RPG System Sheet Builder */}
          <form onSubmit={handleCreateBlank} className="space-y-3 border vtt-border vtt-surface p-3.5">
            <p className="text-xs font-bold font-typewriter">
              Criar Ficha de Sistema Personalizado
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                placeholder="Nome do personagem"
                className="w-full px-3 py-2 text-xs border vtt-border vtt-canvas"
              />
              <input
                type="text"
                value={newSystem}
                onChange={(e) => setNewSystem(e.target.value)}
                maxLength={80}
                placeholder="Nome do sistema (ex: Meu RPG)"
                className="w-full px-3 py-2 text-xs border vtt-border vtt-canvas"
              />
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold block">
                Como funcionam os dados do seu sistema?
              </span>
              <div className="grid grid-cols-2 gap-1.5">
                {SYSTEM_DICE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setNewSystemPreset(preset.id);
                      if (preset.id === '1d100') {
                        setNewAttrsCsv('Força, Destreza, Inteligência, Poder, Investigação');
                      }
                    }}
                    className={`p-2 text-left border transition-colors ${
                      newSystemPreset === preset.id
                        ? 'vtt-accent-btn border-transparent'
                        : 'vtt-canvas vtt-border'
                    }`}
                  >
                    <p className="text-[11px] font-semibold">{preset.label}</p>
                    <p
                      className={`text-[10px] truncate ${
                        newSystemPreset === preset.id ? 'opacity-90' : 'vtt-muted'
                      }`}
                    >
                      {preset.shortDesc}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] font-semibold">
                Atributos iniciais (separados por vírgula)
              </span>
              <input
                type="text"
                value={newAttrsCsv}
                onChange={(e) => setNewAttrsCsv(e.target.value)}
                placeholder="Força, Agilidade, Intelecto, Vigor, Presença"
                className="w-full px-3 py-2 text-xs border vtt-border vtt-canvas"
              />
            </label>

            <div className="flex items-center justify-between gap-2 pt-1">
              {activeSheet ? (
                <button
                  type="button"
                  onClick={() => void handleDuplicateCurrent()}
                  className="px-3 py-1.5 text-xs border vtt-border vtt-canvas flex items-center gap-1.5"
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
                  Criar ficha pronta
                </button>
              </div>
            </div>
          </form>

          {/* Option 2: Smart PDF Import */}
          <div className="border vtt-border vtt-surface p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 vtt-accent-text shrink-0" />
                <span className="text-xs font-semibold">Ou importar PDF (auto-montar)</span>
              </div>
              <label className="py-1.5 px-3 text-xs font-semibold border vtt-border vtt-canvas hover:vtt-subtle cursor-pointer flex items-center gap-1.5 whitespace-nowrap">
                {importingPdf ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{importStatus || 'Lendo...'}</span>
                  </>
                ) : (
                  <>
                    <FileUp className="w-3.5 h-3.5" />
                    <span>Escolher PDF</span>
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
          </div>
        </div>
      )}

      {/* Active Sheet Content */}
      {!activeSheet ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4">
          <FileText className="w-8 h-8 vtt-muted" />
          <div className="space-y-1.5 max-w-xs">
            <p className="text-sm font-bold font-typewriter">Fichas Universais</p>
            <p className="text-xs vtt-muted leading-relaxed">
              Crie fichas para qualquer sistema personalizado com itens que rolam automaticamente com base nos seus atributos, ou importe um PDF.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-2">
            <button
              type="button"
              onClick={() => setShowNewDrawer(true)}
              className="px-4 py-2.5 text-xs font-semibold vtt-accent-btn"
            >
              Criar ficha personalizada
            </button>
            <label className="px-4 py-2.5 text-xs font-semibold border vtt-border vtt-surface cursor-pointer flex items-center gap-1.5">
              {importingPdf ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {importStatus || 'Lendo PDF...'}
                </>
              ) : (
                <>
                  <FileUp className="w-3.5 h-3.5" />
                  Importar PDF
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
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Character Header with Local Portrait Photo Upload + Drag to Tabletop */}
          <div className="space-y-3 border-b vtt-border pb-3.5">
            <div className="flex items-start gap-3">
              <div
                draggable={canDragToCanvas}
                onDragStart={handleDragPortraitToCanvas}
                className={`relative shrink-0 ${
                  canDragToCanvas ? 'cursor-grab active:cursor-grabbing' : ''
                }`}
                title={
                  canDragToCanvas
                    ? 'Clique para trocar foto · Arraste este retrato direto para o mapa!'
                    : 'Enviar foto do personagem'
                }
              >
                <label className="relative w-14 h-14 border vtt-border vtt-subtle overflow-hidden cursor-pointer group flex items-center justify-center">
                  {avatarResolvedUrl ? (
                    <img
                      src={avatarResolvedUrl}
                      alt={activeSheet.name}
                      draggable={false}
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
              </div>

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
                    placeholder="Classe, arquétipo ou origem"
                    className="flex-1 text-xs vtt-muted bg-transparent border-b border-transparent focus:border-current min-w-0"
                  />
                  <input
                    type="text"
                    value={activeSheet.templateId || ''}
                    onChange={(e) => patchSheet({ ...activeSheet, templateId: e.target.value })}
                    placeholder="Sistema"
                    className="w-24 text-[11px] vtt-muted text-right bg-transparent border-b border-transparent focus:border-current shrink-0"
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

            {/* Draggable Token Strip for GM to drag character straight onto the tabletop */}
            {canDragToCanvas && (
              <div
                draggable
                onDragStart={handleDragPortraitToCanvas}
                className="px-2.5 py-1.5 border border-dashed border-amber-500/60 vtt-canvas flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing hover:vtt-subtle transition-colors"
                title="Arraste e solte direto no mapa para colocar o token deste personagem!"
              >
                <span className="text-[11px] font-semibold flex items-center gap-1.5 truncate">
                  <GripVertical className="w-3.5 h-3.5 vtt-accent-text shrink-0" />
                  <span className="truncate">Arrastar token de {activeSheet.name} para o mapa</span>
                </span>
                <span className="text-[10px] vtt-muted whitespace-nowrap shrink-0">Player</span>
              </div>
            )}

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

          {renderActiveSheetBody(false)}
        </div>
      )}

      {/* Fullscreen A4 Paper Character Sheet Modal (Available for GM & Players) */}
      {showA4Modal && activeSheet && (
        <div
          className="fixed inset-0 z-[70] bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6"
          onClick={() => setShowA4Modal(false)}
        >
          <div
            className="w-full max-w-[850px] h-[92vh] vtt-surface border vtt-border shadow-2xl flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* A4 Sheet Paper Header */}
            <div className="px-6 py-4 border-b vtt-border vtt-subtle flex items-center justify-between gap-4 shrink-0">
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-12 h-12 border vtt-border vtt-canvas overflow-hidden shrink-0 flex items-center justify-center">
                  {avatarResolvedUrl ? (
                    <img
                      src={avatarResolvedUrl}
                      alt={activeSheet.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <FileText className="w-5 h-5 vtt-muted" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-widest vtt-muted">
                    Ficha Completa · Modo Folha A4 {activeSheet.templateId ? `· ${activeSheet.templateId}` : ''}
                  </p>
                  <h2 className="text-lg font-bold font-typewriter truncate">
                    {activeSheet.name}
                  </h2>
                  {activeSheet.subtitle && (
                    <p className="text-xs vtt-muted truncate">{activeSheet.subtitle}</p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <div className="flex items-center border vtt-border vtt-canvas p-0.5">
                  <button
                    type="button"
                    onClick={() => patchSheet({ ...activeSheet, mode: 'modular' })}
                    className={`px-2.5 py-1 text-xs font-semibold ${
                      activeSheet.mode === 'modular' ? 'vtt-accent-btn' : 'vtt-muted'
                    }`}
                  >
                    Interativa
                  </button>
                  <button
                    type="button"
                    onClick={() => patchSheet({ ...activeSheet, mode: 'pdf' })}
                    className={`px-2.5 py-1 text-xs font-semibold ${
                      activeSheet.mode === 'pdf' ? 'vtt-accent-btn' : 'vtt-muted'
                    }`}
                  >
                    PDF
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setShowA4Modal(false)}
                  className="p-2 border vtt-border vtt-canvas hover:vtt-subtle"
                  title="Fechar modo A4"
                  aria-label="Fechar"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* A4 Sheet Body */}
            <div className="flex-1 overflow-y-auto p-6 sm:p-8 vtt-canvas">
              {renderActiveSheetBody(true)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
