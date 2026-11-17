import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
export type ConflictRule = 'rename' | 'overwrite' | 'reject';
export interface DriveRules {
  allowRegister: boolean;
  maxUploadMb: number;
  trashRetentionDays: number;
  conflictRule: ConflictRule;
  defaultQuotaMb: number;
  blockedExtensions: string;
}

// DATA_DIR: masaüstü uygulaması veriyi %APPDATA% altında tutar
export const dataDir = path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'nukedrive.db');
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  quota_bytes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  parent_id TEXT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('file','folder')),
  size INTEGER NOT NULL DEFAULT 0,
  mime TEXT NOT NULL DEFAULT '',
  storage_path TEXT,
  starred INTEGER NOT NULL DEFAULT 0,
  trashed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES files(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_owner_parent ON files(owner_id, parent_id);
CREATE INDEX IF NOT EXISTS idx_files_trashed ON files(trashed);
`);

// Mevcut veritabanları için güvenli şema göçü (migration)
function hasCol(table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as any[];
  return cols.some((c) => c.name === col);
}

if (!hasCol('users', 'username')) {
  db.exec(`ALTER TABLE users ADD COLUMN username TEXT NOT NULL DEFAULT ''`);
  const rows = db.prepare('SELECT id, email FROM users').all() as any[];
  for (const r of rows) {
    const base = String(r.email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '') || r.id.slice(0, 8);
    db.prepare('UPDATE users SET username=? WHERE id=?').run(base, r.id);
  }
}
if (!hasCol('users', 'role')) {
  db.exec(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  const first = db.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1').get() as any;
  if (first) db.prepare("UPDATE users SET role='admin' WHERE id=?").run(first.id);
}
if (!hasCol('users', 'quota_bytes')) {
  db.exec(`ALTER TABLE users ADD COLUMN quota_bytes INTEGER NOT NULL DEFAULT 0`);
}
if (!hasCol('files', 'starred')) {
  db.exec(`ALTER TABLE files ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`);
}
if (!hasCol('shares', 'password_hash')) {
  db.exec(`ALTER TABLE shares ADD COLUMN password_hash TEXT`);
}

export function now() { return new Date().toISOString(); }

export function getSetting(key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key) as any;
  return row ? String(row.value) : fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value);
}

export function getRules(): DriveRules {
  const envAllowReg = process.env.ALLOW_REGISTER === 'true';
  const envMaxMb = Number(process.env.MAX_UPLOAD_MB || 102400);
  const allowRegRaw = getSetting('allowRegister', '');
  return {
    allowRegister: allowRegRaw !== '' ? allowRegRaw === 'true' : envAllowReg,
    maxUploadMb: Number(getSetting('maxUploadMb', String(envMaxMb))) || envMaxMb,
    trashRetentionDays: Number(getSetting('trashRetentionDays', '30')) || 30,
    conflictRule: (getSetting('conflictRule', 'rename') as ConflictRule) || 'rename',
    defaultQuotaMb: Number(getSetting('defaultQuotaMb', '0')) || 0,
    blockedExtensions: getSetting('blockedExtensions', '')
  };
}

export function saveRules(patch: Partial<DriveRules>): DriveRules {
  const current = getRules();
  const next: DriveRules = { ...current, ...patch };
  setSetting('allowRegister', String(!!next.allowRegister));
  setSetting('maxUploadMb', String(Math.max(1, Math.min(102400, Number(next.maxUploadMb) || 1024))));
  setSetting('trashRetentionDays', String(Math.max(0, Math.min(365, Number(next.trashRetentionDays) ?? 30))));
  setSetting('conflictRule', ['rename', 'overwrite', 'reject'].includes(next.conflictRule) ? next.conflictRule : 'rename');
  setSetting('defaultQuotaMb', String(Math.max(0, Number(next.defaultQuotaMb) || 0)));
  setSetting('blockedExtensions', String(next.blockedExtensions ?? '').trim());
  return getRules();
}
