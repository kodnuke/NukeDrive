import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { db, now, getRules } from '../lib/db';
import { findUserById } from '../lib/auth';
import { saveStream, copyStorage, resolveStorage, deleteStorage, initChunkFile, appendChunkStream, finalizeChunkFile, abortChunkFile } from '../lib/storage';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
interface StorageStats {
  usedBytes: number;
  trashedBytes: number;
  quotaBytes: number;
  fileCount: number;
  folderCount: number;
  maxUploadMb: number;
}

function toDriveFile(r: any) {
  return {
    id: r.id,
    ownerId: r.owner_id,
    parentId: r.parent_id,
    name: r.name,
    kind: r.kind,
    size: r.size,
    mime: r.mime,
    starred: !!r.starred,
    trashed: !!r.trashed,
    shareCount: Number(r.share_count || 0),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function cleanName(name: unknown): string {
  return typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f\/\\]/g, '').trim().slice(0, 255) : '';
}

function resolveUniqueName(ownerId: string, parentId: string | null, desiredName: string, excludeId?: string): string {
  const existing = (parentId
    ? db.prepare('SELECT id, name FROM files WHERE owner_id=? AND parent_id=? AND trashed=0').all(ownerId, parentId)
    : db.prepare('SELECT id, name FROM files WHERE owner_id=? AND parent_id IS NULL AND trashed=0').all(ownerId)
  ) as any[];

  const names = new Set(existing.filter(r => r.id !== excludeId).map(r => String(r.name).toLowerCase()));
  if (!names.has(desiredName.toLowerCase())) return desiredName;

  const ext = path.extname(desiredName);
  const base = ext ? desiredName.slice(0, -ext.length) : desiredName;
  let i = 1;
  while (names.has(`${base} (${i})${ext}`.toLowerCase())) i++;
  return `${base} (${i})${ext}`;
}

function guessMime(name: string, fallback: string): string {
  if (fallback && fallback !== 'application/octet-stream') return fallback;
  const ext = path.extname(name).toLowerCase();
  const map: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
    '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
    '.js': 'text/plain; charset=utf-8', '.ts': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8',
    '.html': 'text/plain; charset=utf-8', '.css': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8'
  };
  return map[ext] || fallback || 'application/octet-stream';
}

function sendFile(req: any, reply: any, row: any, inline = false) {
  const fullPath = resolveStorage(row.storage_path);
  if (!fs.existsSync(fullPath)) {
    return reply.code(404).send({ message: 'Fiziksel dosya bulunamadı' });
  }
  const stat = fs.statSync(fullPath);
  const total = stat.size;
  const mime = guessMime(row.name, row.mime);
  const disposition = inline ? 'inline' : 'attachment';

  // Önizleme modunda PDF/medya çerçeve içinde açılabilsin
  if (inline) {
    reply.header('X-Frame-Options', 'SAMEORIGIN');
  }
  reply.header('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(row.name)}`);
  reply.header('Content-Type', mime);
  reply.header('Accept-Ranges', 'bytes');

  const range = req.headers.range;
  if (range && typeof range === 'string' && range.startsWith('bytes=')) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    if (!isNaN(start) && !isNaN(end) && start <= end && end < total) {
      reply.code(206);
      reply.header('Content-Range', `bytes ${start}-${end}/${total}`);
      reply.header('Content-Length', end - start + 1);
      return reply.send(fs.createReadStream(fullPath, { start, end }));
    }
  }

  reply.header('Content-Length', total);
  return reply.send(fs.createReadStream(fullPath));
}

function getOwned(id: string, ownerId: string): any {
  return db.prepare('SELECT * FROM files WHERE id=? AND owner_id=?').get(id, ownerId);
}

function breadcrumbs(parentId: string | null, ownerId: string): { id: string | null; name: string }[] {
  const crumbs: { id: string | null; name: string }[] = [{ id: null, name: 'Ana Dizin' }];
  let cur = parentId;
  const chain: any[] = [];
  while (cur) {
    const r = db.prepare('SELECT * FROM files WHERE id=? AND owner_id=?').get(cur, ownerId) as any;
    if (!r) break;
    chain.unshift(r);
    cur = r.parent_id;
  }
  for (const r of chain) crumbs.push({ id: r.id, name: r.name });
  return crumbs;
}

function computeStats(userId: string): StorageStats {
  const usedRow = db.prepare("SELECT COALESCE(SUM(size), 0) AS s, COUNT(*) AS c FROM files WHERE owner_id=? AND kind='file' AND trashed=0").get(userId) as any;
  const trashedRow = db.prepare("SELECT COALESCE(SUM(size), 0) AS s FROM files WHERE owner_id=? AND kind='file' AND trashed=1").get(userId) as any;
  const folderRow = db.prepare("SELECT COUNT(*) AS c FROM files WHERE owner_id=? AND kind='folder' AND trashed=0").get(userId) as any;
  const user = findUserById(userId);
  const rules = getRules();
  const defaultQuota = rules.defaultQuotaMb > 0 ? rules.defaultQuotaMb * 1024 * 1024 : 0;
  const quotaBytes = user?.quota_bytes && user.quota_bytes > 0 ? user.quota_bytes : defaultQuota;
  return {
    usedBytes: Number(usedRow?.s || 0),
    trashedBytes: Number(trashedRow?.s || 0),
    quotaBytes,
    fileCount: Number(usedRow?.c || 0),
    folderCount: Number(folderRow?.c || 0),
    maxUploadMb: rules.maxUploadMb
  };
}

function purgeRecursive(fid: string) {
  const r = db.prepare('SELECT * FROM files WHERE id=?').get(fid) as any;
  if (!r) return;
  if (r.kind === 'file') deleteStorage(r.storage_path);
  const children = db.prepare('SELECT id FROM files WHERE parent_id=?').all(fid) as any[];
  for (const c of children) purgeRecursive(c.id);
  db.prepare('DELETE FROM files WHERE id=?').run(fid);
}

function autoCleanTrash(userId: string) {
  const days = getRules().trashRetentionDays;
  if (!days || days <= 0) return;
  const cutoff = new Date(Date.now() - days * 86400 * 1000).toISOString();
  const expired = db.prepare('SELECT id FROM files WHERE owner_id=? AND trashed=1 AND updated_at < ?').all(userId, cutoff) as any[];
  for (const r of expired) purgeRecursive(r.id);
}

export async function fileRoutes(app: FastifyInstance) {
  app.get('/api/files/stats', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req.user as any).sub;
    return computeStats(userId);
  });

  app.get('/api/files/folders', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req.user as any).sub;
    const rows = db.prepare("SELECT * FROM files WHERE owner_id=? AND kind='folder' AND trashed=0 ORDER BY name COLLATE NOCASE").all(userId) as any[];
    return rows.map(toDriveFile);
  });

  app.get('/api/files', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req.user as any).sub;
    const q = req.query as any;
    const parentId = q.parent || null;
    const trashed = q.trashed === '1';
    const starred = q.starred === '1';
    const recent = q.recent === '1';

    if (trashed) autoCleanTrash(userId);

    const sortMap: Record<string, string> = {
      name: 'f.name COLLATE NOCASE',
      size: 'f.size',
      updatedAt: 'f.updated_at',
      createdAt: 'f.created_at'
    };
    const sortCol = sortMap[q.sort] || 'f.name COLLATE NOCASE';
    const sortDir = q.order === 'desc' ? 'DESC' : 'ASC';
    const baseSelect = `
      SELECT f.*, (SELECT COUNT(*) FROM shares s WHERE s.file_id = f.id) AS share_count
      FROM files f
    `;

    let rows: any[];
    if (trashed) {
      rows = db.prepare(`${baseSelect} WHERE f.owner_id=? AND f.trashed=1 ORDER BY f.kind DESC, ${sortCol} ${sortDir}`).all(userId) as any[];
    } else if (starred) {
      rows = db.prepare(`${baseSelect} WHERE f.owner_id=? AND f.trashed=0 AND f.starred=1 ORDER BY f.kind DESC, ${sortCol} ${sortDir}`).all(userId) as any[];
    } else if (recent) {
      rows = db.prepare(`${baseSelect} WHERE f.owner_id=? AND f.trashed=0 AND f.kind='file' ORDER BY f.updated_at DESC LIMIT 100`).all(userId) as any[];
    } else if (parentId) {
      rows = db.prepare(`${baseSelect} WHERE f.owner_id=? AND f.parent_id=? AND f.trashed=0 ORDER BY f.kind DESC, ${sortCol} ${sortDir}`).all(userId, parentId) as any[];
    } else {
      rows = db.prepare(`${baseSelect} WHERE f.owner_id=? AND f.parent_id IS NULL AND f.trashed=0 ORDER BY f.kind DESC, ${sortCol} ${sortDir}`).all(userId) as any[];
    }
    return {
      items: rows.map(toDriveFile),
      breadcrumbs: breadcrumbs(parentId, userId),
      stats: computeStats(userId)
    };
  });

  app.get('/api/files/search', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req.user as any).sub;
    const q = (req.query as any).q || '';
    if (!q.trim()) return [];
    const rows = db.prepare(`
      SELECT f.*, (SELECT COUNT(*) FROM shares s WHERE s.file_id = f.id) AS share_count
      FROM files f
      WHERE f.owner_id=? AND f.trashed=0 AND f.name LIKE ?
      ORDER BY f.kind DESC, f.name COLLATE NOCASE LIMIT 100
    `).all(userId, `%${q.trim()}%`) as any[];
    return rows.map(toDriveFile);
  });

  app.post('/api/files/check-conflicts', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req.user as any).sub;
    const body = (req.body || {}) as any;
    const baseParentId: string | null = body.parentId || null;
    const paths: string[] = Array.isArray(body.paths) ? body.paths : [];

    const fileConflicts: string[] = [];
    const folderConflicts = new Set<string>();

    const findChild = (pid: string | null, name: string, kind?: 'file' | 'folder') => {
      const clean = cleanName(name);
      if (!clean) return null;
      if (pid) {
        return kind
          ? db.prepare('SELECT * FROM files WHERE owner_id=? AND parent_id=? AND trashed=0 AND kind=? AND LOWER(name)=LOWER(?)').get(userId, pid, kind, clean) as any
          : db.prepare('SELECT * FROM files WHERE owner_id=? AND parent_id=? AND trashed=0 AND LOWER(name)=LOWER(?)').get(userId, pid, clean) as any;
      }
      return kind
        ? db.prepare('SELECT * FROM files WHERE owner_id=? AND parent_id IS NULL AND trashed=0 AND kind=? AND LOWER(name)=LOWER(?)').get(userId, kind, clean) as any
        : db.prepare('SELECT * FROM files WHERE owner_id=? AND parent_id IS NULL AND trashed=0 AND LOWER(name)=LOWER(?)').get(userId, clean) as any;
    };

    for (const rawPath of paths) {
      const parts = String(rawPath || '').replace(/\\/g, '/').split('/').map(s => cleanName(s)).filter(Boolean);
      if (!parts.length) continue;

      let curParent: string | null = baseParentId;
      let folderChainExists = true;

      for (let i = 0; i < parts.length - 1; i++) {
        const folderRow = findChild(curParent, parts[i], 'folder');
        if (!folderRow) {
          folderChainExists = false;
          break;
        }
        if (i === 0) folderConflicts.add(parts[0]);
        curParent = folderRow.id;
      }

      if (folderChainExists) {
        const fileName = parts[parts.length - 1];
        const existingFile = findChild(curParent, fileName, 'file');
        if (existingFile) {
          fileConflicts.push(parts.join('/'));
        }
      }
    }

    return {
      fileConflicts,
      folderConflicts: Array.from(folderConflicts)
    };
  });

  app.post('/api/files/folder', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const body = (req.body || {}) as any;
    const { parentId, reuseExisting } = body;
    let name = cleanName(body?.name);
    if (!name) return reply.code(400).send({ message: 'İsim gerekli' });
    if (parentId) {
      const parent = getOwned(parentId, userId);
      if (!parent || parent.kind !== 'folder') return reply.code(404).send({ message: 'Klasör bulunamadı' });
    }

    if (reuseExisting) {
      const existing = (parentId
        ? db.prepare("SELECT * FROM files WHERE owner_id=? AND parent_id=? AND trashed=0 AND kind='folder' AND LOWER(name)=LOWER(?)").get(userId, parentId, name)
        : db.prepare("SELECT * FROM files WHERE owner_id=? AND parent_id IS NULL AND trashed=0 AND kind='folder' AND LOWER(name)=LOWER(?)").get(userId, name)
      ) as any;
      if (existing) return toDriveFile(existing);
    }

    const rules = getRules();
    if (rules.conflictRule === 'rename' || body?.onConflict === 'rename') {
      name = resolveUniqueName(userId, parentId || null, name);
    }
    const id = uuidv4();
    db.prepare('INSERT INTO files (id, owner_id, parent_id, name, kind, size, mime, storage_path, starred, trashed, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, userId, parentId || null, name, 'folder', 0, 'folder', null, 0, 0, now(), now());
    const row = db.prepare('SELECT * FROM files WHERE id=?').get(id) as any;
    return toDriveFile(row);
  });

  app.post('/api/files/upload', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const data = await (req as any).file();
    if (!data) return reply.code(400).send({ message: 'Dosya yok' });
    const parentId = (data.fields?.parentId?.value) || null;
    if (parentId) {
      const parent = getOwned(parentId as string, userId);
      if (!parent || parent.kind !== 'folder') return reply.code(404).send({ message: 'Klasör bulunamadı' });
    }

    const rules = getRules();
    let filename = cleanName(data.filename) || 'dosya';
    const ext = path.extname(filename).toLowerCase();
    const blocked = rules.blockedExtensions
      .split(',')
      .map((s: string) => s.trim().toLowerCase())
      .filter(Boolean);
    if (ext && blocked.includes(ext)) {
      data.file.resume();
      return reply.code(400).send({ message: `${ext} uzantılı dosyalar güvenlik kuralı gereği engellenmiş` });
    }

    const saved = await saveStream(data.file, userId);
    if (data.file.truncated || saved.size > rules.maxUploadMb * 1024 * 1024) {
      deleteStorage(saved.rel);
      return reply.code(413).send({ message: `Dosya boyutu sınırı (${rules.maxUploadMb} MB) aşıldı` });
    }

    const stats = computeStats(userId);
    if (stats.quotaBytes > 0 && stats.usedBytes + saved.size > stats.quotaBytes) {
      deleteStorage(saved.rel);
      return reply.code(413).send({ message: 'Depolama kotanız doldu' });
    }

    const mime = guessMime(filename, data.mimetype || 'application/octet-stream');

    // Çakışma kuralı kontrolü
    const duplicate = (parentId
      ? db.prepare("SELECT * FROM files WHERE owner_id=? AND parent_id=? AND trashed=0 AND kind='file' AND LOWER(name)=LOWER(?)").get(userId, parentId, filename)
      : db.prepare("SELECT * FROM files WHERE owner_id=? AND parent_id IS NULL AND trashed=0 AND kind='file' AND LOWER(name)=LOWER(?)").get(userId, filename)
    ) as any;

    if (duplicate) {
      if (rules.conflictRule === 'reject') {
        deleteStorage(saved.rel);
        return reply.code(409).send({ message: 'Bu klasörde aynı isimde dosya zaten var' });
      }
      if (rules.conflictRule === 'overwrite') {
        deleteStorage(duplicate.storage_path);
        db.prepare('UPDATE files SET size=?, mime=?, storage_path=?, updated_at=? WHERE id=?')
          .run(saved.size, mime, saved.rel, now(), duplicate.id);
        const updated = db.prepare('SELECT * FROM files WHERE id=?').get(duplicate.id) as any;
        return toDriveFile(updated);
      }
      filename = resolveUniqueName(userId, parentId || null, filename);
    }

    const id = uuidv4();
    db.prepare('INSERT INTO files (id, owner_id, parent_id, name, kind, size, mime, storage_path, starred, trashed, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, userId, parentId || null, filename, 'file', saved.size, mime, saved.rel, 0, 0, now(), now());
    const row = db.prepare('SELECT * FROM files WHERE id=?').get(id) as any;
    return toDriveFile(row);
  });

  // --- PARÇALI YÜKLEME (CHUNKED UPLOAD — Cloudflare 100 MB sınırını aşar, 100 GB'a kadar destekler) ---
  app.post('/api/files/upload/init', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const body = (req.body || {}) as any;
    const parentId = body.parentId || null;
    const size = Number(body.size || 0);
    const filename = cleanName(body.name) || 'dosya';

    if (parentId) {
      const parent = getOwned(parentId, userId);
      if (!parent || parent.kind !== 'folder') return reply.code(404).send({ message: 'Klasör bulunamadı' });
    }

    const rules = getRules();
    const ext = path.extname(filename).toLowerCase();
    const blocked = rules.blockedExtensions
      .split(',')
      .map((s: string) => s.trim().toLowerCase())
      .filter(Boolean);
    if (ext && blocked.includes(ext)) {
      return reply.code(400).send({ message: `${ext} uzantılı dosyalar güvenlik kuralı gereği engellenmiş` });
    }
    if (size > rules.maxUploadMb * 1024 * 1024) {
      return reply.code(413).send({ message: `Dosya boyutu sınırı (${rules.maxUploadMb} MB) aşıldı` });
    }
    const stats = computeStats(userId);
    if (stats.quotaBytes > 0 && stats.usedBytes + size > stats.quotaBytes) {
      return reply.code(413).send({ message: 'Depolama kotanız doldu' });
    }

    const uploadId = initChunkFile(userId);
    // 4 MB parça boyutu: Cloudflare tünelinde kopma/timeout yaşanmasını tamamen önler
    return { uploadId, chunkSize: 4 * 1024 * 1024 };
  });

  app.post('/api/files/upload/chunk', { preHandler: [app.authenticate], config: { rateLimit: false } }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const q = req.query as any;
    const uploadId = String(q.uploadId || '');
    const offset = q.offset !== undefined ? Number(q.offset) : undefined;
    if (!uploadId) return reply.code(400).send({ message: 'uploadId gerekli' });
    const data = await (req as any).file();
    if (!data) return reply.code(400).send({ message: 'Parça verisi yok' });
    try {
      const receivedBytes = await appendChunkStream(data.file, userId, uploadId, offset);
      return { ok: true, receivedBytes };
    } catch (e: any) {
      return reply.code(400).send({ message: e.message || 'Parça yazılamadı' });
    }
  });

  app.post('/api/files/upload/complete', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const body = (req.body || {}) as any;
    const uploadId = String(body.uploadId || '');
    const parentId = body.parentId || null;
    let filename = cleanName(body.name) || 'dosya';
    const rawMime = String(body.mime || 'application/octet-stream');

    if (!uploadId) return reply.code(400).send({ message: 'uploadId gerekli' });

    let saved: { rel: string; size: number };
    try {
      saved = finalizeChunkFile(userId, uploadId);
    } catch (e: any) {
      return reply.code(400).send({ message: e.message || 'Yükleme tamamlanamadı' });
    }

    const rules = getRules();
    const conflictAction = ['overwrite', 'rename', 'reject'].includes(body.onConflict)
      ? body.onConflict
      : rules.conflictRule;
    const mime = guessMime(filename, rawMime);

    const duplicate = (parentId
      ? db.prepare("SELECT * FROM files WHERE owner_id=? AND parent_id=? AND trashed=0 AND kind='file' AND LOWER(name)=LOWER(?)").get(userId, parentId, filename)
      : db.prepare("SELECT * FROM files WHERE owner_id=? AND parent_id IS NULL AND trashed=0 AND kind='file' AND LOWER(name)=LOWER(?)").get(userId, filename)
    ) as any;

    if (duplicate) {
      if (conflictAction === 'reject') {
        deleteStorage(saved.rel);
        return reply.code(409).send({ message: 'Bu klasörde aynı isimde dosya zaten var' });
      }
      if (conflictAction === 'overwrite') {
        deleteStorage(duplicate.storage_path);
        db.prepare('UPDATE files SET size=?, mime=?, storage_path=?, updated_at=? WHERE id=?')
          .run(saved.size, mime, saved.rel, now(), duplicate.id);
        const updated = db.prepare('SELECT * FROM files WHERE id=?').get(duplicate.id) as any;
        return toDriveFile(updated);
      }
      filename = resolveUniqueName(userId, parentId || null, filename);
    }

    const id = uuidv4();
    db.prepare('INSERT INTO files (id, owner_id, parent_id, name, kind, size, mime, storage_path, starred, trashed, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, userId, parentId || null, filename, 'file', saved.size, mime, saved.rel, 0, 0, now(), now());
    const row = db.prepare('SELECT * FROM files WHERE id=?').get(id) as any;
    return toDriveFile(row);
  });

  app.delete('/api/files/upload/:uploadId', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const { uploadId } = req.params as any;
    abortChunkFile(userId, String(uploadId || ''));
    return reply.code(204).send();
  });

  app.patch('/api/files/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const { id } = req.params as any;
    const body = (req.body || {}) as any;
    const row = getOwned(id, userId);
    if (!row) return reply.code(404).send({ message: 'Bulunamadı' });

    const nextName = body.name !== undefined ? cleanName(body.name) : row.name;
    if (!nextName) return reply.code(400).send({ message: 'İsim gerekli' });
    const nextStarred = body.starred !== undefined ? (body.starred ? 1 : 0) : row.starred;

    db.prepare('UPDATE files SET name=?, starred=?, updated_at=? WHERE id=?').run(nextName, nextStarred, now(), id);
    const updated = db.prepare('SELECT * FROM files WHERE id=?').get(id) as any;
    return toDriveFile(updated);
  });

  app.post('/api/files/:id/move', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const { id } = req.params as any;
    const { parentId } = (req.body || {}) as any;
    const row = getOwned(id, userId);
    if (!row) return reply.code(404).send({ message: 'Bulunamadı' });
    if (parentId) {
      const parent = getOwned(parentId, userId);
      if (!parent || parent.kind !== 'folder') return reply.code(404).send({ message: 'Hedef klasör bulunamadı' });
      for (let cur: string | null = parentId; cur; cur = (getOwned(cur, userId) as any)?.parent_id ?? null) {
        if (cur === id) return reply.code(400).send({ message: 'Klasör kendi alt klasörüne taşınamaz' });
      }
    }
    db.prepare('UPDATE files SET parent_id=?, updated_at=? WHERE id=?').run(parentId || null, now(), id);
    const updated = db.prepare('SELECT * FROM files WHERE id=?').get(id) as any;
    return toDriveFile(updated);
  });

  app.post('/api/files/:id/copy', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const { id } = req.params as any;
    const body = (req.body || {}) as any;
    const row = getOwned(id, userId);
    if (!row || row.kind !== 'file') return reply.code(404).send({ message: 'Kopyalanacak dosya bulunamadı' });

    const targetParent = body.parentId !== undefined ? (body.parentId || null) : row.parent_id;
    const copied = copyStorage(row.storage_path, userId);
    if (!copied) return reply.code(404).send({ message: 'Fiziksel dosya bulunamadı' });

    const newName = resolveUniqueName(userId, targetParent, row.name);
    const newId = uuidv4();
    db.prepare('INSERT INTO files (id, owner_id, parent_id, name, kind, size, mime, storage_path, starred, trashed, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(newId, userId, targetParent, newName, 'file', copied.size, row.mime, copied.rel, 0, 0, now(), now());
    const created = db.prepare('SELECT * FROM files WHERE id=?').get(newId) as any;
    return toDriveFile(created);
  });

  app.post('/api/files/bulk', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const { ids, action, parentId } = (req.body || {}) as any;
    if (!Array.isArray(ids) || !ids.length) return reply.code(400).send({ message: 'Dosya seçilmedi' });

    const trashRecursive = (fid: string, val: number) => {
      db.prepare('UPDATE files SET trashed=?, updated_at=? WHERE id=? AND owner_id=?').run(val, now(), fid, userId);
      const children = db.prepare('SELECT id FROM files WHERE parent_id=? AND owner_id=?').all(fid, userId) as any[];
      for (const c of children) trashRecursive(c.id, val);
    };

    for (const rawId of ids) {
      const id = String(rawId);
      const row = getOwned(id, userId);
      if (!row) continue;
      if (action === 'trash') trashRecursive(id, 1);
      else if (action === 'restore') trashRecursive(id, 0);
      else if (action === 'deletePermanent') purgeRecursive(id);
      else if (action === 'star') db.prepare('UPDATE files SET starred=1, updated_at=? WHERE id=?').run(now(), id);
      else if (action === 'unstar') db.prepare('UPDATE files SET starred=0, updated_at=? WHERE id=?').run(now(), id);
      else if (action === 'move') {
        let valid = true;
        if (parentId) {
          for (let cur: string | null = parentId; cur; cur = (getOwned(cur, userId) as any)?.parent_id ?? null) {
            if (cur === id) { valid = false; break; }
          }
        }
        if (valid) db.prepare('UPDATE files SET parent_id=?, updated_at=? WHERE id=?').run(parentId || null, now(), id);
      }
    }
    return { ok: true };
  });

  app.delete('/api/files/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const { id } = req.params as any;
    const row = getOwned(id, userId);
    if (!row) return reply.code(404).send({ message: 'Bulunamadı' });
    const trashRecursive = (fid: string) => {
      db.prepare('UPDATE files SET trashed=1, updated_at=? WHERE id=?').run(now(), fid);
      const children = db.prepare('SELECT id FROM files WHERE parent_id=?').all(fid) as any[];
      for (const c of children) trashRecursive(c.id);
    };
    trashRecursive(id);
    return reply.code(204).send();
  });

  app.post('/api/files/:id/restore', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const { id } = req.params as any;
    const row = getOwned(id, userId);
    if (!row) return reply.code(404).send({ message: 'Bulunamadı' });
    const restoreRecursive = (fid: string) => {
      db.prepare('UPDATE files SET trashed=0, updated_at=? WHERE id=?').run(now(), fid);
      const children = db.prepare('SELECT id FROM files WHERE parent_id=?').all(fid) as any[];
      for (const c of children) restoreRecursive(c.id);
    };
    restoreRecursive(id);
    return reply.code(204).send();
  });

  app.delete('/api/files/:id/permanent', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const { id } = req.params as any;
    const row = getOwned(id, userId);
    if (!row) return reply.code(404).send({ message: 'Bulunamadı' });
    purgeRecursive(id);
    return reply.code(204).send();
  });

  app.post('/api/trash/empty', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req.user as any).sub;
    const rows = db.prepare('SELECT id FROM files WHERE owner_id=? AND trashed=1').all(userId) as any[];
    for (const r of rows) purgeRecursive(r.id);
    return { ok: true };
  });

  app.get('/api/files/:id/download', async (req, reply) => {
    let userId: string | null = null;
    const authHeader = (req.headers.authorization || '').replace('Bearer ', '');
    const q = req.query as any;
    const token = authHeader || q.token;
    if (token) {
      try { const d = app.jwt.verify(token) as any; userId = d.sub; } catch { userId = null; }
    }
    if (!userId) return reply.code(401).send({ message: 'Yetkisiz' });
    const { id } = req.params as any;
    const row = getOwned(id, userId);
    if (!row || row.kind !== 'file' || !row.storage_path) return reply.code(404).send({ message: 'Bulunamadı' });
    return sendFile(req, reply, row, q.inline === '1');
  });

  // --- PAYLAŞIM (SHARES) ROTALARI ---
  app.get('/api/shares', { preHandler: [app.authenticate] }, async (req) => {
    const userId = (req.user as any).sub;
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`;
    const rows = db.prepare(`
      SELECT s.*, f.name AS file_name, f.kind AS file_kind, f.size AS file_size
      FROM shares s
      JOIN files f ON f.id = s.file_id
      WHERE f.owner_id = ?
      ORDER BY s.created_at DESC
    `).all(userId) as any[];
    return rows.map(s => ({
      id: s.id,
      fileId: s.file_id,
      fileName: s.file_name,
      fileKind: s.file_kind,
      fileSize: s.file_size,
      token: s.token,
      url: `${base}/shared/${s.token}`,
      hasPassword: !!s.password_hash,
      expiresAt: s.expires_at,
      createdAt: s.created_at
    }));
  });

  app.post('/api/files/:id/share', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const { id } = req.params as any;
    const row = getOwned(id, userId);
    if (!row) return reply.code(404).send({ message: 'Bulunamadı' });
    const { expiresAt, password } = (req.body || {}) as any;
    if (expiresAt && isNaN(Date.parse(expiresAt))) return reply.code(400).send({ message: 'Geçersiz tarih' });
    const passHash = password && String(password).trim() ? bcrypt.hashSync(String(password).trim(), 10) : null;
    const shareId = uuidv4();
    const token = randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO shares (id, file_id, token, password_hash, expires_at, created_at) VALUES (?,?,?,?,?,?)')
      .run(shareId, id, token, passHash, expiresAt || null, now());
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.headers.host}`;
    return {
      id: shareId,
      fileId: id,
      fileName: row.name,
      fileKind: row.kind,
      fileSize: row.size,
      token,
      url: `${base}/shared/${token}`,
      hasPassword: !!passHash,
      expiresAt: expiresAt || null,
      createdAt: now()
    };
  });

  app.delete('/api/shares/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const userId = (req.user as any).sub;
    const { id } = req.params as any;
    const share = db.prepare(`
      SELECT s.id FROM shares s JOIN files f ON f.id = s.file_id WHERE s.id=? AND f.owner_id=?
    `).get(id, userId);
    if (!share) return reply.code(404).send({ message: 'Paylaşım bulunamadı' });
    db.prepare('DELETE FROM shares WHERE id=?').run(id);
    return reply.code(204).send();
  });

  app.get('/api/shared/:token', async (req, reply) => {
    const { token } = req.params as any;
    const q = req.query as any;
    const share = db.prepare('SELECT * FROM shares WHERE token=?').get(token) as any;
    if (!share) return reply.code(404).send({ message: 'Paylaşım bulunamadı veya iptal edildi' });
    if (share.expires_at && new Date(share.expires_at) < new Date()) return reply.code(410).send({ message: 'Paylaşım süresi doldu' });
    const row = db.prepare('SELECT * FROM files WHERE id=? AND trashed=0').get(share.file_id) as any;
    if (!row) return reply.code(404).send({ message: 'Dosya bulunamadı' });

    if (share.password_hash) {
      const provided = String(q.password || '');
      if (!provided || !bcrypt.compareSync(provided, share.password_hash)) {
        return {
          requiresPassword: true,
          file: { id: row.id, name: row.name, kind: row.kind, size: row.size, mime: row.mime } as any,
          downloadUrl: ''
        };
      }
    }

    const passParam = share.password_hash && q.password ? `?password=${encodeURIComponent(q.password)}` : '';
    const downloadUrl = `/api/shared/${token}/download${passParam}`;
    let items: any[] | undefined;
    if (row.kind === 'folder') {
      const children = db.prepare('SELECT * FROM files WHERE parent_id=? AND trashed=0 ORDER BY kind DESC, name COLLATE NOCASE').all(row.id) as any[];
      items = children.map(toDriveFile);
    }
    return { file: toDriveFile(row), items, downloadUrl, requiresPassword: false };
  });

  app.get('/api/shared/:token/download', async (req, reply) => {
    const { token } = req.params as any;
    const q = req.query as any;
    const share = db.prepare('SELECT * FROM shares WHERE token=?').get(token) as any;
    if (!share) return reply.code(404).send({ message: 'Paylaşım bulunamadı' });
    if (share.expires_at && new Date(share.expires_at) < new Date()) return reply.code(410).send({ message: 'Paylaşım süresi doldu' });

    if (share.password_hash) {
      const provided = String(q.password || '');
      if (!provided || !bcrypt.compareSync(provided, share.password_hash)) {
        return reply.code(401).send({ message: 'Paylaşım şifresi gerekli veya hatalı' });
      }
    }

    let row = db.prepare('SELECT * FROM files WHERE id=? AND trashed=0').get(share.file_id) as any;
    if (!row) return reply.code(404).send({ message: 'Dosya bulunamadı' });

    if (row.kind === 'folder' && q.fileId) {
      const child = db.prepare('SELECT * FROM files WHERE id=? AND parent_id=? AND trashed=0').get(q.fileId, row.id) as any;
      if (!child || child.kind !== 'file' || !child.storage_path) return reply.code(404).send({ message: 'Alt dosya bulunamadı' });
      row = child;
    }

    if (row.kind !== 'file' || !row.storage_path) return reply.code(404).send({ message: 'Bulunamadı' });
    return sendFile(req, reply, row, q.inline === '1');
  });
}
