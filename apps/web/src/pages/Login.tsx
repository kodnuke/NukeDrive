import React, { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth, IS_NATIVE } from '../lib/auth';
import { HardDrive, Eye, EyeOff, Smartphone, Globe, ShieldCheck, CheckCircle2, AlertCircle } from 'lucide-react';

export default function Login() {
  const { login, api, serverUrl, setServerUrl } = useAuth();
  const nav = useNavigate();
  const [server, setServer] = useState(serverUrl);
  const [showServerInput, setShowServerInput] = useState(IS_NATIVE);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [err, setErr] = useState('');
  const [pingMsg, setPingMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<{ registrationOpen: boolean; hasUsers: boolean; apk: boolean }>({
    registrationOpen: false,
    hasUsers: true,
    apk: false
  });

  const checkServerConfig = async (base: string) => {
    try {
      const cleanBase = base.trim().replace(/\/+$/, '');
      const url = cleanBase ? `${cleanBase}/api/auth/config` : '/api/auth/config';
      const r = await fetch(url);
      if (r.ok) {
        const j = await r.json();
        setConfig({
          registrationOpen: !!j.registrationOpen,
          hasUsers: j.hasUsers !== false,
          apk: !!j.apk
        });
        return true;
      }
    } catch {}
    return false;
  };

  useEffect(() => {
    checkServerConfig(serverUrl);
  }, [serverUrl]);

  const testConnection = async () => {
    setPingMsg(null);
    setErr('');
    if (!server.trim() && IS_NATIVE) {
      setPingMsg({ ok: false, text: 'Lütfen sunucu adresini girin.' });
      return;
    }
    setServerUrl(server);
    let s = server.trim().replace(/\/+$/, '');
    if (s && !/^https?:\/\//i.test(s)) {
      const isLocal = /^(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(s);
      s = (isLocal ? 'http://' : 'https://') + s;
      setServer(s);
    }
    const ok = await checkServerConfig(s);
    if (ok) setPingMsg({ ok: true, text: 'Sunucu bağlantısı başarılı!' });
    else setPingMsg({ ok: false, text: 'Sunucuya ulaşılamadı. PC ve tünelin açık olduğundan emin olun.' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setPingMsg(null);
    if (!identifier.trim() || !password) {
      setErr('Kullanıcı adı ve şifre girin.');
      return;
    }
    setLoading(true);
    try {
      if (IS_NATIVE || server.trim()) {
        setServerUrl(server);
      }
      await login(identifier.trim(), password);
      nav('/');
    } catch (e: any) {
      setErr(
        e.message === 'Failed to fetch' || e.message === 'Load failed'
          ? 'Sunucuya bağlanılamadı. Sunucu adresini ve bilgisayarınızın açık olduğunu kontrol edin.'
          : e.message
      );
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
          <p className="text-blue-100 text-sm mt-1">Kişisel Bulut ve Dosya Sunucusu</p>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          {!config.hasUsers && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 text-sm text-amber-900">
              <div className="font-semibold mb-1">İlk Kurulum Bekleniyor</div>
              Henüz yönetici hesabı oluşturulmamış. İlk kullanıcı adı ve şifrenizi belirlemek için{' '}
              <Link to="/register" className="font-bold underline text-amber-950">Yönetici Hesabı Oluşturun</Link>.
            </div>
          )}

          {err && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3.5 py-2.5 rounded-xl text-sm flex items-start gap-2">
              <AlertCircle size={18} className="shrink-0 mt-0.5" />
              <span>{err}</span>
            </div>
          )}

          {pingMsg && (
            <div className={`px-3.5 py-2.5 rounded-xl text-sm flex items-center gap-2 border ${
              pingMsg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'
            }`}>
              {pingMsg.ok ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
              <span>{pingMsg.text}</span>
            </div>
          )}

          {(IS_NATIVE || showServerInput) && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
              <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">
                Sunucu Adresi (Web / Tünel / Yerel IP)
              </label>
              <div className="flex gap-2">
                <input
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  placeholder="https://... veya http://192.168.1.x:4000"
                  inputMode="url"
                  autoCapitalize="off"
                  autoCorrect="off"
                  value={server}
                  onChange={e => setServer(e.target.value)}
                  required={IS_NATIVE}
                />
                <button
                  type="button"
                  onClick={testConnection}
                  className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-xs font-medium whitespace-nowrap"
                >
                  Test Et
                </button>
              </div>
              <p className="text-[11px] text-slate-500">
                Dışarıdan erişim için Cloudflare tünel adresinizi, ev içinde Wi-Fi için yerel IP adresini girebilirsiniz.
              </p>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Kullanıcı Adı veya E-posta
            </label>
            <input
              className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="kullaniciadi (ör. admin)"
              type="text"
              autoCapitalize="off"
              autoCorrect="off"
              value={identifier}
              onChange={e => setIdentifier(e.target.value)}
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-1">
              Şifre
            </label>
            <div className="relative">
              <input
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2.5 pr-10 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                type={showPass ? 'text' : 'password'}
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
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
            {loading ? 'Giriş yapılıyor...' : 'Giriş Yap'}
          </button>

          <div className="pt-2 border-t border-slate-100 flex flex-col gap-2 text-center text-sm">
            {config.registrationOpen ? (
              <Link to="/register" className="text-blue-600 hover:underline font-medium">
                {config.hasUsers ? 'Yeni Hesap Oluştur' : 'İlk Yönetici Hesabını Oluştur'}
              </Link>
            ) : (
              <div className="flex items-center justify-center gap-1.5 text-xs text-slate-500">
                <ShieldCheck size={15} className="text-emerald-600" />
                <span>Korumalı yayın: Sadece yetkili kullanıcı adı ve şifre ile erişilebilir</span>
              </div>
            )}

            {!IS_NATIVE && !showServerInput && (
              <button
                type="button"
                onClick={() => setShowServerInput(true)}
                className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center justify-center gap-1"
              >
                <Globe size={13} /> Farklı bir NukeDrive sunucusuna bağlan
              </button>
            )}

            {!IS_NATIVE && config.apk && (
              <a
                href="/NukeDrive.apk"
                className="mt-1 inline-flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2 px-4 rounded-xl text-xs transition"
              >
                <Smartphone size={16} className="text-blue-600" />
                Android Uygulamasını İndir (NukeDrive.apk)
              </a>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
