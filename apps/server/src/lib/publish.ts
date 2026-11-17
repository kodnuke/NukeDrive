import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn, ChildProcess } from 'node:child_process';
import { dataDir, getSetting, setSetting } from './db';
export interface PublishStatus {
  mode: 'off' | 'quick' | 'token';
  status: 'off' | 'downloading' | 'starting' | 'connected' | 'error';
  url: string;
  publicUrl: string;
  hasToken: boolean;
  localUrl: string;
  lanUrls: string[];
  apkAvailable: boolean;
  apkUrl: string | null;
  log: string[];
}

const CLOUDFLARED_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
const binPath = path.join(dataDir, 'bin', process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');

let tunnelProc: ChildProcess | null = null;
const tunnelState: {
  status: PublishStatus['status'];
  url: string;
  log: string[];
} = {
  status: 'off',
  url: '',
  log: []
};

function tlog(line: string) {
  tunnelState.log.push(line);
  if (tunnelState.log.length > 200) tunnelState.log.shift();
}

export function getLanUrls(port: number): string[] {
  const urls: string[] = [];
  const nets = os.networkInterfaces();
  for (const list of Object.values(nets)) {
    for (const iface of list || []) {
      if (iface && iface.family === 'IPv4' && !iface.internal) {
        urls.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return urls;
}

async function ensureCloudflared(): Promise<string> {
  if (fs.existsSync(binPath)) return binPath;
  const appDataBin = process.env.APPDATA ? path.join(process.env.APPDATA, 'NukeDrive', 'bin', 'cloudflared.exe') : '';
  if (appDataBin && fs.existsSync(appDataBin)) return appDataBin;

  tunnelState.status = 'downloading';
  tlog('cloudflared indiriliyor (Cloudflare resmi GitHub sürümü)...');
  const res = await fetch(CLOUDFLARED_URL);
  if (!res.ok) throw new Error(`cloudflared indirilemedi: HTTP ${res.status}`);
  fs.mkdirSync(path.dirname(binPath), { recursive: true });
  fs.writeFileSync(binPath + '.part', Buffer.from(await res.arrayBuffer()));
  fs.renameSync(binPath + '.part', binPath);
  tlog('cloudflared indirildi.');
  return binPath;
}

export function stopServerTunnel() {
  const p = tunnelProc;
  tunnelProc = null;
  if (p) {
    try { p.kill(); } catch {}
  }
}

export async function startServerTunnel(port: number): Promise<void> {
  stopServerTunnel();
  const mode = (getSetting('tunnelMode', 'off') as PublishStatus['mode']) || 'off';
  const publicUrl = getSetting('tunnelPublicUrl', '');
  const token = getSetting('tunnelToken', '');

  if (mode === 'off') {
    tunnelState.status = 'off';
    tunnelState.url = '';
    delete process.env.PUBLIC_URL;
    return;
  }

  try {
    const exe = await ensureCloudflared();
    const localUrl = `http://127.0.0.1:${port}`;
    const env: NodeJS.ProcessEnv = { ...process.env };
    const args = ['tunnel', '--no-autoupdate'];
    if (mode === 'quick') {
      args.push('--url', localUrl);
      tunnelState.status = 'starting';
      tunnelState.url = '';
    } else {
      args.push('run');
      env.TUNNEL_TOKEN = token;
      tunnelState.status = 'starting';
      tunnelState.url = publicUrl;
      if (publicUrl) process.env.PUBLIC_URL = publicUrl;
    }

    const p = spawn(exe, args, { env, windowsHide: true });
    tunnelProc = p;

    const onData = (d: Buffer) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        tlog(line);
        const m = mode === 'quick' && line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
        if (m) {
          tunnelState.url = m[0];
          process.env.PUBLIC_URL = m[0];
          tunnelState.status = 'connected';
        }
        if (/Registered tunnel connection/i.test(line)) {
          tunnelState.status = 'connected';
        }
      }
    };

    p.stdout?.on('data', onData);
    p.stderr?.on('data', onData);
    p.on('error', (e) => {
      tlog(e.message);
      if (tunnelProc === p) tunnelState.status = 'error';
    });
    p.on('exit', (code) => {
      if (tunnelProc !== p) return;
      tunnelProc = null;
      tlog(`cloudflared kapandı (kod ${code}).`);
      tunnelState.status = 'error';
    });
  } catch (e: any) {
    tlog(e?.message || String(e));
    tunnelState.status = 'error';
  }
}

export function getPublishStatus(port: number, apkAvailable: boolean): PublishStatus {
  const mode = (getSetting('tunnelMode', 'off') as PublishStatus['mode']) || 'off';
  const publicUrl = getSetting('tunnelPublicUrl', '');
  const hasToken = !!getSetting('tunnelToken', '');
  const localUrl = `http://127.0.0.1:${port}`;
  const lanUrls = getLanUrls(port);
  // Eğer masaüstü uygulaması kendi tünelini çalıştırıyorsa PUBLIC_URL ortam değişkeninden de okunur
  const activeUrl = tunnelState.url || process.env.PUBLIC_URL || '';
  const activeStatus = tunnelState.status !== 'off'
    ? tunnelState.status
    : (activeUrl ? 'connected' : 'off');
  const baseForApk = activeUrl || lanUrls[0] || localUrl;

  return {
    mode,
    status: activeStatus,
    url: activeUrl,
    publicUrl,
    hasToken,
    localUrl,
    lanUrls,
    apkAvailable,
    apkUrl: apkAvailable ? `${baseForApk}/NukeDrive.apk` : null,
    log: tunnelState.log.slice(-40)
  };
}

export async function updatePublishConfig(
  port: number,
  apkAvailable: boolean,
  input: { mode: 'off' | 'quick' | 'token'; token?: string; publicUrl?: string }
): Promise<PublishStatus> {
  const mode = ['off', 'quick', 'token'].includes(input.mode) ? input.mode : 'off';
  let publicUrl = String(input.publicUrl || getSetting('tunnelPublicUrl', '')).trim().replace(/\/+$/, '');
  if (publicUrl && !/^https?:\/\//i.test(publicUrl)) publicUrl = 'https://' + publicUrl;
  const token = String(input.token || '').trim();
  const existingToken = getSetting('tunnelToken', '');

  if (mode === 'token' && !token && !existingToken) {
    throw new Error('Kalıcı tünel için Cloudflare Tunnel token gerekli.');
  }
  if (mode === 'token' && !publicUrl) {
    throw new Error('Kalıcı tünel için genel adres gerekli (ör. https://drive.alanadiniz.com).');
  }

  setSetting('tunnelMode', mode);
  setSetting('tunnelPublicUrl', publicUrl);
  if (token) setSetting('tunnelToken', token);

  if (mode === 'off') {
    stopServerTunnel();
    tunnelState.status = 'off';
    tunnelState.url = '';
    delete process.env.PUBLIC_URL;
  } else {
    tunnelState.status = fs.existsSync(binPath) ? 'starting' : 'downloading';
    tunnelState.url = mode === 'token' ? publicUrl : '';
    // İndirme ve tünel başlatmayı arka planda çalıştır, arayüzü bekletme
    startServerTunnel(port).catch(() => {});
  }
  return getPublishStatus(port, apkAvailable);
}
