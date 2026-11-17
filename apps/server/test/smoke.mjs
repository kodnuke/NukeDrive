// Uçtan uca duman testi: geçici veri klasöründe sunucuyu başlatır. Çalıştır: npm test --workspace apps/server
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const port = 4555;
const base = `http://127.0.0.1:${port}`;
const cwd = mkdtempSync(path.join(tmpdir(), 'nd-'));
const entry = process.env.SERVER_ENTRY || path.resolve(import.meta.dirname, '../dist/index.js');
const server = spawn(process.execPath, [entry], {
  cwd,
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', JWT_SECRET: 'x'.repeat(40), ALLOW_REGISTER: 'false', NODE_ENV: 'production' },
  stdio: 'ignore'
});

const j = (r) => r.json();
const post = (p, body, token) => fetch(base + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
  body: JSON.stringify(body)
});
const patch = (p, body, token) => fetch(base + p, {
  method: 'PATCH',
  headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
  body: JSON.stringify(body)
});

try {
  for (let i = 0; i < 50; i++) {
    try { await fetch(base + '/api/health'); break; } catch { await new Promise(r => setTimeout(r, 200)); }
  }

  // 1. Kısa şifre reddedilmeli
  assert.equal((await post('/api/auth/register', { username: 'yasin', password: 'short', name: 'Yasin' })).status, 400);

  // 2. Kullanıcı adı + şifre ile ilk yönetici kaydı
  const reg = await post('/api/auth/register', { username: 'yasin', password: 'password123', name: 'Yasin Admin' });
  assert.equal(reg.status, 200);
  const { token, user } = await j(reg);
  assert.equal(user.username, 'yasin');
  assert.equal(user.role, 'admin');

  // 3. İkinci kayıt dışarıya kapalı olmalı
  assert.equal((await post('/api/auth/register', { username: 'ikinci', password: 'password123', name: 'C' })).status, 403, 'ikinci kayıt kapalı olmalı');

  // 4. Kullanıcı adı ve şifre ile giriş
  assert.equal((await post('/api/auth/login', { identifier: 'yasin', password: 'wrongpass1' })).status, 401);
  const loginRes = await post('/api/auth/login', { identifier: 'yasin', password: 'password123' });
  assert.equal(loginRes.status, 200);
  assert.equal((await fetch(base + '/api/files')).status, 401);

  // 5. Klasör ve döngüsel taşıma koruması
  const folder = await j(await post('/api/files/folder', { name: 'Docs' }, token));
  const sub = await j(await post('/api/files/folder', { name: 'Sub', parentId: folder.id }, token));
  assert.equal((await post(`/api/files/${folder.id}/move`, { parentId: sub.id }, token)).status, 400, 'döngüsel taşıma engellenmeli');

  // 6. Dosya yükleme ve çakışma kuralı (otomatik numaralandırma)
  const fd = new FormData();
  fd.append('parentId', folder.id);
  fd.append('file', new Blob(['merhaba']), 'a/../b.txt');
  const up = await j(await fetch(base + '/api/files/upload', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd }));
  assert.equal(up.parentId, folder.id);
  assert.equal(up.name, 'b.txt', 'yol bileşenleri atılmalı');
  assert.equal(up.size, 7);

  const fd2 = new FormData();
  fd2.append('parentId', folder.id);
  fd2.append('file', new Blob(['merhaba2']), 'b.txt');
  const up2 = await j(await fetch(base + '/api/files/upload', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: fd2 }));
  assert.equal(up2.name, 'b (1).txt', 'aynı isimli dosya otomatik numaralandırılmalı');

  // 6b. Parçalı yükleme (Chunked Upload + offset ile güvenli tekrar deneme) testi
  const initChunk = await j(await post('/api/files/upload/init', { name: 'buyuk.bin', size: 11, mime: 'application/octet-stream', parentId: folder.id }, token));
  assert.ok(initChunk.uploadId);
  const cfd1 = new FormData();
  cfd1.append('chunk', new Blob(['parca1-']), 'chunk-0');
  await fetch(`${base}/api/files/upload/chunk?uploadId=${initChunk.uploadId}&offset=0`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: cfd1 });
  // Hatalı/yarım parça simülasyonu ve aynı offset'ten tekrar deneme
  const cfdBad = new FormData();
  cfdBad.append('chunk', new Blob(['bozuk']), 'chunk-1');
  await fetch(`${base}/api/files/upload/chunk?uploadId=${initChunk.uploadId}&offset=7`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: cfdBad });
  const cfd2 = new FormData();
  cfd2.append('chunk', new Blob(['son4']), 'chunk-1');
  await fetch(`${base}/api/files/upload/chunk?uploadId=${initChunk.uploadId}&offset=7`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: cfd2 });
  const doneChunk = await j(await post('/api/files/upload/complete', { uploadId: initChunk.uploadId, name: 'buyuk.bin', mime: 'application/octet-stream', parentId: folder.id }, token));
  assert.equal(doneChunk.size, 11);
  const dlChunk = await fetch(`${base}/api/files/${doneChunk.id}/download`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(await dlChunk.text(), 'parca1-son4');

  // 7. Yıldızlama ve İndirme (inline + attachment)
  const starred = await j(await patch(`/api/files/${up.id}`, { starred: true }, token));
  assert.equal(starred.starred, true);

  const dl = await fetch(`${base}/api/files/${up.id}/download`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(await dl.text(), 'merhaba');

  // 8. Normal ve Şifreli Paylaşım
  const share = await j(await post(`/api/files/${up.id}/share`, {}, token));
  assert.equal(share.url, `${base}/shared/${share.token}`);
  assert.equal(await (await fetch(`${base}/api/shared/${share.token}/download`)).text(), 'merhaba');

  const lockShare = await j(await post(`/api/files/${up.id}/share`, { password: 'gizli' }, token));
  const lockedInfo = await j(await fetch(`${base}/api/shared/${lockShare.token}`));
  assert.equal(lockedInfo.requiresPassword, true);
  assert.equal((await fetch(`${base}/api/shared/${lockShare.token}/download`)).status, 401);
  assert.equal(await (await fetch(`${base}/api/shared/${lockShare.token}/download?password=gizli`)).text(), 'merhaba');

  // 9. SPA index.html
  const html = await fetch(base + '/drive/xyz');
  assert.equal(html.status, 200, 'SPA index.html servis edilmeli');
  assert.equal(html.headers.get('x-frame-options'), 'DENY');
  console.log('OK: tüm kurallar ve testler başarıyla geçti');
} finally {
  server.kill();
  await new Promise(r => setTimeout(r, 300));
  rmSync(cwd, { recursive: true, force: true });
}
