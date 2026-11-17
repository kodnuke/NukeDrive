import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { v4 as uuidv4 } from 'uuid';
import { dataDir } from './db';

const storageRoot = path.join(dataDir, 'storage');
if (!fs.existsSync(storageRoot)) fs.mkdirSync(storageRoot, { recursive: true });

// Büyük dosyaları belleğe almadan doğrudan diske yazar
export async function saveStream(stream: NodeJS.ReadableStream, ownerId: string): Promise<{ rel: string; size: number }> {
  const dir = path.join(storageRoot, ownerId);
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, `${uuidv4()}.bin`);
  await pipeline(stream, fs.createWriteStream(fullPath));
  return { rel: path.relative(storageRoot, fullPath).replace(/\\/g, '/'), size: fs.statSync(fullPath).size };
}

// Parçalı yükleme (Chunked Upload) başlatır
export function initChunkFile(ownerId: string): string {
  const uploadId = uuidv4();
  const dir = path.join(storageRoot, ownerId, 'chunks');
  fs.mkdirSync(dir, { recursive: true });
  const partPath = path.join(dir, `${uploadId}.part`);
  fs.writeFileSync(partPath, '');
  return uploadId;
}

export function getChunkFilePath(ownerId: string, uploadId: string): string {
  const safeId = uploadId.replace(/[^a-zA-Z0-9-]/g, '');
  return path.join(storageRoot, ownerId, 'chunks', `${safeId}.part`);
}

// Gelen parçayı (.part) dosyasının sonuna ekler (offset verilirse tekrar denemede üzerine yazmaz/bozmaz)
export async function appendChunkStream(stream: NodeJS.ReadableStream, ownerId: string, uploadId: string, offset?: number): Promise<number> {
  const partPath = getChunkFilePath(ownerId, uploadId);
  if (!fs.existsSync(partPath)) throw new Error('Yükleme oturumu bulunamadı');
  if (typeof offset === 'number' && Number.isFinite(offset) && offset >= 0) {
    const curSize = fs.statSync(partPath).size;
    if (curSize > offset) {
      fs.truncateSync(partPath, offset);
    }
  }
  await pipeline(stream, fs.createWriteStream(partPath, { flags: 'a' }));
  return fs.statSync(partPath).size;
}

// Parçalı yüklemeyi tamamlar ve kalıcı depolamaya taşır
export function finalizeChunkFile(ownerId: string, uploadId: string): { rel: string; size: number } {
  const partPath = getChunkFilePath(ownerId, uploadId);
  if (!fs.existsSync(partPath)) throw new Error('Yükleme oturumu bulunamadı');
  const dir = path.join(storageRoot, ownerId);
  fs.mkdirSync(dir, { recursive: true });
  const finalPath = path.join(dir, `${uuidv4()}.bin`);
  fs.renameSync(partPath, finalPath);
  return {
    rel: path.relative(storageRoot, finalPath).replace(/\\/g, '/'),
    size: fs.statSync(finalPath).size
  };
}

export function abortChunkFile(ownerId: string, uploadId: string) {
  const partPath = getChunkFilePath(ownerId, uploadId);
  try { if (fs.existsSync(partPath)) fs.unlinkSync(partPath); } catch {}
}

export function copyStorage(relative: string | null, ownerId: string): { rel: string; size: number } | null {
  if (!relative) return null;
  const src = resolveStorage(relative);
  if (!fs.existsSync(src)) return null;
  const dir = path.join(storageRoot, ownerId);
  fs.mkdirSync(dir, { recursive: true });
  const fullPath = path.join(dir, `${uuidv4()}.bin`);
  fs.copyFileSync(src, fullPath);
  return { rel: path.relative(storageRoot, fullPath).replace(/\\/g, '/'), size: fs.statSync(fullPath).size };
}

export function resolveStorage(relative: string): string {
  return path.join(storageRoot, relative);
}

export function deleteStorage(relative: string | null) {
  if (!relative) return;
  const full = resolveStorage(relative);
  try { if (fs.existsSync(full)) fs.unlinkSync(full); } catch {}
}
