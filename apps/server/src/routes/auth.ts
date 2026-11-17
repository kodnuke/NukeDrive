import type { FastifyInstance } from 'fastify';
import {
  createUser,
  findUserByIdentifier,
  findUserById,
  verifyPassword,
  toPublicUser,
  countUsers,
  updateUser,
  listAllUsers
} from '../lib/auth';
import { db, getRules, saveRules } from '../lib/db';
import { getPublishStatus, updatePublishConfig } from '../lib/publish';
import fs from 'node:fs';

const USERNAME_RE = /^[a-zA-Z0-9._@-]{3,100}$/;
// Brute-force koruması: IP başına dakikada 15 deneme
const authLimit = { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } };

function requireAdmin(req: any, reply: any) {
  const user = findUserById((req.user as any)?.sub);
  if (!user || user.role !== 'admin') {
    reply.code(403).send({ message: 'Bu işlem için yönetici yetkisi gerekli' });
    return null;
  }
  return user;
}

export async function authRoutes(app: FastifyInstance) {
  const registrationOpen = () => countUsers() === 0 || getRules().allowRegister || process.env.ALLOW_REGISTER === 'true';
  const hasApk = () => {
    const p = process.env.APK_PATH || '';
    return !!p && fs.existsSync(p);
  };
  const getPort = () => Number(process.env.PORT || 4000);

  app.get('/api/auth/config', async () => ({
    registrationOpen: registrationOpen(),
    hasUsers: countUsers() > 0,
    apk: hasApk()
  }));

  app.post('/api/auth/register', authLimit, async (req, reply) => {
    if (!registrationOpen()) return reply.code(403).send({ message: 'Kayıt kapalı (Sadece yönetici yeni kullanıcı ekleyebilir)' });
    const body = (req.body || {}) as any;
    const rawIdentifier = String(body.username || body.email || '').trim();
    const password = body.password;
    const name = String(body.name || rawIdentifier).trim();

    if (!rawIdentifier || typeof password !== 'string' || !name) {
      return reply.code(400).send({ message: 'Kullanıcı adı ve şifre gerekli' });
    }
    if (rawIdentifier.length < 3 || rawIdentifier.length > 100 || !USERNAME_RE.test(rawIdentifier)) {
      return reply.code(400).send({ message: 'Kullanıcı adı 3-100 karakter olmalı (harf, rakam, nokta, tire)' });
    }
    if (password.length < 6 || password.length > 128) {
      return reply.code(400).send({ message: 'Şifre en az 6 karakter olmalı' });
    }
    if (findUserByIdentifier(rawIdentifier)) {
      return reply.code(409).send({ message: 'Bu kullanıcı adı veya e-posta zaten kayıtlı' });
    }
    const user = createUser(rawIdentifier, password, name.slice(0, 100), {
      email: body.email && String(body.email).includes('@') ? body.email : undefined
    });
    const token = app.jwt.sign({ sub: user.id });
    return { token, user: toPublicUser(user) };
  });

  app.post('/api/auth/login', authLimit, async (req, reply) => {
    const body = (req.body || {}) as any;
    const identifier = String(body.identifier || body.username || body.email || '').trim();
    const password = body.password;
    if (!identifier || typeof password !== 'string') {
      return reply.code(400).send({ message: 'Kullanıcı adı ve şifre gerekli' });
    }
    const user = findUserByIdentifier(identifier);
    if (!user || !verifyPassword(user, password)) {
      return reply.code(401).send({ message: 'Kullanıcı adı veya şifre hatalı' });
    }
    const token = app.jwt.sign({ sub: user.id });
    return { token, user: toPublicUser(user) };
  });

  app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = findUserById((req.user as any).sub);
    if (!user) return reply.code(401).send({ message: 'Kullanıcı bulunamadı' });
    return toPublicUser(user);
  });

  app.patch('/api/auth/profile', { preHandler: [app.authenticate] }, async (req, reply) => {
    const user = findUserById((req.user as any).sub);
    if (!user) return reply.code(401).send({ message: 'Kullanıcı bulunamadı' });
    const body = (req.body || {}) as any;

    if (body.newPassword) {
      if (typeof body.newPassword !== 'string' || body.newPassword.length < 6) {
        return reply.code(400).send({ message: 'Yeni şifre en az 6 karakter olmalı' });
      }
      if (body.currentPassword && !verifyPassword(user, body.currentPassword)) {
        return reply.code(400).send({ message: 'Mevcut şifre hatalı' });
      }
    }

    if (body.username && body.username.trim().toLowerCase() !== user.username) {
      const cleanU = String(body.username).trim().toLowerCase();
      if (cleanU.length < 3 || !USERNAME_RE.test(cleanU)) {
        return reply.code(400).send({ message: 'Geçersiz kullanıcı adı (en az 3 karakter)' });
      }
      const existing = findUserByIdentifier(cleanU);
      if (existing && existing.id !== user.id) {
        return reply.code(409).send({ message: 'Bu kullanıcı adı zaten kullanılıyor' });
      }
    }

    const updated = updateUser(user.id, {
      username: body.username ? String(body.username).trim().toLowerCase() : undefined,
      email: body.email ? String(body.email).trim().toLowerCase() : undefined,
      name: body.name ? String(body.name).trim().slice(0, 100) : undefined,
      password: body.newPassword || undefined
    });
    return toPublicUser(updated);
  });

  // --- YÖNETİCİ (ADMIN) ROTALARI ---
  app.get('/api/admin/users', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return listAllUsers();
  });

  app.post('/api/admin/users', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const body = (req.body || {}) as any;
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const name = String(body.name || username).trim();
    const role = body.role === 'admin' ? 'admin' : 'user';
    const quotaBytes = Number(body.quotaMb || 0) > 0 ? Number(body.quotaMb) * 1024 * 1024 : 0;

    if (!username || username.length < 3 || !USERNAME_RE.test(username)) {
      return reply.code(400).send({ message: 'Geçerli bir kullanıcı adı girin (en az 3 karakter)' });
    }
    if (password.length < 6) {
      return reply.code(400).send({ message: 'Şifre en az 6 karakter olmalı' });
    }
    if (findUserByIdentifier(username)) {
      return reply.code(409).send({ message: 'Bu kullanıcı adı zaten mevcut' });
    }
    const created = createUser(username, password, name, { role, quotaBytes });
    return toPublicUser(created);
  });

  app.patch('/api/admin/users/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    const { id } = req.params as any;
    const target = findUserById(id);
    if (!target) return reply.code(404).send({ message: 'Kullanıcı bulunamadı' });
    const body = (req.body || {}) as any;

    if (body.username) {
      const cleanU = String(body.username).trim().toLowerCase();
      const existing = findUserByIdentifier(cleanU);
      if (existing && existing.id !== id) {
        return reply.code(409).send({ message: 'Bu kullanıcı adı zaten kullanılıyor' });
      }
    }
    if (body.password && String(body.password).length < 6) {
      return reply.code(400).send({ message: 'Şifre en az 6 karakter olmalı' });
    }

    const updated = updateUser(id, {
      username: body.username ? String(body.username).trim().toLowerCase() : undefined,
      name: body.name ? String(body.name).trim() : undefined,
      password: body.password || undefined,
      role: body.role === 'admin' || body.role === 'user' ? body.role : undefined,
      quotaBytes: body.quotaMb !== undefined ? Math.max(0, Number(body.quotaMb) * 1024 * 1024) : undefined
    });
    return toPublicUser(updated);
  });

  app.delete('/api/admin/users/:id', { preHandler: [app.authenticate] }, async (req, reply) => {
    const admin = requireAdmin(req, reply);
    if (!admin) return;
    const { id } = req.params as any;
    if (id === admin.id) return reply.code(400).send({ message: 'Kendi yönetici hesabınızı silemezsiniz' });
    db.prepare('DELETE FROM users WHERE id=?').run(id);
    return reply.code(204).send();
  });

  app.get('/api/admin/rules', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return getRules();
  });

  app.put('/api/admin/rules', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return saveRules((req.body || {}) as any);
  });

  app.get('/api/admin/publish', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    return getPublishStatus(getPort(), hasApk());
  });

  app.post('/api/admin/publish', { preHandler: [app.authenticate] }, async (req, reply) => {
    if (!requireAdmin(req, reply)) return;
    try {
      return await updatePublishConfig(getPort(), hasApk(), (req.body || {}) as any);
    } catch (e: any) {
      return reply.code(400).send({ message: e.message || 'Tünel ayarlanamadı' });
    }
  });
}
