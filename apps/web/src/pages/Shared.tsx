import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Download, File as FileIcon, Folder, Lock, HardDrive, Eye } from 'lucide-react';
import type { DriveFile } from '@nukedrive/shared';

export default function Shared() {
  const { token } = useParams();
  const { api } = useAuth();
  const [info, setInfo] = useState<{ file: DriveFile; items?: DriveFile[]; downloadUrl: string; requiresPassword?: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const [submittedPass, setSubmittedPass] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  const loadShare = async (pass?: string) => {
    if (!token) return;
    setLoading(true);
    setErr('');
    try {
      const res = await api.getShared(token, pass);
      setInfo(res);
    } catch (e: any) {
      setErr(e.message || 'Paylaşım yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadShare();
  }, [token]);

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittedPass(password);
    loadShare(password);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500">
        Paylaşım yükleniyor...
      </div>
    );
  }

  if (err) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full text-center space-y-3">
          <div className="text-red-600 font-semibold text-lg">Paylaşıma Erişilemedi</div>
          <div className="text-slate-600 text-sm">{err}</div>
        </div>
      </div>
    );
  }

  if (!info) return null;

  if (info.requiresPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <form onSubmit={handlePasswordSubmit} className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-sm space-y-4 text-center">
          <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
            <Lock size={24} />
          </div>
          <h2 className="text-lg font-bold text-slate-800">Şifre Korumalı Paylaşım</h2>
          <p className="text-xs text-slate-500">
            <b>{info.file?.name}</b> dosyasını görüntülemek veya indirmek için paylaşım şifresini girin.
          </p>
          {submittedPass && <div className="text-xs text-red-600 font-medium">Şifre hatalı, tekrar deneyin.</div>}
          <input
            type="password"
            className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Paylaşım şifresi..."
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
            required
          />
          <button className="w-full bg-blue-600 text-white py-2.5 rounded-xl font-semibold hover:bg-blue-700 text-sm">
            Kilidi Aç
          </button>
        </form>
      </div>
    );
  }

  const file = info.file;
  const isImage = file.mime?.startsWith('image/') || /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i.test(file.name);
  const isVideo = file.mime?.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name);
  const isAudio = file.mime?.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/i.test(file.name);
  const inlineUrl = token ? api.sharedDownloadUrl(token, { password: submittedPass || undefined, inline: true }) : '';
  const downloadUrl = token ? api.sharedDownloadUrl(token, { password: submittedPass || undefined }) : '';

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-100 p-4">
      <div className="bg-white p-6 sm:p-8 rounded-2xl shadow-xl w-full max-w-xl space-y-5">
        <div className="flex items-center justify-between border-b pb-4">
          <div className="flex items-center gap-2 text-blue-600 font-bold">
            <HardDrive size={20} /> NukeDrive Paylaşım
          </div>
          <span className="text-xs bg-slate-100 text-slate-600 px-2.5 py-1 rounded-full">
            {file.kind === 'folder' ? 'Klasör' : formatSize(file.size)}
          </span>
        </div>

        <div className="text-center space-y-3">
          {file.kind === 'folder' ? (
            <Folder size={52} className="mx-auto text-amber-500" />
          ) : (
            <FileIcon size={52} className="mx-auto text-blue-500" />
          )}
          <div className="font-semibold text-lg text-slate-800 break-all">{file.name}</div>
        </div>

        {file.kind === 'file' && isImage && (
          <div className="bg-slate-900 rounded-xl overflow-hidden flex justify-center max-h-96">
            <img src={inlineUrl} alt={file.name} className="max-h-96 object-contain" />
          </div>
        )}

        {file.kind === 'file' && isVideo && (
          <div className="bg-black rounded-xl overflow-hidden">
            <video src={inlineUrl} controls className="w-full max-h-96" />
          </div>
        )}

        {file.kind === 'file' && isAudio && (
          <div className="bg-slate-50 p-4 rounded-xl">
            <audio src={inlineUrl} controls className="w-full" />
          </div>
        )}

        {file.kind === 'folder' && info.items && (
          <div className="border rounded-xl divide-y max-h-80 overflow-auto">
            {info.items.length === 0 && (
              <div className="p-6 text-center text-sm text-slate-400">Bu klasör boş</div>
            )}
            {info.items.map(child => (
              <div key={child.id} className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-slate-50">
                <div className="flex items-center gap-2.5 truncate">
                  {child.kind === 'folder' ? <Folder size={18} className="text-amber-500 shrink-0" /> : <FileIcon size={18} className="text-slate-400 shrink-0" />}
                  <span className="truncate">{child.name}</span>
                </div>
                {child.kind === 'file' && token && (
                  <a
                    href={api.sharedDownloadUrl(token, { password: submittedPass || undefined, fileId: child.id })}
                    className="text-blue-600 hover:underline text-xs font-medium shrink-0 ml-2 inline-flex items-center gap-1"
                  >
                    <Download size={14} /> İndir ({formatSize(child.size)})
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {file.kind === 'file' && (
          <div className="flex justify-center gap-3 pt-2">
            <a
              href={inlineUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 border border-slate-300 text-slate-700 px-4 py-2.5 rounded-xl hover:bg-slate-50 text-sm font-medium"
            >
              <Eye size={16} /> Tarayıcıda Aç
            </a>
            <a
              href={downloadUrl}
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2.5 rounded-xl hover:bg-blue-700 text-sm font-semibold shadow-md shadow-blue-600/20"
            >
              <Download size={16} /> Dosyayı İndir
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
