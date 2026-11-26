import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { CampaignNote } from '../types/vtt';
import { DEFAULT_WIKI_FOLDERS } from '../lib/templates';

interface WikiNotesPanelProps {
  notes: CampaignNote[];
  savedFolders?: string[];
  onSaveFolders: (folders: string[]) => Promise<void>;
  onCreateNote: (data: {
    folder: string;
    title: string;
    content: string;
    visibility: 'public' | 'gm_only';
  }) => Promise<string>;
  onUpdateNote: (
    noteId: string,
    updates: { folder: string; title: string; content: string; visibility: 'public' | 'gm_only' }
  ) => Promise<void>;
  onDeleteNote: (noteId: string) => Promise<void>;
  onNotify?: (msg: string) => void;
}

export function WikiNotesPanel({
  notes,
  savedFolders,
  onSaveFolders,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onNotify,
}: WikiNotesPanelProps) {
  const [view, setView] = useState<'tree' | 'editor'>('tree');
  const [search, setSearch] = useState('');
  const [activeNoteId, setActiveNoteId] = useState<string>('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // Inline create folder UI
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');

  // Local editor draft state for smooth typing without cursor jump
  const activeNote = notes.find((n) => n.id === activeNoteId) || null;
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState('');
  const [draftFolder, setDraftFolder] = useState('');

  const saveTimerRef = useRef<number | null>(null);
  const pendingSaveRef = useRef<{
    noteId: string;
    payload: { folder: string; title: string; content: string; visibility: 'public' | 'gm_only' };
  } | null>(null);

  function flushPendingSave() {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    if (pending) {
      pendingSaveRef.current = null;
      void onUpdateNote(pending.noteId, pending.payload).catch(() => {
        onNotify?.('Erro ao salvar documento na nuvem.');
      });
    }
  }

  useEffect(() => {
    return () => {
      flushPendingSave();
    };
  }, []);

  useEffect(() => {
    if (!activeNote) return;
    setDraftTitle(activeNote.title);
    setDraftContent(activeNote.content);
    setDraftFolder(activeNote.folder);
  }, [activeNote?.id]);

  // Combine saved campaign folders + default folders + any folder referenced by existing notes
  const folders = useMemo(() => {
    const base =
      savedFolders && savedFolders.length > 0 ? savedFolders : [...DEFAULT_WIKI_FOLDERS];
    const set = new Set<string>(base);
    for (const n of notes) {
      if (n.folder?.trim()) set.add(n.folder.trim());
    }
    return Array.from(set);
  }, [savedFolders, notes]);

  // Notes grouped by folder (filtered by search)
  const notesByFolder = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, CampaignNote[]>();
    for (const f of folders) {
      map.set(f, []);
    }
    for (const n of notes) {
      if (
        q &&
        !n.title.toLowerCase().includes(q) &&
        !n.content.toLowerCase().includes(q) &&
        !n.folder.toLowerCase().includes(q)
      ) {
        continue;
      }
      const f = n.folder?.trim() || 'Notas';
      const arr = map.get(f) || [];
      arr.push(n);
      map.set(f, arr);
    }
    return map;
  }, [folders, notes, search]);

  function isFolderOpen(folder: string): boolean {
    if (search.trim()) return true;
    return expandedFolders[folder] ?? true;
  }

  function toggleFolder(folder: string) {
    setExpandedFolders((prev) => ({
      ...prev,
      [folder]: !(prev[folder] ?? true),
    }));
  }

  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    const clean = newFolderName.trim().slice(0, 50);
    if (!clean) return;
    if (!folders.includes(clean)) {
      await onSaveFolders([...folders, clean]);
      onNotify?.(`Pasta "${clean}" criada.`);
    }
    setExpandedFolders((prev) => ({ ...prev, [clean]: true }));
    setNewFolderName('');
    setCreatingFolder(false);
  }

  async function handleRemoveEmptyFolder(folder: string) {
    const inside = notes.filter((n) => n.folder === folder);
    if (inside.length > 0) {
      onNotify?.('Mova ou exclua os documentos desta pasta antes de removê-la.');
      return;
    }
    const next = folders.filter((f) => f !== folder);
    await onSaveFolders(next.length > 0 ? next : ['Notas']);
    onNotify?.(`Pasta "${folder}" removida.`);
  }

  async function handleCreateNoteInFolder(folder: string) {
    const id = await onCreateNote({
      folder,
      title: 'Novo documento',
      content: '',
      visibility: 'gm_only',
    });
    setExpandedFolders((prev) => ({ ...prev, [folder]: true }));
    setActiveNoteId(id);
    setDraftTitle('Novo documento');
    setDraftContent('');
    setDraftFolder(folder);
    setView('editor');
  }

  function openNote(note: CampaignNote) {
    setActiveNoteId(note.id);
    setDraftTitle(note.title);
    setDraftContent(note.content);
    setDraftFolder(note.folder);
    setView('editor');
  }

  function saveEditorPatch(
    patch: Partial<{ folder: string; title: string; content: string; visibility: 'public' | 'gm_only' }>,
    immediate = false
  ) {
    if (!activeNote) return;
    const nextFolder = patch.folder ?? draftFolder ?? activeNote.folder;
    const nextTitle = patch.title ?? draftTitle;
    const nextContent = patch.content ?? draftContent;
    const nextVis = patch.visibility ?? activeNote.visibility;

    const payload = {
      folder: nextFolder,
      title: nextTitle || 'Sem título',
      content: nextContent,
      visibility: nextVis,
    };

    if (immediate) {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pendingSaveRef.current = null;
      void onUpdateNote(activeNote.id, payload).catch(() => {
        onNotify?.('Erro ao salvar documento na nuvem.');
      });
      return;
    }

    pendingSaveRef.current = { noteId: activeNote.id, payload };
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      flushPendingSave();
    }, 350);
  }

  // ---------------------------------------------------------------------------
  // Focused Document Editor Mode (Full panel space, zero cramped split)
  // ---------------------------------------------------------------------------
  if (view === 'editor' && activeNote) {
    return (
      <div className="h-full flex flex-col">
        {/* Top Breadcrumb Bar */}
        <div className="p-3 border-b vtt-border vtt-subtle flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              flushPendingSave();
              setView('tree');
            }}
            className="px-2.5 py-1.5 text-xs font-semibold border vtt-border vtt-surface flex items-center gap-1.5 whitespace-nowrap"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Pastas
          </button>

          <select
            value={draftFolder}
            onChange={(e) => {
              const f = e.target.value;
              setDraftFolder(f);
              saveEditorPatch({ folder: f }, true);
            }}
            className="flex-1 px-2.5 py-1.5 text-xs border vtt-border vtt-surface min-w-0"
            aria-label="Pasta do documento"
          >
            {folders.map((f) => (
              <option key={f} value={f}>
                📁 {f}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => {
              if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
              }
              pendingSaveRef.current = null;
              void onDeleteNote(activeNote.id);
              setView('tree');
            }}
            className="p-1.5 vtt-muted hover:text-red-700 shrink-0"
            title="Excluir documento"
            aria-label="Excluir documento"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>

        {/* Clean Editor Canvas */}
        <div className="flex-1 flex flex-col p-4 space-y-3 overflow-y-auto">
          {/* Visibility Toggle */}
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => saveEditorPatch({ visibility: 'public' }, true)}
              className={`py-2 px-2 text-xs border flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeNote.visibility === 'public'
                  ? 'vtt-accent-btn border-transparent font-semibold'
                  : 'vtt-canvas vtt-border vtt-muted'
              }`}
            >
              <Eye className="w-3.5 h-3.5" />
              Visível p/ jogadores
            </button>
            <button
              type="button"
              onClick={() => saveEditorPatch({ visibility: 'gm_only' }, true)}
              className={`py-2 px-2 text-xs border flex items-center justify-center gap-1.5 whitespace-nowrap ${
                activeNote.visibility === 'gm_only'
                  ? 'vtt-accent-btn border-transparent font-semibold'
                  : 'vtt-canvas vtt-border vtt-muted'
              }`}
            >
              <EyeOff className="w-3.5 h-3.5" />
              Segredo do Mestre
            </button>
          </div>

          <input
            type="text"
            value={draftTitle}
            onChange={(e) => {
              setDraftTitle(e.target.value);
              saveEditorPatch({ title: e.target.value });
            }}
            maxLength={140}
            placeholder="Título do documento..."
            className="w-full px-3 py-2.5 text-sm font-bold font-typewriter border vtt-border vtt-canvas"
          />

          <textarea
            value={draftContent}
            onChange={(e) => {
              setDraftContent(e.target.value);
              saveEditorPatch({ content: e.target.value });
            }}
            placeholder="Escreva pistas, fichas de NPCs, descrições de lugares, ganchos ou segredos da sessão..."
            className="flex-1 min-h-[260px] w-full p-3.5 text-xs leading-relaxed border vtt-border vtt-canvas resize-none"
          />
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Dynamic Folder Explorer Mode (Obsidian / Notion Tree)
  // ---------------------------------------------------------------------------
  return (
    <div className="h-full flex flex-col">
      {/* Top Action Bar: Search + New Folder */}
      <div className="p-3 border-b vtt-border space-y-2.5 vtt-subtle">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 vtt-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar documentos..."
              className="w-full pl-8 pr-2.5 py-2 text-xs border vtt-border vtt-surface"
            />
          </div>
          <button
            type="button"
            onClick={() => setCreatingFolder((v) => !v)}
            className="px-3 py-2 text-xs font-semibold vtt-accent-btn flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            Nova pasta
          </button>
        </div>

        {/* Inline New Folder Input */}
        {creatingFolder && (
          <form onSubmit={handleCreateFolder} className="flex items-center gap-2">
            <input
              type="text"
              autoFocus
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              maxLength={50}
              placeholder="Nome da pasta (ex: Facções, Vilões, Itens)"
              className="flex-1 px-2.5 py-1.5 text-xs border vtt-border vtt-surface min-w-0"
            />
            <button
              type="submit"
              disabled={!newFolderName.trim()}
              className="px-3 py-1.5 text-xs font-semibold vtt-accent-btn disabled:opacity-50 whitespace-nowrap"
            >
              Criar
            </button>
          </form>
        )}
      </div>

      {/* Expandable Folder Tree */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {folders.map((folder) => {
          const items = notesByFolder.get(folder) || [];
          const open = isFolderOpen(folder);

          return (
            <div key={folder} className="border vtt-border vtt-canvas">
              {/* Folder Row Header */}
              <div className="flex items-center justify-between gap-1 px-2.5 py-2 vtt-subtle">
                <button
                  type="button"
                  onClick={() => toggleFolder(folder)}
                  className="flex-1 flex items-center gap-2 text-left min-w-0"
                >
                  {open ? (
                    <ChevronDown className="w-3.5 h-3.5 vtt-muted shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 vtt-muted shrink-0" />
                  )}
                  {open ? (
                    <FolderOpen className="w-4 h-4 vtt-accent-text shrink-0" />
                  ) : (
                    <Folder className="w-4 h-4 vtt-muted shrink-0" />
                  )}
                  <span className="text-xs font-bold font-typewriter truncate">{folder}</span>
                  <span className="text-[11px] vtt-muted tabular-nums shrink-0">
                    ({items.length})
                  </span>
                </button>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => void handleCreateNoteInFolder(folder)}
                    className="px-2 py-1 text-[11px] font-semibold vtt-accent-btn flex items-center gap-1 whitespace-nowrap"
                    title={`Novo documento em ${folder}`}
                  >
                    <Plus className="w-3 h-3" />
                    Nota
                  </button>
                  {items.length === 0 && folders.length > 1 && (
                    <button
                      type="button"
                      onClick={() => void handleRemoveEmptyFolder(folder)}
                      className="p-1 vtt-muted hover:text-red-700"
                      title="Remover pasta vazia"
                      aria-label={`Remover pasta ${folder}`}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Documents Inside Folder */}
              {open && (
                <div className="divide-y vtt-border">
                  {items.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => void handleCreateNoteInFolder(folder)}
                      className="w-full px-3.5 py-2.5 text-left text-[11px] vtt-muted hover:opacity-100 flex items-center gap-1.5"
                    >
                      <Plus className="w-3 h-3" />
                      Pasta vazia — clique para adicionar documento em {folder}
                    </button>
                  ) : (
                    items.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => openNote(n)}
                        className="w-full px-3.5 py-2.5 text-left flex items-center justify-between gap-2 hover:vtt-subtle transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3.5 h-3.5 vtt-muted shrink-0" />
                          <span className="text-xs font-semibold truncate">{n.title}</span>
                        </div>
                        <span
                          className="text-[11px] vtt-muted flex items-center gap-1 whitespace-nowrap shrink-0"
                          title={
                            n.visibility === 'public'
                              ? 'Visível para os jogadores'
                              : 'Segredo do Mestre'
                          }
                        >
                          {n.visibility === 'public' ? (
                            <>
                              <Eye className="w-3 h-3 text-emerald-700 dark:text-emerald-400" />
                              <span>Pública</span>
                            </>
                          ) : (
                            <>
                              <EyeOff className="w-3 h-3" />
                              <span>Segredo</span>
                            </>
                          )}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
