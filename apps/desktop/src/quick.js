const $ = (id) => document.getElementById(id);

let currentState = null;
let pinned = false;

function fmtBytes(b) {
  if (!b) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0) + ' ' + sizes[i];
}

function render(s) {
  currentState = s;
  $('connDot').className = s.serverReady ? 'dot' : 'dot off';

  $('loginBox').hidden = !!s.loggedIn;
  $('appBox').hidden = !s.loggedIn;
  $('logoutBtn').hidden = !s.loggedIn;

  $('userLabel').textContent = s.loggedIn && s.user ? `@${s.user.username}` : 'Oturum kapalı';
  if (s.stats) {
    const used = fmtBytes(s.stats.usedBytes);
    const quota = s.stats.quotaBytes > 0 ? fmtBytes(s.stats.quotaBytes) : 'Sınırsız';
    $('storageLabel').textContent = `${used} / ${quota}`;
  } else {
    $('storageLabel').textContent = s.tunnelUrl ? 'Tünel Aktif' : 'Yerel';
  }

  $('pillAuto').className = s.openAtLogin ? 'pill on' : 'pill';
  $('pillAuto').textContent = `Başlangıçta Aç: ${s.openAtLogin ? 'Açık' : 'Kapalı'}`;
  $('pillCtx').className = s.contextMenuEnabled ? 'pill on' : 'pill';
  $('pillCtx').textContent = `Sağ Tık Menüsü: ${s.contextMenuEnabled ? 'Açık' : 'Kapalı'}`;

  // Klasör listesi
  const sel = $('folderSelect');
  const prev = sel.value;
  sel.innerHTML = '<option value="">Ana Dizin</option>';
  (s.folders || []).forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.id;
    opt.textContent = f.name;
    sel.appendChild(opt);
  });
  if ([...sel.options].some(o => o.value === prev)) sel.value = prev;

  // Transferler
  const txs = s.transfers || [];
  $('txCount').textContent = txs.length ? `Aktarımlar (${txs.length})` : 'Aktarımlar';
  const list = $('txList');
  if (!txs.length) {
    list.innerHTML = '<div class="muted" style="text-align:center;padding:12px 0;">Henüz aktarım yok. Sağ tık menüsünden veya buradan dosya gönderebilirsiniz.</div>';
    return;
  }

  list.innerHTML = '';
  for (const t of txs) {
    const el = document.createElement('div');
    el.className = 'tx';

    const top = document.createElement('div');
    top.className = 'tx-top';
    const name = document.createElement('div');
    name.className = 'tx-name';
    name.textContent = t.name;
    name.title = t.name;

    const status = document.createElement('div');
    status.className = 'tx-status ' + (t.status === 'done' ? 'ok' : t.status === 'error' ? 'err' : '');
    status.textContent = t.status === 'done'
      ? 'Tamamlandı ✓'
      : t.status === 'error'
        ? 'Hata'
        : t.status === 'cancelled'
          ? 'İptal'
          : `%${Number(t.progress || 0).toFixed(1)}`;
    top.append(name, status);

    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('div');
    fill.style.width = `${Math.min(100, Math.max(0, t.progress || 0))}%`;
    if (t.status === 'done') fill.style.background = 'var(--ok)';
    if (t.status === 'error') fill.style.background = 'var(--err)';
    bar.appendChild(fill);

    const act = document.createElement('div');
    act.className = 'tx-actions';
    const info = document.createElement('span');
    if (t.status === 'error') {
      info.textContent = t.error || 'Yüklenemedi';
      info.style.color = 'var(--err)';
    } else if (t.status === 'uploading') {
      const spd = t.speedBps > 0 ? ` • ${fmtBytes(t.speedBps)}/sn` : '';
      info.textContent = `${fmtBytes(t.loadedBytes)} / ${fmtBytes(t.totalBytes)}${spd}`;
    } else {
      info.textContent = fmtBytes(t.totalBytes);
    }
    act.appendChild(info);

    if (t.status === 'uploading') {
      const cbtn = document.createElement('button');
      cbtn.className = 'link-btn';
      cbtn.textContent = 'İptal';
      cbtn.onclick = () => nd.quickCancelTransfer(t.id);
      act.appendChild(cbtn);
    } else if (t.status === 'done' && t.fileId) {
      const sbtn = document.createElement('button');
      sbtn.className = 'link-btn';
      sbtn.textContent = t.copied ? 'Kopyalandı ✓' : 'Link Kopyala';
      sbtn.onclick = async () => {
        await nd.quickCopyShare(t.fileId);
        sbtn.textContent = 'Kopyalandı ✓';
      };
      act.appendChild(sbtn);
    }

    el.append(top, bar, act);
    list.appendChild(el);
  }
}

$('loginBtn').addEventListener('click', async () => {
  $('loginErr').textContent = '';
  try {
    render(await nd.quickLogin({ username: $('loginUser').value, password: $('loginPass').value }));
    $('loginPass').value = '';
  } catch (e) {
    $('loginErr').textContent = e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
});

$('loginPass').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('loginBtn').click(); });

$('pickFilesBtn').addEventListener('click', () => nd.quickPickFiles($('folderSelect').value || null));
$('pickFolderBtn').addEventListener('click', () => nd.quickPickFolder($('folderSelect').value || null));
$('clearTxBtn').addEventListener('click', () => nd.quickClearTransfers());

$('openDriveBtn').addEventListener('click', () => nd.open('drive'));
$('openSettingsBtn').addEventListener('click', () => nd.open('settings'));
$('hideBtn').addEventListener('click', () => nd.quickHide());
$('pinBtn').addEventListener('click', () => {
  pinned = !pinned;
  $('pinBtn').className = pinned ? 'icon-btn active' : 'icon-btn';
  nd.quickPin(pinned);
});

$('pillAuto').addEventListener('click', async () => {
  if (!currentState) return;
  render(await nd.autostart(!currentState.openAtLogin));
});
$('pillCtx').addEventListener('click', async () => {
  if (!currentState) return;
  render(await nd.contextMenu(!currentState.contextMenuEnabled));
});
$('logoutBtn').addEventListener('click', async () => {
  render(await nd.quickLogout());
});

// Drag & Drop (dosya ve klasörler)
const dz = $('dropzone');
['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => {
  e.preventDefault();
  e.stopPropagation();
  dz.classList.add('dragover');
}));
['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => {
  e.preventDefault();
  e.stopPropagation();
  dz.classList.remove('dragover');
}));
dz.addEventListener('drop', (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  const paths = files.map(f => nd.getFilePath(f)).filter(Boolean);
  if (paths.length) {
    nd.quickUploadPaths(paths, $('folderSelect').value || null);
  }
});

nd.onQuickState(render);
nd.quickState().then(render);
