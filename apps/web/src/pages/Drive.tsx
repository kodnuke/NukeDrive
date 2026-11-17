import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth, IS_NATIVE } from '../lib/auth';
import type { DriveFile, DriveRules, PublishStatus, ShareLink, User } from '@nukedrive/shared';
import {
  Folder, File as FileIcon, Upload, FolderPlus, Trash2, Download, Share2,
  Search, ChevronRight, Home, RefreshCw, RotateCcw, Star, Clock, Link2,
  LayoutGrid, List as ListIcon, Edit3, FolderInput, Copy, Eye, X, Check,
  Menu, Settings, Globe, Shield, Users, HardDrive, Image as ImageIcon,
  Film, Music, FileText, Lock, ArrowUpDown, CheckSquare, Square, LogOut, Smartphone
} from 'lucide-react';

type NavTab = 'files' | 'starred' | 'recent' | 'shares' | 'trash';
type SortField = 'name' | 'size' | 'updatedAt';

interface UploadItem {
  id: string;
  name: string;
  progress: number;
  loadedBytes: number;
  totalBytes: number;
  chunkIndex: number;
  totalChunks: number;
  speedBps: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
  abort?: () => void;
}

export default function Drive() {
  const { api, user, refreshUser, logout } = useAuth();
  const qc = useQueryClient();

  const [navTab, setNavTab] = useState<NavTab>('files');
  const [parentId, setParentId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<DriveFile[] | null>(null);
  const [sort, setSort] = useState<SortField>('name');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('nd_view') as 'grid' | 'list') || 'grid'
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [toast, setToast] = useState<{ text: string; type?: 'ok' | 'err' } | null>(null);

  // Modals
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renameTarget, setRenameTarget] = useState<DriveFile | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [moveTargetIds, setMoveTargetIds] = useState<string[] | null>(null);
  const [moveDestId, setMoveDestId] = useState<string | null>(null);
  const [shareTarget, setShareTarget] = useState<DriveFile | null>(null);
  const [sharePassword, setSharePassword] = useState('');
  const [shareExpireDays, setShareExpireDays] = useState<string>('0');
  const [createdShare, setCreatedShare] = useState<ShareLink | null>(null);
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [conflictPrompt, setConflictPrompt] = useState<{
    targetParent: string | null;
    entries: { file: File; relativePath: string }[];
    emptyFolders: string[];
    fileConflicts: string[];
    folderConflicts: string[];
  } | null>(null);

  // Settings / Admin / Publish Modals
  const [activeSettingsModal, setActiveSettingsModal] = useState<'profile' | 'rules' | 'users' | 'publish' | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const notify = useCallback((text: string, type: 'ok' | 'err' = 'ok') => {
    setToast({ text, type });
    setTimeout(() => setToast(prev => (prev?.text === text ? null : prev)), 3500);
  }, []);

  const toggleViewMode = (m: 'grid' | 'list') => {
    setViewMode(m);
    try { localStorage.setItem('nd_view', m); } catch {}
  };

  const isTrashed = navTab === 'trash';
  const isStarred = navTab === 'starred';
  const isRecent = navTab === 'recent';

  const listKey = ['files', navTab, parentId, sort, order];
  const { data, isLoading, refetch } = useQuery({
    queryKey: listKey,
    queryFn: () => api.list(
      navTab === 'files' ? parentId : null,
      isTrashed,
      { starred: isStarred, recent: isRecent, sort, order }
    ),
    enabled: navTab !== 'shares'
  });

  const sharesQuery = useQuery({
    queryKey: ['shares'],
    queryFn: () => api.listShares(),
    enabled: navTab === 'shares'
  });

  const foldersQuery = useQuery({
    queryKey: ['all-folders'],
    queryFn: () => api.listFolders(),
    enabled: !!moveTargetIds
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['files'] });
    qc.invalidateQueries({ queryKey: ['shares'] });
    qc.invalidateQueries({ queryKey: ['all-folders'] });
  };

  useEffect(() => {
    setSelectedIds(new Set());
  }, [navTab, parentId, searchResults]);

  const createFolderMut = useMutation({
    mutationFn: (name: string) => api.createFolder(name, navTab === 'files' ? parentId : null),
    onSuccess: () => {
      invalidate();
      setFolderModalOpen(false);
      setNewFolderName('');
      notify('Klasör oluşturuldu');
    },
    onError: (e: any) => notify(e.message, 'err')
  });

  const renameMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => api.rename(id, name),
    onSuccess: () => {
      invalidate();
      setRenameTarget(null);
      notify('Yeniden adlandırıldı');
    },
    onError: (e: any) => notify(e.message, 'err')
  });

  const starMut = useMutation({
    mutationFn: ({ id, starred }: { id: string; starred: boolean }) => api.toggleStar(id, starred),
    onSuccess: invalidate
  });

  const copyMut = useMutation({
    mutationFn: (id: string) => api.copy(id, navTab === 'files' ? parentId : null),
    onSuccess: () => {
      invalidate();
      notify('Dosya kopyalandı');
    },
    onError: (e: any) => notify(e.message, 'err')
  });

  const trashMut = useMutation({
    mutationFn: (id: string) => api.trash(id),
    onSuccess: () => {
      invalidate();
      notify('Çöp kutusuna taşındı');
    }
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => api.restore(id),
    onSuccess: () => {
      invalidate();
      notify('Geri yüklendi');
    }
  });

  const permMut = useMutation({
    mutationFn: (id: string) => api.deletePermanent(id),
    onSuccess: () => {
      invalidate();
      notify('Kalıcı olarak silindi');
    }
  });

  const emptyTrashMut = useMutation({
    mutationFn: () => api.emptyTrash(),
    onSuccess: () => {
      invalidate();
      notify('Çöp kutusu boşaltıldı');
    }
  });

  const bulkMut = useMutation({
    mutationFn: ({ ids, action, dest }: { ids: string[]; action: 'trash' | 'restore' | 'deletePermanent' | 'move' | 'star' | 'unstar'; dest?: string | null }) =>
      api.bulkAction(ids, action, dest),
    onSuccess: () => {
      invalidate();
      setSelectedIds(new Set());
      setMoveTargetIds(null);
      notify('İşlem tamamlandı');
    },
    onError: (e: any) => notify(e.message, 'err')
  });

  const deleteShareMut = useMutation({
    mutationFn: (id: string) => api.deleteShare(id),
    onSuccess: () => {
      invalidate();
      notify('Paylaşım linki iptal edildi');
    }
  });

  const executeBatchUpload = useCallback(async (
    targetParent: string | null,
    entries: { file: File; relativePath: string }[],
    emptyFolders: string[],
    resolution: 'overwrite' | 'rename' | 'skip' | 'rename-folder',
    conflictSet: Set<string>
  ) => {
    const folderCache = new Map<string, string>();

    const ensureFolderPath = async (folderParts: string[]): Promise<string | null> => {
      let curParent: string | null = targetParent;
      let pathSoFar = '';
      for (let i = 0; i < folderParts.length; i++) {
        const part = folderParts[i];
        pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
        const cached = folderCache.get(pathSoFar);
        if (cached) {
          curParent = cached;
          continue;
        }
        // Eğer kullanıcı kök klasörü ayrı (numaralandırılmış) klasör olarak açmak istediyse
        const shouldRenameRoot = i === 0 && resolution === 'rename-folder';
        const created = await api.createFolder(part, curParent, {
          reuseExisting: !shouldRenameRoot,
          onConflict: shouldRenameRoot ? 'rename' : 'reuse'
        });
        folderCache.set(pathSoFar, created.id);
        curParent = created.id;
      }
      return curParent;
    };

    // Boş klasörleri de oluştur
    for (const emptyPath of emptyFolders) {
      const parts = emptyPath.replace(/\\/g, '/').split('/').filter(Boolean);
      if (parts.length) {
        try { await ensureFolderPath(parts); } catch {}
      }
    }

    for (const item of entries) {
      const normPath = item.relativePath.replace(/\\/g, '/');
      if (resolution === 'skip' && conflictSet.has(normPath.toLowerCase())) {
        continue;
      }

      const parts = normPath.split('/').filter(Boolean);
      const fileName = parts[parts.length - 1] || item.file.name;
      const folderParts = parts.slice(0, -1);

      let fileParentId = targetParent;
      if (folderParts.length > 0) {
        try {
          fileParentId = await ensureFolderPath(folderParts);
        } catch (e: any) {
          notify(`Klasör oluşturulamadı (${folderParts.join('/')}): ${e.message}`, 'err');
          continue;
        }
      }

      const f = item.file;
      const displayLabel = folderParts.length > 0 ? `${folderParts.join('/')}/${fileName}` : fileName;
      const uid = `${Date.now()}-${Math.random()}`;
      const controller = new AbortController();
      setUploads(prev => [...prev, {
        id: uid,
        name: displayLabel,
        progress: 0,
        loadedBytes: 0,
        totalBytes: f.size,
        chunkIndex: 1,
        totalChunks: Math.max(1, Math.ceil(f.size / (4 * 1024 * 1024))),
        speedBps: 0,
        status: 'uploading',
        abort: () => controller.abort()
      }]);
      try {
        const conflictMode = resolution === 'overwrite' ? 'overwrite' : 'rename';
        await api.upload(f, fileName, fileParentId, (p, details) => {
          setUploads(prev => prev.map(u => u.id === uid ? {
            ...u,
            progress: Math.min(100, Math.round(p * 1000) / 10),
            loadedBytes: details?.loadedBytes ?? Math.round(p * f.size),
            totalBytes: details?.totalBytes ?? f.size,
            chunkIndex: details?.chunkIndex ?? u.chunkIndex,
            totalChunks: details?.totalChunks ?? u.totalChunks,
            speedBps: details?.speedBps ?? u.speedBps
          } : u));
        }, controller.signal, conflictMode);
        setUploads(prev => prev.map(u => u.id === uid ? {
          ...u,
          progress: 100,
          loadedBytes: f.size,
          status: 'done'
        } : u));
        invalidate();
      } catch (e: any) {
        setUploads(prev => prev.map(u => u.id === uid ? { ...u, status: 'error', error: e.message } : u));
        notify(`${displayLabel}: ${e.message}`, 'err');
      }
    }
    invalidate();
  }, [api, notify]);

  const queueEntriesWithConflictCheck = useCallback(async (
    entries: { file: File; relativePath: string }[],
    emptyFolders: string[] = []
  ) => {
    if (!entries.length && !emptyFolders.length) return;
    const targetParent = navTab === 'files' ? parentId : null;
    try {
      const checkPaths = [
        ...entries.map(e => e.relativePath),
        ...emptyFolders.map(f => `${f}/__empty__`)
      ];
      const { fileConflicts, folderConflicts } = await api.checkConflicts(targetParent, checkPaths);
      // Boş klasör kontrolü için eklenen __empty__ sonekini filtrele
      const realFileConflicts = fileConflicts.filter(c => !c.endsWith('/__empty__'));
      if (realFileConflicts.length > 0 || folderConflicts.length > 0) {
        setConflictPrompt({
          targetParent,
          entries,
          emptyFolders,
          fileConflicts: realFileConflicts,
          folderConflicts
        });
        return;
      }
    } catch {}
    await executeBatchUpload(targetParent, entries, emptyFolders, 'rename', new Set());
  }, [api, navTab, parentId, executeBatchUpload]);

  const handleUploadFiles = useCallback(async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    if (!arr.length) return;
    const entries = arr.map(f => ({
      file: f,
      relativePath: ((f as any).webkitRelativePath && String((f as any).webkitRelativePath).trim()) || f.name
    }));
    await queueEntriesWithConflictCheck(entries, []);
  }, [queueEntriesWithConflictCheck]);

  const doSearch = async (qStr?: string) => {
    const q = (qStr ?? search).trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    const r = await api.search(q);
    setSearchResults(r);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);

    // Sürüklenen klasörleri ve içindeki alt klasör/dosyaları webkitGetAsEntry ile递归 (recursive) oku
    const items = e.dataTransfer.items;
    if (items && items.length > 0 && typeof items[0].webkitGetAsEntry === 'function') {
      const rootEntries: any[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) rootEntries.push(entry);
      }

      const collectedFiles: { file: File; relativePath: string }[] = [];
      const emptyFolders: string[] = [];

      const readAllDirEntries = async (dirReader: any): Promise<any[]> => {
        const all: any[] = [];
        while (true) {
          const batch: any[] = await new Promise((resolve, reject) => {
            dirReader.readEntries(resolve, reject);
          });
          if (!batch || batch.length === 0) break;
          all.push(...batch);
        }
        return all;
      };

      const traverse = async (entry: any, parentPath: string) => {
        const currentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
        if (entry.isFile) {
          const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
          collectedFiles.push({ file, relativePath: currentPath });
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const children = await readAllDirEntries(reader);
          if (children.length === 0) {
            emptyFolders.push(currentPath);
          } else {
            for (const child of children) {
              await traverse(child, currentPath);
            }
          }
        }
      };

      for (const rootEntry of rootEntries) {
        await traverse(rootEntry, '');
      }

      if (collectedFiles.length > 0 || emptyFolders.length > 0) {
        await queueEntriesWithConflictCheck(collectedFiles, emptyFolders);
        return;
      }
    }

    if (e.dataTransfer.files?.length) {
      await handleUploadFiles(e.dataTransfer.files);
    }
  };

  const openItem = async (f: DriveFile) => {
    if (isTrashed) return;
    if (f.kind === 'folder') {
      setNavTab('files');
      setSearchResults(null);
      setSearch('');
      setParentId(f.id);
      return;
    }
    setPreviewFile(f);
    setPreviewText(null);
    if (isTextFile(f)) {
      try {
        const txt = await api.fetchTextPreview(f.id);
        setPreviewText(txt);
      } catch {
        setPreviewText('Dosya içeriği okunamadı.');
      }
    }
  };

  const downloadFile = (f: DriveFile) => {
    const a = document.createElement('a');
    a.href = api.downloadUrl(f.id, false);
    a.download = f.name;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const openShareModal = (f: DriveFile) => {
    setShareTarget(f);
    setSharePassword('');
    setShareExpireDays('0');
    setCreatedShare(null);
  };

  const handleCreateShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareTarget) return;
    try {
      const days = Number(shareExpireDays);
      const expiresAt = days > 0 ? new Date(Date.now() + days * 86400 * 1000).toISOString() : null;
      const s = await api.createShare(shareTarget.id, {
        expiresAt,
        password: sharePassword.trim() || undefined
      });
      setCreatedShare(s);
      await navigator.clipboard.writeText(s.url).catch(() => {});
      invalidate();
      notify('Paylaşım linki oluşturuldu ve panoya kopyalandı');
    } catch (err: any) {
      notify(err.message, 'err');
    }
  };

  const toggleSelect = (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const items = searchResults ?? data?.items ?? [];
  const crumbs = data?.breadcrumbs ?? [{ id: null, name: 'Ana Dizin' }];
  const stats = data?.stats;
  const isAdmin = user?.role === 'admin';

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800">
      {/* Toast Bildirimi */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 transition ${
          toast.type === 'err' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
        }`}>
          <span>{toast.text}</span>
        </div>
      )}

      {/* Üst Bar */}
      <header className="bg-white border-b border-slate-200 px-3 sm:px-5 py-2.5 flex items-center gap-2 sm:gap-4 sticky top-0 z-30">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="lg:hidden p-2 rounded-lg hover:bg-slate-100 text-slate-600"
          aria-label="Menü"
        >
          <Menu size={20} />
        </button>

        <div
          onClick={() => { setNavTab('files'); setParentId(null); setSearchResults(null); setSearch(''); }}
          className="flex items-center gap-2 cursor-pointer shrink-0"
        >
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white">
            <HardDrive size={18} />
          </div>
          <span className="text-lg font-bold text-slate-900 hidden sm:inline">NukeDrive</span>
        </div>

        {/* Arama Çubuğu */}
        <div className="flex-1 max-w-xl mx-auto">
          <div className="flex items-center bg-slate-100 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500 border border-transparent focus-within:border-blue-500 rounded-xl px-3 py-1.5 transition">
            <Search size={16} className="text-slate-400 shrink-0" />
            <input
              className="flex-1 bg-transparent px-2 text-sm outline-none"
              placeholder="Dosya veya klasör ara..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                if (!e.target.value.trim()) setSearchResults(null);
              }}
              onKeyDown={e => { if (e.key === 'Enter') doSearch(); }}
            />
            {search && (
              <button
                className="text-slate-400 hover:text-slate-600 px-1"
                onClick={() => { setSearch(''); setSearchResults(null); }}
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>

        {/* Sağ Kullanıcı ve Hızlı Eylemler */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {!isTrashed && (
            <button
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-xl text-xs sm:text-sm font-semibold shadow-sm transition"
            >
              <Upload size={15} />
              <span className="hidden sm:inline">Yükle</span>
            </button>
          )}

          {isAdmin && (
            <button
              onClick={() => setActiveSettingsModal('publish')}
              title="Dış Erişim & Yayın Ayarları"
              className="p-2 rounded-xl border border-slate-200 hover:bg-slate-100 text-blue-600 flex items-center gap-1 text-xs font-medium"
            >
              <Globe size={16} />
              <span className="hidden md:inline">Yayın & Android</span>
            </button>
          )}

          <button
            onClick={() => setActiveSettingsModal('profile')}
            title="Hesap ve Ayarlar"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl hover:bg-slate-100 text-xs sm:text-sm font-medium text-slate-700"
          >
            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs uppercase">
              {(user?.name || user?.username || 'U')[0]}
            </div>
            <span className="hidden md:inline max-w-[110px] truncate">{user?.username || user?.name}</span>
          </button>

          <button
            onClick={logout}
            title="Çıkış Yap"
            className="p-2 rounded-xl hover:bg-red-50 text-slate-500 hover:text-red-600 transition"
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobil Arka Plan Karartma */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sol Menü (Sidebar) */}
        <aside className={`
          fixed lg:static inset-y-0 left-0 z-30 w-64 bg-white border-r border-slate-200 flex flex-col justify-between p-3 transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}>
          <div className="space-y-1">
            <button
              onClick={() => { setNavTab('files'); setParentId(null); setSearchResults(null); setSidebarOpen(false); }}
              className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 text-sm font-medium transition ${
                navTab === 'files' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Home size={18} /> Dosyalarım
            </button>

            <button
              onClick={() => { setNavTab('starred'); setSearchResults(null); setSidebarOpen(false); }}
              className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 text-sm font-medium transition ${
                navTab === 'starred' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Star size={18} /> Yıldızlılar
            </button>

            <button
              onClick={() => { setNavTab('recent'); setSearchResults(null); setSidebarOpen(false); }}
              className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 text-sm font-medium transition ${
                navTab === 'recent' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Clock size={18} /> Son Yüklenenler
            </button>

            <button
              onClick={() => { setNavTab('shares'); setSearchResults(null); setSidebarOpen(false); }}
              className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 text-sm font-medium transition ${
                navTab === 'shares' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Link2 size={18} /> Paylaşılan Linkler
            </button>

            <button
              onClick={() => { setNavTab('trash'); setSearchResults(null); setSidebarOpen(false); }}
              className={`w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-3 text-sm font-medium transition ${
                navTab === 'trash' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              <Trash2 size={18} /> Çöp Kutusu
            </button>

            <div className="pt-3 mt-3 border-t border-slate-100 space-y-1">
              <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Yönetim ve Kurallar
              </div>

              <button
                onClick={() => { setActiveSettingsModal('profile'); setSidebarOpen(false); }}
                className="w-full text-left px-3 py-2 rounded-xl flex items-center gap-3 text-sm text-slate-700 hover:bg-slate-100"
              >
                <Settings size={17} /> Hesap & Şifre Ayarları
              </button>

              {isAdmin && (
                <>
                  <button
                    onClick={() => { setActiveSettingsModal('publish'); setSidebarOpen(false); }}
                    className="w-full text-left px-3 py-2 rounded-xl flex items-center gap-3 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    <Globe size={17} className="text-blue-600" /> Dış Yayın & Android
                  </button>
                  <button
                    onClick={() => { setActiveSettingsModal('rules'); setSidebarOpen(false); }}
                    className="w-full text-left px-3 py-2 rounded-xl flex items-center gap-3 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    <Shield size={17} className="text-emerald-600" /> Drive Kuralları
                  </button>
                  <button
                    onClick={() => { setActiveSettingsModal('users'); setSidebarOpen(false); }}
                    className="w-full text-left px-3 py-2 rounded-xl flex items-center gap-3 text-sm text-slate-700 hover:bg-slate-100"
                  >
                    <Users size={17} className="text-purple-600" /> Kullanıcı Yönetimi
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Depolama Alanı Özeti */}
          {stats && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 text-xs">
              <div className="flex items-center justify-between font-semibold text-slate-700">
                <span>Depolama Alanı</span>
                <span>{formatSize(stats.usedBytes)}</span>
              </div>
              {stats.quotaBytes > 0 ? (
                <>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full"
                      style={{ width: `${Math.min(100, Math.round((stats.usedBytes / stats.quotaBytes) * 100))}%` }}
                    />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Kota: {formatSize(stats.quotaBytes)} ({Math.round((stats.usedBytes / stats.quotaBytes) * 100)}% dolu)
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-slate-500">Limitsiz (PC Disk Alanı)</div>
              )}
              <div className="text-[11px] text-slate-400 flex justify-between pt-1 border-t border-slate-200/70">
                <span>{stats.folderCount} klasör • {stats.fileCount} dosya</span>
                {stats.trashedBytes > 0 && <span>Çöp: {formatSize(stats.trashedBytes)}</span>}
              </div>
            </div>
          )}
        </aside>

        {/* Ana İçerik */}
        <main className="flex-1 p-3 sm:p-5 overflow-auto flex flex-col">
          {navTab === 'shares' ? (
            <SharesView
              shares={sharesQuery.data || []}
              isLoading={sharesQuery.isLoading}
              onDelete={(id) => deleteShareMut.mutate(id)}
              onCopy={(url) => {
                navigator.clipboard.writeText(url).catch(() => {});
                notify('Paylaşım linki kopyalandı');
              }}
            />
          ) : (
            <>
              {/* Üst Gezinti (Breadcrumbs) & Araç Çubuğu */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                <div className="flex items-center gap-1 text-sm font-medium text-slate-600 overflow-x-auto py-1">
                  {searchResults ? (
                    <div className="flex items-center gap-2">
                      <span>Arama sonuçları: <b>"{search}"</b> ({searchResults.length})</span>
                      <button
                        onClick={() => { setSearch(''); setSearchResults(null); }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Temizle
                      </button>
                    </div>
                  ) : navTab === 'files' ? (
                    crumbs.map((c, i) => (
                      <React.Fragment key={i}>
                        {i > 0 && <ChevronRight size={15} className="text-slate-400 shrink-0" />}
                        <button
                          className={`hover:text-blue-600 px-1.5 py-0.5 rounded-lg hover:bg-blue-50 transition whitespace-nowrap ${
                            i === crumbs.length - 1 ? 'font-bold text-slate-900' : ''
                          }`}
                          onClick={() => setParentId(c.id)}
                        >
                          {c.name}
                        </button>
                      </React.Fragment>
                    ))
                  ) : (
                    <span className="font-bold text-slate-900 text-base">
                      {navTab === 'starred' && 'Yıldızlı Dosyalar'}
                      {navTab === 'recent' && 'Son Yüklenenler'}
                      {navTab === 'trash' && 'Çöp Kutusu'}
                    </span>
                  )}
                </div>

                {/* Sağ Araçlar */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {navTab === 'files' && !searchResults && (
                    <>
                      <button
                        onClick={() => fileInput.current?.click()}
                        className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-xl hover:bg-blue-700 text-xs sm:text-sm font-medium"
                      >
                        <Upload size={15} /> Dosya Yükle
                      </button>
                      <button
                        onClick={() => folderInput.current?.click()}
                        className="hidden sm:flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-1.5 rounded-xl hover:bg-slate-50 text-xs sm:text-sm font-medium"
                      >
                        <Upload size={15} /> Klasör Yükle
                      </button>
                      <button
                        onClick={() => { setNewFolderName(''); setFolderModalOpen(true); }}
                        className="flex items-center gap-1.5 border border-slate-300 bg-white px-3 py-1.5 rounded-xl hover:bg-slate-50 text-xs sm:text-sm font-medium"
                      >
                        <FolderPlus size={15} /> Yeni Klasör
                      </button>
                    </>
                  )}

                  {isTrashed && items.length > 0 && (
                    <button
                      onClick={() => emptyTrashMut.mutate()}
                      className="flex items-center gap-1.5 bg-red-600 text-white px-3 py-1.5 rounded-xl hover:bg-red-700 text-xs sm:text-sm font-medium"
                    >
                      <Trash2 size={15} /> Çöpü Boşalt
                    </button>
                  )}

                  {/* Sıralama */}
                  <div className="flex items-center border border-slate-200 bg-white rounded-xl px-2 py-1 text-xs">
                    <ArrowUpDown size={14} className="text-slate-400 mr-1" />
                    <select
                      value={sort}
                      onChange={e => setSort(e.target.value as SortField)}
                      className="bg-transparent outline-none text-slate-700 font-medium"
                    >
                      <option value="name">Ad</option>
                      <option value="updatedAt">Tarih</option>
                      <option value="size">Boyut</option>
                    </select>
                    <button
                      onClick={() => setOrder(order === 'asc' ? 'desc' : 'asc')}
                      className="ml-1 px-1 text-slate-500 hover:text-slate-800 font-bold"
                      title="Sıralama Yönü"
                    >
                      {order === 'asc' ? '↑' : '↓'}
                    </button>
                  </div>

                  {/* Görünüm Modu */}
                  <div className="flex items-center border border-slate-200 bg-white rounded-xl p-0.5">
                    <button
                      onClick={() => toggleViewMode('grid')}
                      className={`p-1.5 rounded-lg ${viewMode === 'grid' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-700'}`}
                      title="Izgara Görünümü"
                    >
                      <LayoutGrid size={15} />
                    </button>
                    <button
                      onClick={() => toggleViewMode('list')}
                      className={`p-1.5 rounded-lg ${viewMode === 'list' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:text-slate-700'}`}
                      title="Liste Görünümü"
                    >
                      <ListIcon size={15} />
                    </button>
                  </div>

                  <button
                    onClick={() => refetch()}
                    className="p-2 border border-slate-200 bg-white rounded-xl hover:bg-slate-50 text-slate-600"
                    title="Yenile"
                  >
                    <RefreshCw size={15} />
                  </button>

                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={e => { if (e.target.files) handleUploadFiles(e.target.files); e.target.value = ''; }}
                  />
                  <input
                    ref={folderInput}
                    type="file"
                    multiple
                    {...({ webkitdirectory: '', directory: '' } as any)}
                    className="hidden"
                    onChange={e => { if (e.target.files) handleUploadFiles(e.target.files); e.target.value = ''; }}
                  />
                </div>
              </div>

              {/* Çoklu Seçim (Bulk Action) Çubuğu */}
              {selectedIds.size > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 mb-3 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm">
                  <div className="flex items-center gap-3 font-medium text-blue-900">
                    <span>{selectedIds.size} öğe seçildi</span>
                    <button
                      onClick={() => {
                        if (selectedIds.size === items.length) setSelectedIds(new Set());
                        else setSelectedIds(new Set(items.map(i => i.id)));
                      }}
                      className="text-blue-600 hover:underline text-xs"
                    >
                      {selectedIds.size === items.length ? 'Seçimi Kaldır' : 'Tümünü Seç'}
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    {isTrashed ? (
                      <>
                        <button
                          onClick={() => bulkMut.mutate({ ids: Array.from(selectedIds), action: 'restore' })}
                          className="px-3 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 font-medium flex items-center gap-1"
                        >
                          <RotateCcw size={14} /> Geri Yükle
                        </button>
                        <button
                          onClick={() => bulkMut.mutate({ ids: Array.from(selectedIds), action: 'deletePermanent' })}
                          className="px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium flex items-center gap-1"
                        >
                          <Trash2 size={14} /> Kalıcı Sil
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => { setMoveDestId(null); setMoveTargetIds(Array.from(selectedIds)); }}
                          className="px-3 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 font-medium flex items-center gap-1"
                        >
                          <FolderInput size={14} /> Klasöre Taşı
                        </button>
                        <button
                          onClick={() => bulkMut.mutate({ ids: Array.from(selectedIds), action: 'star' })}
                          className="px-3 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 font-medium flex items-center gap-1"
                        >
                          <Star size={14} /> Yıldızla
                        </button>
                        <button
                          onClick={() => bulkMut.mutate({ ids: Array.from(selectedIds), action: 'trash' })}
                          className="px-3 py-1 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium flex items-center gap-1"
                        >
                          <Trash2 size={14} /> Sil
                        </button>
                      </>
                    )}
                    <button onClick={() => setSelectedIds(new Set())} className="p-1 text-slate-500 hover:text-slate-700">
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* Sürükle-Bırak ve Dosya Alanı */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                className={`flex-1 rounded-2xl transition p-1 ${
                  dragOver ? 'border-2 border-dashed border-blue-500 bg-blue-50/40' : ''
                }`}
              >
                {isLoading && (
                  <div className="text-slate-400 text-center py-20 text-sm">Dosyalar yükleniyor...</div>
                )}

                {!isLoading && items.length === 0 && (
                  <div className="bg-white border border-dashed border-slate-300 rounded-2xl py-20 px-4 text-center space-y-3">
                    <Folder size={48} className="mx-auto text-slate-300" />
                    <div className="text-slate-600 font-medium">
                      {isTrashed ? 'Çöp kutusu boş' : isStarred ? 'Henüz yıldızlı dosya yok' : 'Bu klasör boş'}
                    </div>
                    {!isTrashed && navTab === 'files' && (
                      <p className="text-xs text-slate-400">
                        Dosyaları buraya sürükleyip bırakabilir veya yukarıdaki <b>Dosya Yükle</b> butonunu kullanabilirsiniz.
                      </p>
                    )}
                  </div>
                )}

                {!isLoading && items.length > 0 && viewMode === 'grid' && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                    {items.map(f => {
                      const isSel = selectedIds.has(f.id);
                      return (
                        <div
                          key={f.id}
                          onClick={() => openItem(f)}
                          className={`group bg-white border rounded-2xl p-3 hover:shadow-md transition cursor-pointer relative flex flex-col justify-between ${
                            isSel ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/20' : 'border-slate-200'
                          }`}
                        >
                          {/* Üst Seçim & Yıldız */}
                          <div className="flex items-center justify-between mb-2">
                            <button
                              onClick={(e) => toggleSelect(f.id, e)}
                              className="p-1 text-slate-400 hover:text-blue-600"
                              title="Seç"
                            >
                              {isSel ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} />}
                            </button>
                            {!isTrashed && (
                              <button
                                onClick={(e) => { e.stopPropagation(); starMut.mutate({ id: f.id, starred: !f.starred }); }}
                                className={`p-1 ${f.starred ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'}`}
                                title="Yıldızla"
                              >
                                <Star size={16} fill={f.starred ? 'currentColor' : 'none'} />
                              </button>
                            )}
                          </div>

                          {/* İkon */}
                          <div className="flex justify-center my-2">
                            {renderFileIcon(f, 42)}
                          </div>

                          {/* İsim & Boyut */}
                          <div className="mt-2 text-center">
                            <div className="text-xs sm:text-sm font-medium text-slate-800 truncate" title={f.name}>
                              {f.name}
                            </div>
                            <div className="text-[11px] text-slate-400 mt-0.5 flex items-center justify-center gap-1.5">
                              <span>{f.kind === 'folder' ? 'Klasör' : formatSize(f.size)}</span>
                              {!!f.shareCount && (
                                <span className="text-blue-600 inline-flex items-center" title="Paylaşımda">
                                  <Link2 size={11} />
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Alt İşlem Butonları (Hem dokunmatik Android hem masaüstü uyumlu) */}
                          <div
                            onClick={e => e.stopPropagation()}
                            className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-center gap-1 flex-wrap"
                          >
                            {isTrashed ? (
                              <>
                                <button
                                  title="Geri yükle"
                                  onClick={() => restoreMut.mutate(f.id)}
                                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
                                >
                                  <RotateCcw size={14} />
                                </button>
                                <button
                                  title="Kalıcı sil"
                                  onClick={() => permMut.mutate(f.id)}
                                  className="p-1.5 rounded-lg hover:bg-red-50 text-red-600"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            ) : (
                              <>
                                {f.kind === 'file' && (
                                  <button
                                    title="İndir"
                                    onClick={() => downloadFile(f)}
                                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
                                  >
                                    <Download size={14} />
                                  </button>
                                )}
                                <button
                                  title="Paylaş"
                                  onClick={() => openShareModal(f)}
                                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
                                >
                                  <Share2 size={14} />
                                </button>
                                <button
                                  title="Yeniden Adlandır"
                                  onClick={() => { setRenameTarget(f); setRenameValue(f.name); }}
                                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  title="Klasöre Taşı"
                                  onClick={() => { setMoveDestId(f.parentId); setMoveTargetIds([f.id]); }}
                                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600"
                                >
                                  <FolderInput size={14} />
                                </button>
                                <button
                                  title="Çöp Kutusuna Taşı"
                                  onClick={() => trashMut.mutate(f.id)}
                                  className="p-1.5 rounded-lg hover:bg-red-50 text-red-600"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {!isLoading && items.length > 0 && viewMode === 'list' && (
                  <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500 uppercase">
                          <th className="p-3 w-10"></th>
                          <th className="p-3">Ad</th>
                          <th className="p-3 hidden sm:table-cell">Boyut</th>
                          <th className="p-3 hidden md:table-cell">Değiştirilme</th>
                          <th className="p-3 text-right">İşlemler</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map(f => {
                          const isSel = selectedIds.has(f.id);
                          return (
                            <tr
                              key={f.id}
                              onClick={() => openItem(f)}
                              className={`hover:bg-slate-50 cursor-pointer ${isSel ? 'bg-blue-50/40' : ''}`}
                            >
                              <td className="p-3" onClick={e => toggleSelect(f.id, e)}>
                                {isSel ? <CheckSquare size={16} className="text-blue-600" /> : <Square size={16} className="text-slate-400" />}
                              </td>
                              <td className="p-3">
                                <div className="flex items-center gap-2.5">
                                  {renderFileIcon(f, 20)}
                                  <span className="font-medium text-slate-800 truncate max-w-[200px] sm:max-w-xs">{f.name}</span>
                                  {f.starred && <Star size={14} className="text-amber-400 shrink-0" fill="currentColor" />}
                                  {!!f.shareCount && <Link2 size={14} className="text-blue-600 shrink-0" />}
                                </div>
                              </td>
                              <td className="p-3 text-xs text-slate-500 hidden sm:table-cell">
                                {f.kind === 'folder' ? '—' : formatSize(f.size)}
                              </td>
                              <td className="p-3 text-xs text-slate-500 hidden md:table-cell">
                                {new Date(f.updatedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                              </td>
                              <td className="p-3 text-right" onClick={e => e.stopPropagation()}>
                                <div className="inline-flex items-center gap-1">
                                  {isTrashed ? (
                                    <>
                                      <button onClick={() => restoreMut.mutate(f.id)} className="p-1.5 rounded hover:bg-slate-200" title="Geri yükle"><RotateCcw size={15} /></button>
                                      <button onClick={() => permMut.mutate(f.id)} className="p-1.5 rounded hover:bg-red-100 text-red-600" title="Kalıcı sil"><Trash2 size={15} /></button>
                                    </>
                                  ) : (
                                    <>
                                      {f.kind === 'file' && (
                                        <>
                                          <button onClick={() => downloadFile(f)} className="p-1.5 rounded hover:bg-slate-200" title="İndir"><Download size={15} /></button>
                                          <button onClick={() => copyMut.mutate(f.id)} className="p-1.5 rounded hover:bg-slate-200" title="Kopyasını Oluştur"><Copy size={15} /></button>
                                        </>
                                      )}
                                      <button onClick={() => openShareModal(f)} className="p-1.5 rounded hover:bg-slate-200" title="Paylaş"><Share2 size={15} /></button>
                                      <button onClick={() => { setRenameTarget(f); setRenameValue(f.name); }} className="p-1.5 rounded hover:bg-slate-200" title="Yeniden Adlandır"><Edit3 size={15} /></button>
                                      <button onClick={() => { setMoveDestId(f.parentId); setMoveTargetIds([f.id]); }} className="p-1.5 rounded hover:bg-slate-200" title="Taşı"><FolderInput size={15} /></button>
                                      <button onClick={() => trashMut.mutate(f.id)} className="p-1.5 rounded hover:bg-red-100 text-red-600" title="Sil"><Trash2 size={15} /></button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Yükleme İlerlemesi ve Yüzde (%) Göstergesi (Sağ Alt Kutu) */}
      {uploads.length > 0 && (
        <div className="fixed bottom-4 right-4 z-40 w-88 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-2xl overflow-hidden">
          <div className="bg-slate-900 text-white px-4 py-3 text-xs font-semibold flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Upload size={15} className="text-blue-400 animate-bounce" />
              <span>
                Dosya Yükleme ({uploads.filter(u => u.status === 'done').length}/{uploads.length})
              </span>
            </div>
            <button onClick={() => setUploads([])} className="text-slate-400 hover:text-white" title="Kapat">
              <X size={16} />
            </button>
          </div>
          <div className="max-h-64 overflow-auto divide-y divide-slate-100 p-2.5 space-y-1.5">
            {uploads.map(u => (
              <div key={u.id} className="p-2.5 rounded-xl bg-slate-50/70 text-xs space-y-1.5">
                <div className="flex justify-between items-center gap-2">
                  <span className="truncate font-semibold text-slate-800 flex-1" title={u.name}>{u.name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`font-bold text-sm ${
                      u.status === 'error' ? 'text-red-600' : u.status === 'done' ? 'text-emerald-600' : 'text-blue-600'
                    }`}>
                      {u.status === 'done' ? '%100 ✓' : u.status === 'error' ? 'Hata' : `%${u.progress.toFixed(1)}`}
                    </span>
                    {u.status === 'uploading' && u.abort && (
                      <button
                        onClick={() => u.abort?.()}
                        className="p-0.5 text-slate-400 hover:text-red-600 rounded"
                        title="Yüklemeyi İptal Et"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="w-full h-2.5 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      u.status === 'error' ? 'bg-red-500' : u.status === 'done' ? 'bg-emerald-500' : 'bg-blue-600'
                    }`}
                    style={{ width: `${u.progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    {formatSize(u.loadedBytes)} / {formatSize(u.totalBytes)} • Parça {u.chunkIndex}/{u.totalChunks}
                  </span>
                  <span>
                    {u.status === 'uploading' && u.speedBps > 0 ? `${formatSize(u.speedBps)}/sn` : ''}
                    {u.status === 'done' ? 'Tamamlandı' : ''}
                    {u.status === 'error' ? (u.error || 'Başarısız') : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: Aynı İsimli Dosya / Klasör Çakışma Sorusu */}
      {conflictPrompt && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Aynı İsimde Öğeler Bulundu</h3>
              <button onClick={() => setConflictPrompt(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-slate-600">
              Yüklemek istediğiniz bazı klasör veya dosyalar bu dizinde zaten mevcut. Nasıl devam etmek istersiniz?
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 max-h-40 overflow-auto space-y-1 text-xs">
              {conflictPrompt.folderConflicts.map(fc => (
                <div key={`dir-${fc}`} className="flex items-center gap-2 text-amber-700 font-medium">
                  <Folder size={14} className="shrink-0" />
                  <span className="truncate">Klasör: {fc}</span>
                </div>
              ))}
              {conflictPrompt.fileConflicts.map(f => (
                <div key={`file-${f}`} className="flex items-center gap-2 text-slate-700">
                  <FileIcon size={14} className="shrink-0 text-slate-400" />
                  <span className="truncate">{f}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 pt-1">
              <button
                onClick={() => {
                  const p = conflictPrompt;
                  setConflictPrompt(null);
                  const set = new Set(p.fileConflicts.map(c => c.toLowerCase()));
                  executeBatchUpload(p.targetParent, p.entries, p.emptyFolders, 'overwrite', set);
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-semibold text-left flex items-center justify-between"
              >
                <span>Üzerine Yaz (Mevcut Klasörle Birleştir ve Değiştir)</span>
                <Check size={16} />
              </button>

              <button
                onClick={() => {
                  const p = conflictPrompt;
                  setConflictPrompt(null);
                  const set = new Set(p.fileConflicts.map(c => c.toLowerCase()));
                  const mode = p.folderConflicts.length > 0 && p.fileConflicts.length === 0 ? 'rename-folder' : 'rename';
                  executeBatchUpload(p.targetParent, p.entries, p.emptyFolders, mode, set);
                }}
                className="w-full py-2.5 px-4 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold text-left"
              >
                İkisini de Tut — Yanına (1) Ekleyerek Kaydet
              </button>

              {conflictPrompt.fileConflicts.length > 0 && (
                <button
                  onClick={() => {
                    const p = conflictPrompt;
                    setConflictPrompt(null);
                    const set = new Set(p.fileConflicts.map(c => c.toLowerCase()));
                    executeBatchUpload(p.targetParent, p.entries, p.emptyFolders, 'skip', set);
                  }}
                  className="w-full py-2.5 px-4 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs sm:text-sm font-medium text-left"
                >
                  Aynı Olan Dosyaları Atla (Sadece Yeni Dosyaları Yükle)
                </button>
              )}

              <button
                onClick={() => setConflictPrompt(null)}
                className="w-full py-2 px-4 rounded-xl text-slate-500 hover:bg-slate-100 text-xs font-medium text-center"
              >
                Yüklemeyi İptal Et
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Yeni Klasör */}
      {folderModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={e => { e.preventDefault(); if (newFolderName.trim()) createFolderMut.mutate(newFolderName.trim()); }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4"
          >
            <h3 className="text-lg font-bold">Yeni Klasör Oluştur</h3>
            <input
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Klasör adı..."
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              autoFocus
              required
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setFolderModalOpen(false)} className="px-4 py-2 rounded-xl border text-sm">İptal</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold">Oluştur</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Yeniden Adlandır */}
      {renameTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form
            onSubmit={e => {
              e.preventDefault();
              if (renameValue.trim()) renameMut.mutate({ id: renameTarget.id, name: renameValue.trim() });
            }}
            className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4"
          >
            <h3 className="text-lg font-bold">Yeniden Adlandır</h3>
            <input
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              autoFocus
              required
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setRenameTarget(null)} className="px-4 py-2 rounded-xl border text-sm">İptal</button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold">Kaydet</button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL: Klasöre Taşı */}
      {moveTargetIds && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <h3 className="text-lg font-bold">Hedef Klasörü Seçin</h3>
            <div className="border rounded-xl max-h-64 overflow-auto divide-y">
              <button
                onClick={() => setMoveDestId(null)}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 ${moveDestId === null ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50'}`}
              >
                <Home size={16} /> Ana Dizin (Kök Klasör)
              </button>
              {(foldersQuery.data || [])
                .filter(f => !moveTargetIds.includes(f.id))
                .map(folder => (
                  <button
                    key={folder.id}
                    onClick={() => setMoveDestId(folder.id)}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-2 ${moveDestId === folder.id ? 'bg-blue-50 text-blue-700 font-semibold' : 'hover:bg-slate-50'}`}
                  >
                    <Folder size={16} className="text-amber-500 shrink-0" />
                    <span className="truncate">{folder.name}</span>
                  </button>
                ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setMoveTargetIds(null)} className="px-4 py-2 rounded-xl border text-sm">İptal</button>
              <button
                onClick={() => bulkMut.mutate({ ids: moveTargetIds, action: 'move', dest: moveDestId })}
                className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold"
              >
                Buraya Taşı
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Gelişmiş Paylaşım */}
      {shareTarget && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold">Paylaşım Linki Oluştur</h3>
              <button onClick={() => setShareTarget(null)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-xl">
              Paylaşılan öğe: <b className="text-slate-800">{shareTarget.name}</b>
            </div>

            {!createdShare ? (
              <form onSubmit={handleCreateShare} className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Geçerlilik Süresi
                  </label>
                  <select
                    value={shareExpireDays}
                    onChange={e => setShareExpireDays(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none"
                  >
                    <option value="0">Süresiz (Ben iptal edene kadar)</option>
                    <option value="1">1 Gün</option>
                    <option value="7">7 Gün</option>
                    <option value="30">30 Gün</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Paylaşım Şifresi (İsteğe Bağlı)
                  </label>
                  <input
                    type="text"
                    placeholder="Boş bırakırsanız linke sahip herkes açabilir"
                    value={sharePassword}
                    onChange={e => setSharePassword(e.target.value)}
                    className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button type="button" onClick={() => setShareTarget(null)} className="px-4 py-2 rounded-xl border text-sm">İptal</button>
                  <button type="submit" className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold">
                    Link Oluştur ve Kopyala
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 font-medium">
                  Paylaşım linki hazır!
                </div>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={createdShare.url}
                    className="flex-1 border rounded-xl px-3 py-2 text-xs bg-slate-50 font-mono"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(createdShare.url).catch(() => {});
                      notify('Link kopyalandı');
                    }}
                    className="px-3 py-2 bg-blue-600 text-white rounded-xl text-xs font-semibold"
                  >
                    Kopyala
                  </button>
                </div>
                <div className="flex justify-end">
                  <button onClick={() => setShareTarget(null)} className="px-4 py-2 rounded-xl border text-sm">Kapat</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Dosya Önizleme (Preview Lightbox) */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-black/50 text-white">
            <div className="truncate font-medium text-sm">{previewFile.name} ({formatSize(previewFile.size)})</div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => openShareModal(previewFile)}
                className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs flex items-center gap-1"
              >
                <Share2 size={14} /> Paylaş
              </button>
              <button
                onClick={() => downloadFile(previewFile)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-xs font-semibold flex items-center gap-1"
              >
                <Download size={14} /> İndir
              </button>
              <button onClick={() => setPreviewFile(null)} className="p-1.5 hover:bg-white/20 rounded-lg">
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="flex-1 flex items-center justify-center p-4 overflow-auto" onClick={() => setPreviewFile(null)}>
            <div onClick={e => e.stopPropagation()} className="max-w-5xl max-h-full w-full flex items-center justify-center">
              {isImageFile(previewFile) ? (
                <img
                  src={api.downloadUrl(previewFile.id, true)}
                  alt={previewFile.name}
                  className="max-h-[82vh] max-w-full object-contain rounded-lg shadow-2xl"
                />
              ) : isVideoFile(previewFile) ? (
                <video
                  src={api.downloadUrl(previewFile.id, true)}
                  controls
                  autoPlay
                  className="max-h-[82vh] max-w-full rounded-lg shadow-2xl bg-black"
                />
              ) : isAudioFile(previewFile) ? (
                <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md text-center space-y-4">
                  <Music size={48} className="mx-auto text-blue-600" />
                  <div className="font-semibold text-slate-800">{previewFile.name}</div>
                  <audio src={api.downloadUrl(previewFile.id, true)} controls autoPlay className="w-full" />
                </div>
              ) : isPdfFile(previewFile) ? (
                <iframe
                  src={api.downloadUrl(previewFile.id, true)}
                  title={previewFile.name}
                  className="w-full h-[82vh] bg-white rounded-xl"
                />
              ) : isTextFile(previewFile) ? (
                <pre className="bg-slate-900 text-slate-100 p-5 rounded-2xl w-full max-h-[80vh] overflow-auto text-xs font-mono whitespace-pre-wrap">
                  {previewText ?? 'Yükleniyor...'}
                </pre>
              ) : (
                <div className="bg-white p-8 rounded-2xl shadow-xl text-center space-y-4 max-w-sm w-full">
                  {renderFileIcon(previewFile, 56)}
                  <div className="font-semibold text-slate-800 break-all">{previewFile.name}</div>
                  <div className="text-xs text-slate-500">{formatSize(previewFile.size)}</div>
                  <button
                    onClick={() => downloadFile(previewFile)}
                    className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-semibold text-sm hover:bg-blue-700"
                  >
                    Dosyayı İndir
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Yönetim / Kurallar / Yayın / Profil */}
      {activeSettingsModal && (
        <SettingsModals
          tab={activeSettingsModal}
          setTab={setActiveSettingsModal}
          onClose={() => setActiveSettingsModal(null)}
          notify={notify}
          refreshUser={refreshUser}
        />
      )}
    </div>
  );
}

function SharesView({
  shares,
  isLoading,
  onDelete,
  onCopy
}: {
  shares: ShareLink[];
  isLoading: boolean;
  onDelete: (id: string) => void;
  onCopy: (url: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Paylaşılan Linkler</h2>
          <p className="text-xs text-slate-500">Dışarıya açtığınız tüm dosya ve klasör bağlantılarını buradan yönetebilir veya iptal edebilirsiniz.</p>
        </div>
      </div>

      {isLoading && <div className="text-sm text-slate-400 py-12 text-center">Yükleniyor...</div>}
      {!isLoading && shares.length === 0 && (
        <div className="bg-white border border-dashed border-slate-300 rounded-2xl py-16 text-center space-y-2">
          <Link2 size={40} className="mx-auto text-slate-300" />
          <div className="text-sm font-medium text-slate-600">Aktif paylaşım linki bulunmuyor</div>
          <div className="text-xs text-slate-400">Herhangi bir dosya veya klasördeki Paylaş ikonuna tıklayarak link oluşturabilirsiniz.</div>
        </div>
      )}

      {!isLoading && shares.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-left border-collapse text-sm">
            <thead>
              <tr className="bg-slate-50 border-b text-xs text-slate-500 uppercase">
                <th className="p-3">Dosya / Klasör</th>
                <th className="p-3">Koruma / Süre</th>
                <th className="p-3">Paylaşım Adresi</th>
                <th className="p-3 text-right">İşlem</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {shares.map(s => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="p-3 font-medium">{s.fileName || 'Dosya'}</td>
                  <td className="p-3 text-xs text-slate-500">
                    <div className="flex items-center gap-2">
                      {s.hasPassword ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-medium">
                          <Lock size={11} /> Şifreli
                        </span>
                      ) : (
                        <span className="text-slate-400">Herkese Açık</span>
                      )}
                      {s.expiresAt && (
                        <span>• Bitiş: {new Date(s.expiresAt).toLocaleDateString('tr-TR')}</span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-xs font-mono text-blue-600 truncate max-w-xs">{s.url}</td>
                  <td className="p-3 text-right space-x-2">
                    <button
                      onClick={() => onCopy(s.url)}
                      className="px-3 py-1 bg-blue-50 text-blue-600 rounded-lg text-xs font-semibold hover:bg-blue-100"
                    >
                      Kopyala
                    </button>
                    <button
                      onClick={() => onDelete(s.id)}
                      className="px-3 py-1 bg-red-50 text-red-600 rounded-lg text-xs font-semibold hover:bg-red-100"
                    >
                      İptal Et
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingsModals({
  tab,
  setTab,
  onClose,
  notify,
  refreshUser
}: {
  tab: 'profile' | 'rules' | 'users' | 'publish';
  setTab: (t: 'profile' | 'rules' | 'users' | 'publish') => void;
  onClose: () => void;
  notify: (msg: string, type?: 'ok' | 'err') => void;
  refreshUser: () => Promise<void>;
}) {
  const { api, user, serverUrl, setServerUrl } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Profile state
  const [username, setUsername] = useState(user?.username || '');
  const [name, setName] = useState(user?.name || '');
  const [newPassword, setNewPassword] = useState('');
  const [serverInput, setServerInput] = useState(serverUrl);

  // Rules state
  const [rules, setRules] = useState<DriveRules | null>(null);

  // Users state
  const [users, setUsers] = useState<User[]>([]);
  const [newUName, setNewUName] = useState('');
  const [newUPass, setNewUPass] = useState('');
  const [newUDisplay, setNewUDisplay] = useState('');
  const [newUQuota, setNewUQuota] = useState('0');
  const [resetPassMap, setResetPassMap] = useState<Record<string, string>>({});

  // Publish state
  const [pub, setPub] = useState<PublishStatus | null>(null);
  const [tMode, setTMode] = useState<'off' | 'quick' | 'token'>('off');
  const [tToken, setTToken] = useState('');
  const [tPublicUrl, setTPublicUrl] = useState('');
  const [pubSaving, setPubSaving] = useState(false);

  useEffect(() => {
    if (tab === 'rules' && isAdmin) {
      api.getRules().then(setRules).catch(e => notify(e.message, 'err'));
    }
    if (tab === 'users' && isAdmin) {
      api.listUsers().then(setUsers).catch(e => notify(e.message, 'err'));
    }
    if (tab === 'publish' && isAdmin) {
      api.getPublishStatus().then(s => {
        setPub(s);
        setTMode(s.mode);
        setTPublicUrl(s.publicUrl);
      }).catch(e => notify(e.message, 'err'));
    }
  }, [tab, isAdmin, api, notify]);

  // Tünel indirilirken veya bağlanırken durumu her 2 saniyede bir otomatik güncelle
  useEffect(() => {
    if (tab !== 'publish' || !isAdmin) return;
    if (!pub || (pub.status !== 'downloading' && pub.status !== 'starting' && !(pub.mode !== 'off' && !pub.url))) return;
    const timer = setInterval(() => {
      api.getPublishStatus().then(setPub).catch(() => {});
    }, 2000);
    return () => clearInterval(timer);
  }, [tab, isAdmin, pub, api]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (IS_NATIVE && serverInput !== serverUrl) {
        setServerUrl(serverInput);
      }
      await api.updateProfile({
        username: username.trim(),
        name: name.trim(),
        newPassword: newPassword || undefined
      });
      setNewPassword('');
      await refreshUser();
      notify('Hesap bilgileriniz güncellendi');
    } catch (err: any) {
      notify(err.message, 'err');
    }
  };

  const saveDriveRules = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rules) return;
    try {
      const updated = await api.updateRules(rules);
      setRules(updated);
      notify('Drive kuralları kaydedildi');
    } catch (err: any) {
      notify(err.message, 'err');
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.adminCreateUser({
        username: newUName.trim(),
        password: newUPass,
        name: newUDisplay.trim() || newUName.trim(),
        quotaMb: Number(newUQuota) || 0
      });
      setNewUName('');
      setNewUPass('');
      setNewUDisplay('');
      setUsers(await api.listUsers());
      notify('Kullanıcı eklendi');
    } catch (err: any) {
      notify(err.message, 'err');
    }
  };

  const handleResetUserPass = async (uId: string) => {
    const p = resetPassMap[uId];
    if (!p || p.length < 6) {
      notify('Yeni şifre en az 6 karakter olmalı', 'err');
      return;
    }
    try {
      await api.adminUpdateUser(uId, { password: p });
      setResetPassMap(prev => ({ ...prev, [uId]: '' }));
      notify('Kullanıcı şifresi güncellendi');
    } catch (err: any) {
      notify(err.message, 'err');
    }
  };

  const handleSavePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setPubSaving(true);
    try {
      const res = await api.updatePublish({
        mode: tMode,
        token: tToken.trim() || undefined,
        publicUrl: tPublicUrl.trim() || undefined
      });
      setPub(res);
      setTToken('');
      notify(tMode === 'off' ? 'İnternet yayını kapatıldı' : 'Yayın ayarları kaydedildi. Tünel bağlanıyor...');
      setTimeout(() => {
        api.getPublishStatus().then(setPub).catch(() => {});
      }, 3500);
    } catch (err: any) {
      notify(err.message, 'err');
    } finally {
      setPubSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Sekme Başlıkları */}
        <div className="flex items-center justify-between border-b px-4 pt-3 bg-slate-50">
          <div className="flex gap-1 overflow-x-auto">
            <button
              onClick={() => setTab('profile')}
              className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition whitespace-nowrap ${
                tab === 'profile' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              Hesabım & Şifre
            </button>
            {isAdmin && (
              <>
                <button
                  onClick={() => setTab('publish')}
                  className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition whitespace-nowrap ${
                    tab === 'publish' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Dış Yayın & Android
                </button>
                <button
                  onClick={() => setTab('rules')}
                  className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition whitespace-nowrap ${
                    tab === 'rules' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Drive Kuralları
                </button>
                <button
                  onClick={() => setTab('users')}
                  className={`px-3 py-2 text-xs sm:text-sm font-semibold border-b-2 transition whitespace-nowrap ${
                    tab === 'users' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Kullanıcılar
                </button>
              </>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-700 mb-1">
            <X size={18} />
          </button>
        </div>

        {/* Sekme İçeriği */}
        <div className="p-5 overflow-auto space-y-5 text-sm">
          {tab === 'profile' && (
            <form onSubmit={saveProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                  Kullanıcı Adı (Giriş için kullanılır)
                </label>
                <input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  className="w-full border rounded-xl px-3.5 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                  Görünen Ad
                </label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full border rounded-xl px-3.5 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                  Yeni Şifre Belirle (Değiştirmek istemiyorsanız boş bırakın)
                </label>
                <input
                  type="password"
                  placeholder="En az 6 karakter..."
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full border rounded-xl px-3.5 py-2 text-sm"
                />
              </div>
              {IS_NATIVE && (
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Bağlı Sunucu Adresi
                  </label>
                  <input
                    value={serverInput}
                    onChange={e => setServerInput(e.target.value)}
                    className="w-full border rounded-xl px-3.5 py-2 text-sm"
                  />
                </div>
              )}
              <div className="flex justify-end">
                <button className="bg-blue-600 text-white px-5 py-2 rounded-xl font-semibold hover:bg-blue-700">
                  Bilgileri Güncelle
                </button>
              </div>
            </form>
          )}

          {tab === 'publish' && pub && (
            <div className="space-y-4">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Yayın ve Erişim Adresleri (PC Açıkken Aktif)</span>
                  <button
                    type="button"
                    onClick={() => api.getPublishStatus().then(setPub)}
                    className="text-blue-600 hover:underline flex items-center gap-1"
                  >
                    <RefreshCw size={12} /> Durumu Yenile
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-1.5 pt-1">
                  <div>
                    <span className="text-slate-500">Bu Bilgisayar: </span>
                    <code className="bg-white border px-2 py-0.5 rounded font-mono">{pub.localUrl}</code>
                  </div>
                  <div>
                    <span className="text-slate-500">Ev / Ofis Wi-Fi (Android & Web): </span>
                    {pub.lanUrls.length ? pub.lanUrls.map(u => (
                      <code key={u} className="bg-white border px-2 py-0.5 rounded font-mono mr-1">{u}</code>
                    )) : <span className="text-slate-400">Yok</span>}
                  </div>
                  <div>
                    <span className="text-slate-500">Dış İnternet Adresi (HTTPS): </span>
                    {pub.url ? (
                      <span className="inline-flex items-center gap-2">
                        <code className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-0.5 rounded font-mono font-bold">
                          {pub.url}
                        </code>
                        <button
                          type="button"
                          onClick={() => { navigator.clipboard.writeText(pub.url); notify('İnternet adresi kopyalandı'); }}
                          className="text-blue-600 underline"
                        >
                          Kopyala
                        </button>
                      </span>
                    ) : (
                      <span className="text-amber-600 font-medium">
                        {pub.status === 'starting' || pub.status === 'downloading' ? 'Tünel başlatılıyor, birkaç saniye sonra Yenile\'ye basın...' : 'Kapalı'}
                      </span>
                    )}
                  </div>
                  {pub.apkAvailable && pub.apkUrl && (
                    <div className="pt-1 flex items-center gap-2">
                      <Smartphone size={14} className="text-blue-600" />
                      <span className="text-slate-600">Android APK İndirme Linki:</span>
                      <a href="/NukeDrive.apk" className="text-blue-600 font-semibold underline">{pub.apkUrl}</a>
                    </div>
                  )}
                </div>
              </div>

              <form onSubmit={handleSavePublish} className="space-y-3">
                <div className="font-semibold text-slate-800">Dışarıya Yayın Modu (Cloudflare Tunnel)</div>
                <label className="flex items-start gap-2.5 p-3 border rounded-xl cursor-pointer hover:bg-slate-50">
                  <input type="radio" checked={tMode === 'off'} onChange={() => setTMode('off')} className="mt-1" />
                  <div>
                    <div className="font-semibold">Sadece Yerel Ağ (Wi-Fi)</div>
                    <div className="text-xs text-slate-500">İnternet tüneli kapalıdır; yalnızca aynı Wi-Fi ağındaki cihazlar erişebilir.</div>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-3 border rounded-xl cursor-pointer hover:bg-slate-50">
                  <input type="radio" checked={tMode === 'quick'} onChange={() => setTMode('quick')} className="mt-1" />
                  <div>
                    <div className="font-semibold">Ücretsiz Hızlı İnternet Yayını (*.trycloudflare.com)</div>
                    <div className="text-xs text-slate-500">Alan adı veya Cloudflare hesabı gerekmez. Tek tıkla dışarıdan HTTPS ile hem web sitenizden hem Android uygulamanızdan kullanıcı adı ve şifrenizle erişirsiniz.</div>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 p-3 border rounded-xl cursor-pointer hover:bg-slate-50">
                  <input type="radio" checked={tMode === 'token'} onChange={() => setTMode('token')} className="mt-1" />
                  <div>
                    <div className="font-semibold">Kendi Web Siteniz / Alan Adınız (Kalıcı Cloudflare Tunnel)</div>
                    <div className="text-xs text-slate-500">Kendi alan adınızla (ör. https://drive.siteniz.com) sabit adres üzerinden yayın yapar.</div>
                  </div>
                </label>

                {tMode === 'token' && (
                  <div className="bg-slate-50 p-3.5 rounded-xl border space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Web Sitenizin Adresi (Public Hostname)</label>
                      <input
                        placeholder="https://drive.alanadiniz.com"
                        value={tPublicUrl}
                        onChange={e => setTPublicUrl(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Cloudflare Tunnel Token</label>
                      <input
                        type="password"
                        placeholder={pub.hasToken ? 'Kayıtlı token var (değiştirmek için yenisini girin)' : 'eyJhIjoi...'}
                        value={tToken}
                        onChange={e => setTToken(e.target.value)}
                        className="w-full border rounded-lg px-3 py-2 text-sm bg-white"
                      />
                    </div>
                  </div>
                )}

                <div className="flex justify-end">
                  <button disabled={pubSaving} className="bg-blue-600 text-white px-5 py-2 rounded-xl font-semibold hover:bg-blue-700 disabled:opacity-50">
                    {pubSaving ? 'Kaydediliyor...' : 'Yayın Ayarlarını Kaydet ve Başlat'}
                  </button>
                </div>
                {pub.log && pub.log.length > 0 && (
                  <details className="text-xs pt-2">
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-700">Tünel Bağlantı Kayıtları (Log)</summary>
                    <pre className="mt-2 bg-slate-900 text-slate-200 p-3 rounded-xl max-h-36 overflow-auto font-mono text-[11px] whitespace-pre-wrap">
                      {pub.log.join('\n')}
                    </pre>
                  </details>
                )}
              </form>
            </div>
          )}

          {tab === 'rules' && rules && (
            <form onSubmit={saveDriveRules} className="space-y-4">
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
                Bu kurallar Drive sunucunuzun güvenlik, dosya yükleme, çakışma ve saklama davranışlarını belirler.
              </div>

              <label className="flex items-center justify-between p-3 border rounded-xl cursor-pointer">
                <div>
                  <div className="font-semibold">Dışarıdan Yeni Kayıt İzni</div>
                  <div className="text-xs text-slate-500">Kapalı tuttuğunuzda web sitenize dışarıdan giren kişiler kayıt olamaz; sadece sizin belirlediğiniz kullanıcı adı ve şifreyle giriş yapılabilir.</div>
                </div>
                <input
                  type="checkbox"
                  checked={rules.allowRegister}
                  onChange={e => setRules({ ...rules, allowRegister: e.target.checked })}
                  className="w-5 h-5 accent-blue-600"
                />
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Aynı İsimli Dosya Çakışma Kuralı
                  </label>
                  <select
                    value={rules.conflictRule}
                    onChange={e => setRules({ ...rules, conflictRule: e.target.value as any })}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                  >
                    <option value="rename">Otomatik Numaralandır — dosya (1).ext</option>
                    <option value="overwrite">Mevcut Dosyanın Üzerine Yaz</option>
                    <option value="reject">Yüklemeyi Reddet (Hata Ver)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Maksimum Tek Dosya Boyutu (MB)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={102400}
                    value={rules.maxUploadMb}
                    onChange={e => setRules({ ...rules, maxUploadMb: Number(e.target.value) })}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Çöp Kutusu Otomatik Temizleme (Gün)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={365}
                    value={rules.trashRetentionDays}
                    onChange={e => setRules({ ...rules, trashRetentionDays: Number(e.target.value) })}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                    Varsayılan Kullanıcı Kotası (MB, 0=Sınırsız)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={rules.defaultQuotaMb}
                    onChange={e => setRules({ ...rules, defaultQuotaMb: Number(e.target.value) })}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 uppercase mb-1">
                  Engellenen Dosya Uzantıları (Virgülle ayırın, boş = tüm dosya türleri serbest)
                </label>
                <input
                  placeholder="ör. .scr,.vbs"
                  value={rules.blockedExtensions}
                  onChange={e => setRules({ ...rules, blockedExtensions: e.target.value })}
                  className="w-full border rounded-xl px-3 py-2 text-sm"
                />
              </div>

              <div className="flex justify-end">
                <button className="bg-blue-600 text-white px-5 py-2 rounded-xl font-semibold hover:bg-blue-700">
                  Kuralları Kaydet
                </button>
              </div>
            </form>
          )}

          {tab === 'users' && (
            <div className="space-y-5">
              <form onSubmit={handleAddUser} className="bg-slate-50 border rounded-xl p-4 space-y-3">
                <div className="font-semibold text-slate-800">Yeni Kullanıcı Ekle</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    placeholder="Kullanıcı adı (ör. ahmet)"
                    value={newUName}
                    onChange={e => setNewUName(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-xs bg-white"
                    required
                  />
                  <input
                    type="password"
                    placeholder="Şifre (en az 6 krktr)"
                    value={newUPass}
                    onChange={e => setNewUPass(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-xs bg-white"
                    required
                  />
                  <input
                    type="number"
                    placeholder="Kota MB (0 = Sınırsız)"
                    value={newUQuota}
                    onChange={e => setNewUQuota(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-xs bg-white"
                  />
                </div>
                <div className="flex justify-end">
                  <button className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-xs font-semibold">
                    Kullanıcı Oluştur
                  </button>
                </div>
              </form>

              <div className="border rounded-xl divide-y">
                {users.map(u => (
                  <div key={u.id} className="p-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold text-slate-800 flex items-center gap-2">
                        <span>{u.username}</span>
                        <span className="text-xs font-normal text-slate-500">({u.name})</span>
                        {u.role === 'admin' && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">YÖNETİCİ</span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400">
                        Kullanılan: {formatSize(u.usedBytes || 0)}
                        {u.quotaBytes > 0 ? ` / Kota: ${formatSize(u.quotaBytes)}` : ' (Sınırsız)'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        placeholder="Yeni şifre..."
                        value={resetPassMap[u.id] || ''}
                        onChange={e => setResetPassMap(prev => ({ ...prev, [u.id]: e.target.value }))}
                        className="border rounded-lg px-2.5 py-1 text-xs w-32"
                      />
                      <button
                        type="button"
                        onClick={() => handleResetUserPass(u.id)}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-medium"
                      >
                        Şifre Değiştir
                      </button>
                      {u.id !== user?.id && (
                        <button
                          type="button"
                          onClick={async () => {
                            await api.adminDeleteUser(u.id);
                            setUsers(await api.listUsers());
                            notify('Kullanıcı silindi');
                          }}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg"
                          title="Kullanıcıyı Sil"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function isImageFile(f: DriveFile) {
  return f.mime?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(f.name);
}
function isVideoFile(f: DriveFile) {
  return f.mime?.startsWith('video/') || /\.(mp4|webm|mov|mkv)$/i.test(f.name);
}
function isAudioFile(f: DriveFile) {
  return f.mime?.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/i.test(f.name);
}
function isPdfFile(f: DriveFile) {
  return f.mime === 'application/pdf' || /\.pdf$/i.test(f.name);
}
function isTextFile(f: DriveFile) {
  return f.mime?.startsWith('text/') || /\.(txt|md|json|csv|js|ts|tsx|jsx|py|html|css|xml|yml|yaml|log|ini|env|sh|bat|ps1)$/i.test(f.name);
}

function renderFileIcon(f: DriveFile, size = 36) {
  if (f.kind === 'folder') return <Folder size={size} className="text-amber-500 fill-amber-500/20 shrink-0" />;
  if (isImageFile(f)) return <ImageIcon size={size} className="text-emerald-500 shrink-0" />;
  if (isVideoFile(f)) return <Film size={size} className="text-purple-500 shrink-0" />;
  if (isAudioFile(f)) return <Music size={size} className="text-pink-500 shrink-0" />;
  if (isPdfFile(f) || isTextFile(f)) return <FileText size={size} className="text-blue-500 shrink-0" />;
  return <FileIcon size={size} className="text-slate-400 shrink-0" />;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
