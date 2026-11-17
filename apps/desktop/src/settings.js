const $ = (id) => document.getElementById(id);
const radios = (name) => [...document.querySelectorAll(`input[name=${name}]`)];
const STATUS = {
  off: ['Kapalı', 'muted'], downloading: ['cloudflared indiriliyor…', 'warn'], starting: ['Bağlanıyor…', 'warn'],
  connected: ['Bağlı', 'ok'], error: ['Hata — kayıtlara bakın', 'err']
};
let formFilled = false;

function msg(el, text, cls) { el.textContent = text; el.className = 'msg ' + (cls || ''); }

function render(s) {
  const c = s.config;
  $('cfgPath').textContent = s.configPath;
  $('localUrl').textContent = s.localUrl;
  $('ownerInfo').textContent = s.owner ? `${s.owner.username} (${s.owner.name})` : 'Henüz oluşturulmadı (Aşağıdan belirleyin)';
  if (!formFilled && s.owner) {
    $('accUsername').value = s.owner.username;
  }
  $('lanUrls').innerHTML = '';
  if (s.lanUrls.length) s.lanUrls.forEach(u => { const e = document.createElement('div'); e.innerHTML = '<span class="url"></span>'; e.firstChild.textContent = u; $('lanUrls').append(e); });
  else $('lanUrls').innerHTML = '<span class="muted">Kapalı</span>';

  const [label, cls] = STATUS[s.tunnel.status] || STATUS.off;
  $('internet').innerHTML = `<span class="badge ${cls}"></span> <span class="url" ${s.internetUrl ? '' : 'hidden'}></span>`;
  $('internet').children[0].textContent = label;
  $('internet').children[1].textContent = s.internetUrl;
  $('tlog').textContent = s.tunnel.log.join('\n') || '—';
  $('svc').textContent = `127.0.0.1:${c.port}`;

  $('apkBox').hidden = !s.apk;
  $('apkMissing').hidden = !!s.apk;
  if (s.apk) {
    $('apkUrl').textContent = s.apk;
    $('appServer').textContent = s.internetUrl || 'internet adresiniz (önce 2. adımı tamamlayın)';
    $('apkNote').textContent = s.internetUrl
      ? (c.tunnel.mode === 'quick' ? 'Hızlı tünel adresi uygulama yeniden açılınca değişir; telefonda adresi yeniden girmeniz gerekir.' : '')
      : 'Telefon uygulaması güvenli bağlantı (HTTPS) ister; bu yüzden önce internete açma adımını tamamlayın. APK\'yı şimdilik yerel ağ adresinden indirebilirsiniz.';
  }
  $('dataDir').textContent = s.dataDir;
  $('autostart').checked = s.openAtLogin;
  $('contextMenu').checked = !!s.contextMenuEnabled;
  $('notifyOnUpload').checked = c.notifyOnUpload !== false;
  $('welcome').hidden = $('finishBox').hidden = c.setupDone;

  // Form alanlarını yalnızca ilk açılışta doldur; kullanıcı yazarken üzerine yazma
  if (!formFilled) {
    formFilled = true;
    radios('tmode').forEach(r => r.checked = r.value === c.tunnel.mode);
    radios('host').forEach(r => r.checked = r.value === c.host);
    $('publicUrl').value = c.tunnel.publicUrl;
    $('token').placeholder = c.tunnel.hasToken ? 'Kayıtlı (değiştirmek için yenisini yapıştırın)' : 'eyJh...';
    $('allowRegister').checked = c.allowRegister;
    $('port').value = c.port;
    $('maxUploadMb').value = c.maxUploadMb;
    $('tokenBox').hidden = c.tunnel.mode !== 'token';
  }
}

radios('tmode').forEach(r => r.addEventListener('change', () => { $('tokenBox').hidden = r.value !== 'token' || !r.checked; }));

document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', (e) => { e.preventDefault(); nd.open(b.dataset.open); }));

$('saveAccount').addEventListener('click', async () => {
  msg($('accountMsg'), 'Kaydediliyor…');
  try {
    const next = await nd.saveAccount({
      username: $('accUsername').value,
      password: $('accPassword').value
    });
    $('accPassword').value = '';
    render(next);
    msg($('accountMsg'), 'Kullanıcı adı ve şifre kaydedildi! Web sitenizden ve Android uygulamanızdan bu bilgilerle giriş yapabilirsiniz.', 'ok');
  } catch (e) {
    msg($('accountMsg'), e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err');
  }
});

$('saveTunnel').addEventListener('click', async () => {
  const mode = radios('tmode').find(r => r.checked)?.value || 'off';
  msg($('tunnelMsg'), 'Kaydediliyor…');
  try {
    render(await nd.saveTunnel({ mode, token: $('token').value, publicUrl: $('publicUrl').value }));
    $('token').value = '';
    msg($('tunnelMsg'), mode === 'off' ? 'Tünel kapatıldı.' : 'Kaydedildi. Bağlantı durumu yukarıda görünür.', 'ok');
  } catch (e) { msg($('tunnelMsg'), e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'); }
});

$('saveServer').addEventListener('click', async () => {
  msg($('serverMsg'), 'Sunucu yeniden başlatılıyor…');
  try {
    await nd.saveServer({
      host: radios('host').find(r => r.checked)?.value,
      allowRegister: $('allowRegister').checked,
      port: $('port').value,
      maxUploadMb: $('maxUploadMb').value
    });
  } catch (e) { msg($('serverMsg'), e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'err'); }
});

$('autostart').addEventListener('change', async (e) => {
  try {
    render(await nd.autostart(e.target.checked));
    msg($('desktopMsg'), e.target.checked ? 'Windows açılışında başlatma açıldı.' : 'Windows açılışında başlatma kapatıldı.', 'ok');
  } catch (err) {
    msg($('desktopMsg'), err.message, 'err');
  }
});

$('contextMenu').addEventListener('change', async (e) => {
  try {
    render(await nd.contextMenu(e.target.checked));
    msg($('desktopMsg'), e.target.checked ? 'Windows sağ tık menüsüne "NukeDrive\'a Yükle" eklendi.' : 'Sağ tık menüsünden kaldırıldı.', 'ok');
  } catch (err) {
    msg($('desktopMsg'), 'Sağ tık ayarı değiştirilemedi: ' + err.message, 'err');
  }
});

$('notifyOnUpload').addEventListener('change', async (e) => {
  render(await nd.setPrefs({ notifyOnUpload: e.target.checked }));
});

$('backup').addEventListener('click', async () => {
  msg($('backupMsg'), 'Yedekleniyor…');
  try {
    const dir = await nd.backup();
    msg($('backupMsg'), dir ? `Yedek alındı: ${dir}` : '', 'ok');
  } catch (e) { msg($('backupMsg'), 'Yedek alınamadı: ' + e.message, 'err'); }
});

$('finish').addEventListener('click', async () => { await nd.finishSetup(); render(await nd.state()); });

nd.onState(render);
nd.state().then(render);
