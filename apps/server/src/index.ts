import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
import { authRoutes } from './routes/auth';
import { fileRoutes } from './routes/files';
import { getLanUrls, startServerTunnel } from './lib/publish';
import { db, getSetting } from './lib/db';
import { createUser, updateUser, listAllUsers } from './lib/auth';

dotenv.config();

const isProd = process.env.NODE_ENV === 'production';
const JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 32 || JWT_SECRET === 'change-me-in-production') {
  if (isProd) throw new Error('JWT_SECRET en az 32 karakterlik rastgele bir değer olmalı (apps/server/.env).');
  console.warn('UYARI: Zayıf/varsayılan JWT_SECRET kullanılıyor. İnternete açmadan önce değiştirin.');
}

// Cloudflare Tunnel / Nginx arkasında gerçek istemci IP'si için (rate limit buna bakar)
const app = Fastify({ logger: true, trustProxy: process.env.TRUST_PROXY === 'true' });

const maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 102400);

// Bearer token kullanıldığı için cookie/credentials gerekmez
const corsOrigins = (process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.register(cors, { origin: corsOrigins.length ? corsOrigins : true });
app.register(multipart, { limits: { fileSize: Math.max(maxUploadMb, 102400) * 1024 * 1024, files: 1 } });
app.register(jwt, { secret: JWT_SECRET || 'nukedrive-dev-secret-change-me-32chars', sign: { expiresIn: process.env.JWT_EXPIRES || '30d' } });
app.register(rateLimit, { max: 3000, timeWindow: '1 minute' });

app.addHook('onSend', async (_req, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  if (!reply.getHeader('X-Frame-Options')) {
    reply.header('X-Frame-Options', 'DENY');
  }
  reply.header('Referrer-Policy', 'no-referrer');
});

app.decorate('authenticate', async function (req: any, reply: any) {
  try {
    await req.jwtVerify();
  } catch {
    reply.code(401).send({ message: 'Yetkisiz' });
  }
});

// APK dosyasını otomatik bul ve dağıt
const candidateApks = [
  process.env.APK_PATH || '',
  path.resolve(__dirname, '../../../NukeDrive.apk'),
  path.resolve(process.cwd(), '../../NukeDrive.apk'),
  path.resolve(process.cwd(), 'NukeDrive.apk')
].filter(Boolean);
const resolvedApk = candidateApks.find(p => fs.existsSync(p)) || '';
if (resolvedApk) process.env.APK_PATH = resolvedApk;

app.register(authRoutes);
app.register(fileRoutes);

app.get('/NukeDrive.apk', (_req, reply) => {
  const currentApk = process.env.APK_PATH || resolvedApk;
  if (!currentApk || !fs.existsSync(currentApk)) {
    return reply.code(404).send({ message: 'APK dosyası bulunamadı' });
  }
  reply.header('Content-Disposition', 'attachment; filename="NukeDrive.apk"');
  reply.type('application/vnd.android.package-archive');
  return reply.send(fs.createReadStream(currentApk));
});

app.get('/api/health', async () => {
  const currentApk = process.env.APK_PATH || resolvedApk;
  return { ok: true, name: 'NukeDrive', apk: !!currentApk && fs.existsSync(currentApk) };
});

// Derlenmiş web arayüzünü aynı porttan sun (tek port internete açılır)
const candidateWebDists = [
  process.env.WEB_DIST || '',
  path.resolve(__dirname, '../../web/dist'),
  path.resolve(process.cwd(), '../web/dist'),
  path.resolve(process.cwd(), 'apps/web/dist')
].filter(Boolean);
const webDist = candidateWebDists.find(p => fs.existsSync(p)) || path.resolve(__dirname, '../../web/dist');

if (fs.existsSync(webDist)) {
  app.register(fastifyStatic, {
    root: webDist,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    }
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
      return reply.sendFile('index.html');
    }
    reply.code(404).send({ message: 'Bulunamadı' });
  });
}

const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';
// Masaüstü uygulaması bu promise'i bekler ve hatayı kendisi gösterir
export const ready = app.listen({ port, host }).then(() => {
  console.log(`\n========================================`);
  console.log(`NukeDrive Sunucusu Aktif!`);
  console.log(`Yerel Adres : http://localhost:${port}`);
  for (const lan of getLanUrls(port)) {
    console.log(`Ağ Adresi   : ${lan} (Aynı Wi-Fi / Android)`);
  }
  console.log(`========================================\n`);
  // Eğer masaüstü uygulaması dışından başlatıldıysa ve tünel ayarı açıksa tüneli başlat
  if (!process.versions.electron && getSetting('tunnelMode', 'off') !== 'off') {
    startServerTunnel(port).catch(() => {});
  }
});
export { db } from './lib/db'; // masaüstü yedekleme (VACUUM INTO) için
export function getOwnerAccount() {
  const users = listAllUsers();
  return users[0] || null;
}
export function setOwnerAccount(username: string, password?: string, name?: string) {
  const cleanU = String(username || '').trim().toLowerCase();
  if (!cleanU || cleanU.length < 3) throw new Error('Kullanıcı adı en az 3 karakter olmalı');
  if (password && password.length < 6) throw new Error('Şifre en az 6 karakter olmalı');
  const existing = listAllUsers()[0];
  if (!existing) {
    if (!password) throw new Error('İlk hesap için şifre gerekli');
    return createUser(cleanU, password, name || cleanU, { role: 'admin' });
  }
  return updateUser(existing.id, {
    username: cleanU,
    name: name || existing.name || cleanU,
    password: password || undefined,
    role: 'admin'
  });
}
if (require.main === module) ready.catch((err) => { console.error(err); process.exit(1); });
