import type {
  AuthTokens, DriveFile, DriveRules, ListResponse, PublishStatus, ShareLink, StorageStats, User
} from './types';

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null;
  setToken?: (token: string | null) => void;
}

export interface ListFilterOptions {
  starred?: boolean;
  recent?: boolean;
  sort?: 'name' | 'size' | 'updatedAt' | 'createdAt';
  order?: 'asc' | 'desc';
}

export class ApiClient {
  baseUrl: string;
  getToken: () => string | null;
  setToken: (token: string | null) => void;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.getToken = opts.getToken ?? (() => null);
    this.setToken = opts.setToken ?? (() => {});
  }

  private async request(path: string, init: RequestInit = {}): Promise<any> {
    const headers = new Headers(init.headers);
    const token = this.getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    const res = await fetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.message || msg; } catch {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return res;
  }

  // Auth
  async register(usernameOrEmail: string, password: string, name: string, email?: string): Promise<AuthTokens> {
    const r = await this.request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: usernameOrEmail, email: email || usernameOrEmail, password, name })
    });
    this.setToken(r.token);
    return r;
  }
  async login(identifier: string, password: string): Promise<AuthTokens> {
    const r = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, email: identifier, username: identifier, password })
    });
    this.setToken(r.token);
    return r;
  }
  logout() { this.setToken(null); }
  async me(): Promise<User> { return this.request('/api/auth/me'); }
  async authConfig(): Promise<{ registrationOpen: boolean; hasUsers: boolean; apk: boolean }> {
    return this.request('/api/auth/config');
  }
  async updateProfile(data: { username?: string; email?: string; name?: string; currentPassword?: string; newPassword?: string }): Promise<User> {
    return this.request('/api/auth/profile', { method: 'PATCH', body: JSON.stringify(data) });
  }

  // Admin: Users, Rules & External Publishing
  async listUsers(): Promise<User[]> { return this.request('/api/admin/users'); }
  async adminCreateUser(data: { username: string; password: string; name: string; role?: 'admin' | 'user'; quotaMb?: number }): Promise<User> {
    return this.request('/api/admin/users', { method: 'POST', body: JSON.stringify(data) });
  }
  async adminUpdateUser(id: string, data: { username?: string; name?: string; password?: string; role?: 'admin' | 'user'; quotaMb?: number }): Promise<User> {
    return this.request(`/api/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }
  async adminDeleteUser(id: string): Promise<void> {
    await this.request(`/api/admin/users/${id}`, { method: 'DELETE' });
  }
  async getRules(): Promise<DriveRules> { return this.request('/api/admin/rules'); }
  async updateRules(rules: Partial<DriveRules>): Promise<DriveRules> {
    return this.request('/api/admin/rules', { method: 'PUT', body: JSON.stringify(rules) });
  }
  async getPublishStatus(): Promise<PublishStatus> { return this.request('/api/admin/publish'); }
  async updatePublish(data: { mode: 'off' | 'quick' | 'token'; token?: string; publicUrl?: string }): Promise<PublishStatus> {
    return this.request('/api/admin/publish', { method: 'POST', body: JSON.stringify(data) });
  }

  // Files
  async list(parentId: string | null = null, trashed = false, opts?: ListFilterOptions): Promise<ListResponse> {
    const q = new URLSearchParams();
    if (parentId) q.set('parent', parentId);
    if (trashed) q.set('trashed', '1');
    if (opts?.starred) q.set('starred', '1');
    if (opts?.recent) q.set('recent', '1');
    if (opts?.sort) q.set('sort', opts.sort);
    if (opts?.order) q.set('order', opts.order);
    return this.request(`/api/files?${q.toString()}`);
  }
  async listFolders(): Promise<DriveFile[]> {
    return this.request('/api/files/folders');
  }
  async stats(): Promise<StorageStats> {
    return this.request('/api/files/stats');
  }
  async createFolder(
    name: string,
    parentId: string | null = null,
    opts?: { reuseExisting?: boolean; onConflict?: 'rename' | 'reuse' }
  ): Promise<DriveFile> {
    return this.request('/api/files/folder', {
      method: 'POST',
      body: JSON.stringify({ name, parentId, ...opts })
    });
  }
  async checkConflicts(parentId: string | null, paths: string[]): Promise<{ fileConflicts: string[]; folderConflicts: string[] }> {
    return this.request('/api/files/check-conflicts', {
      method: 'POST',
      body: JSON.stringify({ parentId, paths })
    });
  }
  async rename(id: string, name: string): Promise<DriveFile> {
    return this.request(`/api/files/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
  }
  async toggleStar(id: string, starred: boolean): Promise<DriveFile> {
    return this.request(`/api/files/${id}`, { method: 'PATCH', body: JSON.stringify({ starred }) });
  }
  async move(id: string, parentId: string | null): Promise<DriveFile> {
    return this.request(`/api/files/${id}/move`, { method: 'POST', body: JSON.stringify({ parentId }) });
  }
  async copy(id: string, parentId: string | null = null): Promise<DriveFile> {
    return this.request(`/api/files/${id}/copy`, { method: 'POST', body: JSON.stringify({ parentId }) });
  }
  async bulkAction(ids: string[], action: 'trash' | 'restore' | 'deletePermanent' | 'move' | 'star' | 'unstar', parentId?: string | null): Promise<{ ok: boolean }> {
    return this.request('/api/files/bulk', { method: 'POST', body: JSON.stringify({ ids, action, parentId }) });
  }
  async trash(id: string): Promise<void> {
    await this.request(`/api/files/${id}`, { method: 'DELETE' });
  }
  async restore(id: string): Promise<void> {
    await this.request(`/api/files/${id}/restore`, { method: 'POST' });
  }
  async deletePermanent(id: string): Promise<void> {
    await this.request(`/api/files/${id}/permanent`, { method: 'DELETE' });
  }
  async emptyTrash(): Promise<void> {
    await this.request('/api/trash/empty', { method: 'POST' });
  }
  upload(
    file: File | Blob,
    name: string,
    parentId: string | null = null,
    onProgress?: (
      p: number,
      details?: { loadedBytes: number; totalBytes: number; chunkIndex: number; totalChunks: number; speedBps: number }
    ) => void,
    signal?: AbortSignal,
    onConflict?: 'overwrite' | 'rename' | 'reject'
  ): Promise<DriveFile> {
    const totalBytes = file.size || 0;
    const startTime = Date.now();

    const report = (loaded: number, chunkIndex: number, totalChunks: number) => {
      if (!onProgress) return;
      const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
      const speedBps = Math.round(loaded / elapsedSec);
      const ratio = totalBytes > 0 ? Math.min(1, loaded / totalBytes) : 1;
      onProgress(ratio, { loadedBytes: loaded, totalBytes, chunkIndex, totalChunks, speedBps });
    };

    // Tüm dosyalar 4 MB'lık parçalar halinde (Chunked Upload) yüklenir
    return (async () => {
      const mime = (file as File).type || 'application/octet-stream';
      const initRes = await this.request('/api/files/upload/init', {
        method: 'POST',
        body: JSON.stringify({ name, size: totalBytes, mime, parentId })
      });
      const uploadId: string = initRes.uploadId;
      const chunkSize: number = initRes.chunkSize || 4 * 1024 * 1024;
      const totalChunks = Math.max(1, Math.ceil(totalBytes / chunkSize));

      try {
        for (let i = 0; i < totalChunks; i++) {
          if (signal?.aborted) throw new Error('Yükleme iptal edildi');
          const start = i * chunkSize;
          const end = Math.min(totalBytes, start + chunkSize);
          const slice = file.slice(start, end);

          // Ağ dalgalanmalarına karşı her parça için 3 deneme hakkı
          let attempt = 0;
          while (true) {
            try {
              await new Promise<void>((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                const fd = new FormData();
                fd.append('chunk', slice, `chunk-${i}`);
                xhr.open('POST', `${this.baseUrl}/api/files/upload/chunk?uploadId=${encodeURIComponent(uploadId)}&offset=${start}`);
                const token = this.getToken();
                if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
                if (signal) {
                  signal.addEventListener('abort', () => {
                    xhr.abort();
                    reject(new Error('Yükleme iptal edildi'));
                  }, { once: true });
                }
                xhr.upload.onprogress = (e) => {
                  if (e.lengthComputable) report(start + e.loaded, i + 1, totalChunks);
                };
                xhr.onload = () => {
                  if (xhr.status >= 200 && xhr.status < 300) resolve();
                  else {
                    let msg = xhr.statusText;
                    try { msg = JSON.parse(xhr.responseText).message || msg; } catch {}
                    reject(new Error(msg || 'Parça yüklenemedi'));
                  }
                };
                xhr.onerror = () => reject(new Error('Ağ bağlantısı kesildi'));
                xhr.send(fd);
              });
              break;
            } catch (err: any) {
              attempt++;
              if (signal?.aborted || attempt >= 3) throw err;
              await new Promise(r => setTimeout(r, 1000 * attempt));
            }
          }
        }

        report(totalBytes, totalChunks, totalChunks);
        return await this.request('/api/files/upload/complete', {
          method: 'POST',
          body: JSON.stringify({ uploadId, name, mime, parentId, onConflict })
        });
      } catch (err) {
        await this.request(`/api/files/upload/${encodeURIComponent(uploadId)}`, { method: 'DELETE' }).catch(() => {});
        throw err;
      }
    })();
  }
  downloadUrl(id: string, inline = false): string {
    const token = this.getToken();
    const q = new URLSearchParams();
    if (token) q.set('token', token);
    if (inline) q.set('inline', '1');
    const qs = q.toString();
    return `${this.baseUrl}/api/files/${id}/download${qs ? `?${qs}` : ''}`;
  }
  async fetchTextPreview(id: string): Promise<string> {
    const res = await fetch(this.downloadUrl(id, true));
    if (!res.ok) throw new Error('Dosya okunamadı');
    const text = await res.text();
    return text.slice(0, 200_000);
  }
  async search(q: string): Promise<DriveFile[]> {
    return this.request(`/api/files/search?q=${encodeURIComponent(q)}`);
  }

  // Shares
  async listShares(): Promise<ShareLink[]> {
    return this.request('/api/shares');
  }
  async createShare(id: string, expiresAtOrOpts?: string | { expiresAt?: string | null; password?: string }): Promise<ShareLink> {
    const body = typeof expiresAtOrOpts === 'string'
      ? { expiresAt: expiresAtOrOpts }
      : (expiresAtOrOpts || {});
    return this.request(`/api/files/${id}/share`, { method: 'POST', body: JSON.stringify(body) });
  }
  async deleteShare(shareId: string): Promise<void> {
    await this.request(`/api/shares/${shareId}`, { method: 'DELETE' });
  }
  async getShared(token: string, password?: string): Promise<{ file: DriveFile; items?: DriveFile[]; downloadUrl: string; requiresPassword?: boolean }> {
    const q = password ? `?password=${encodeURIComponent(password)}` : '';
    return this.request(`/api/shared/${token}${q}`);
  }
  sharedDownloadUrl(token: string, opts?: { password?: string; inline?: boolean; fileId?: string }): string {
    const q = new URLSearchParams();
    if (opts?.password) q.set('password', opts.password);
    if (opts?.inline) q.set('inline', '1');
    if (opts?.fileId) q.set('fileId', opts.fileId);
    const qs = q.toString();
    return `${this.baseUrl}/api/shared/${token}/download${qs ? `?${qs}` : ''}`;
  }
}

export function createApiClient(opts: ApiClientOptions) { return new ApiClient(opts); }
