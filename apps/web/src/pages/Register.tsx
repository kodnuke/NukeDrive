import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth, IS_NATIVE } from '../lib/auth';
import { HardDrive, Eye, EyeOff, AlertCircle } from 'lucide-react';

export default function Register() {
  const { register, serverUrl, setServerUrl } = useAuth();
  const nav = useNavigate();
  const [server, setServer] = useState(serverUrl);
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!username.trim() || !password) {
      setErr('Kullanıcı adı ve şifre zorunludur.');
      return;
    }
    setLoading(true);
    try {
      if (IS_NATIVE || server.trim()) {
        setServerUrl(server);
      }
      await register(username.trim(), password, (name.trim() || username.trim()));
      nav('/');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-blue-600 px-6 py-6 text-white text-center">
          <div className="w-14 h-14 bg-white/15 rounded-2xl flex items-center justify-center mx-auto mb-3 backdrop-blur-sm">
            <HardDrive size={30} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">NukeDrive</h1>
          <p className="text-blue-100 text-sm mt-1">Hesap Oluştur</p>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {err && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-sm flex items-start gap-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          )}

          {IS_NATIVE && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
                Sunucu Adresi
              </label>
              <input
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="https://drive.alanadiniz.com veya http://192.168.1.x:4000"
                value={server}
                onChange={e => setServer(e.target.value)}
                required
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Kullanıcı Adı
            </label>
            <input
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="ör. admin veya yasin"
              autoCapitalize="off"
              autoCorrect="off"
              value={username}
              onChange={e => setUsername(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Görünen Ad (İsteğe Bağlı)
            </label>
            <input
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
              placeholder="Adınız Soyadınız"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Şifre (En az 6 karakter)
            </label>
            <div className="relative">
              <input
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                type={showPass ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            disabled={loading}
            className="w-full bg-blue-600 text-white font-semibold py-2.5 rounded-xl hover:bg-blue-700 transition disabled:opacity-50 shadow-md shadow-blue-600/20"
          >
            {loading ? 'Oluşturuluyor...' : 'Hesabı Oluştur'}
          </button>

          <div className="text-sm text-center pt-2 border-t border-slate-100">
            Zaten hesabınız var mı?{' '}
            <Link to="/login" className="text-blue-600 font-medium hover:underline">
              Giriş yapın
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
