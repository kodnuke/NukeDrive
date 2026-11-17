import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db, now, getRules } from './db';

export interface UserRow {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  name: string;
  role: 'admin' | 'user';
  quota_bytes: number;
  created_at: string;
}

export function normalizeUsername(raw: string): string {
  const s = String(raw || '').trim().toLowerCase();
  if (s.includes('@')) return s.split('@')[0].replace(/[^a-z0-9._-]/g, '') || s;
  return s.replace(/\s+/g, '');
}

export function createUser(
  identifier: string,
  password: string,
  name: string,
  opts?: { email?: string; role?: 'admin' | 'user'; quotaBytes?: number }
): UserRow {
  const id = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  const isFirst = countUsers() === 0;
  const cleanId = String(identifier || '').trim().toLowerCase();
  const username = cleanId.includes('@') ? normalizeUsername(cleanId) : cleanId;
  const email = opts?.email
    ? String(opts.email).trim().toLowerCase()
    : (cleanId.includes('@') ? cleanId : `${username}@nukedrive.local`);
  const role = opts?.role || (isFirst ? 'admin' : 'user');
  const rules = getRules();
  const defaultQuotaBytes = rules.defaultQuotaMb > 0 ? rules.defaultQuotaMb * 1024 * 1024 : 0;
  const quotaBytes = opts?.quotaBytes !== undefined ? opts.quotaBytes : (role === 'admin' ? 0 : defaultQuotaBytes);

  // Eğer aynı username zaten varsa sonuna kısa ek ekle (e-posta ile kayıtlarda çakışmayı önler)
  let finalUsername = username;
  if (findUserByIdentifier(finalUsername)) {
    finalUsername = `${username}_${id.slice(0, 4)}`;
  }

  db.prepare(
    'INSERT INTO users (id, username, email, password_hash, name, role, quota_bytes, created_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(id, finalUsername, email, hash, name.trim(), role, quotaBytes, now());

  return db.prepare('SELECT * FROM users WHERE id=?').get(id) as any;
}

export function findUserByIdentifier(identifier: string): UserRow | undefined {
  const clean = String(identifier || '').trim().toLowerCase();
  if (!clean) return undefined;
  return db.prepare('SELECT * FROM users WHERE LOWER(username)=? OR LOWER(email)=?').get(clean, clean) as any | undefined;
}

export function findUserByEmail(email: string): UserRow | undefined {
  return findUserByIdentifier(email);
}

export function findUserById(id: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE id=?').get(id) as any | undefined;
}

export function countUsers(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n;
}

export function verifyPassword(user: UserRow, password: string): boolean {
  return bcrypt.compareSync(password, user.password_hash);
}

export function getUserUsedBytes(userId: string): number {
  const row = db.prepare("SELECT COALESCE(SUM(size), 0) AS total FROM files WHERE owner_id=? AND kind='file'").get(userId) as any;
  return Number(row?.total || 0);
}

export function updateUser(
  id: string,
  patch: { username?: string; email?: string; name?: string; password?: string; role?: 'admin' | 'user'; quotaBytes?: number }
): UserRow {
  const current = findUserById(id);
  if (!current) throw new Error('Kullanıcı bulunamadı');

  const nextUsername = patch.username !== undefined ? String(patch.username).trim().toLowerCase() : current.username;
  const nextEmail = patch.email !== undefined
    ? String(patch.email).trim().toLowerCase()
    : (patch.username && !current.email.includes('@') ? `${nextUsername}@nukedrive.local` : current.email);
  const nextName = patch.name !== undefined ? String(patch.name).trim() : current.name;
  const nextHash = patch.password ? bcrypt.hashSync(patch.password, 10) : current.password_hash;
  const nextRole = patch.role !== undefined ? patch.role : current.role;
  const nextQuota = patch.quotaBytes !== undefined ? patch.quotaBytes : current.quota_bytes;

  db.prepare(
    'UPDATE users SET username=?, email=?, name=?, password_hash=?, role=?, quota_bytes=? WHERE id=?'
  ).run(nextUsername, nextEmail, nextName, nextHash, nextRole, nextQuota, id);

  return findUserById(id)!;
}

export function listAllUsers() {
  const rows = db.prepare('SELECT * FROM users ORDER BY created_at ASC').all() as any[];
  return rows.map((u) => toPublicUser(u));
}

export function toPublicUser(u: UserRow) {
  return {
    id: u.id,
    username: u.username || u.email.split('@')[0],
    email: u.email,
    name: u.name,
    role: (u.role || 'admin') as 'admin' | 'user',
    quotaBytes: Number(u.quota_bytes || 0),
    usedBytes: getUserUsedBytes(u.id),
    createdAt: u.created_at
  };
}
