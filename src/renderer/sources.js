'use strict';
// Drives & servers page: local/USB/network drives, cloud-synced folders,
// Plex and Jellyfin. Anything here can be converted or added to the library.

const CLOUD_INFO = {
  gdrive: { name: 'Google Drive', url: 'https://www.google.com/drive/download/', color: '#4285f4' },
  onedrive: { name: 'OneDrive', url: 'https://www.microsoft.com/microsoft-365/onedrive/download', color: '#0a7cff' },
  dropbox: { name: 'Dropbox', url: 'https://www.dropbox.com/install', color: '#0061fe' },
  icloud: { name: 'iCloud Drive', url: 'https://apps.microsoft.com/detail/9pktq5699m62', color: '#5ac8fa' },
};

async function loadSources(force) {
  const X = S.src;
  if (X.loaded && !force) return;
  X.loading = true;
  renderSources();
  const [drives, cloud, accounts] = await Promise.all([api.src.drives().catch(() => []), api.src.cloud().catch(() => []), api.src.accounts()]);
  Object.assign(X, { drives, cloud, accounts, loaded: true, loading: false });
  if (S.page === 'sources') renderSources();
}

function folderActions(anchorOrPos, startPath, label) {
  showMenu([
    { header: label },
    { label: 'Convert a folder from here…', icon: 'convert', run: async () => {
      const p = await api.pickFolder({ title: `Choose a folder in ${label} to convert`, defaultPath: startPath });
      if (p) chooseSource(p);
    } },
    { label: 'Add videos to the library…', icon: 'library', run: async () => {
      const p = await api.pickFolder({ title: `Choose a folder in ${label} to add`, defaultPath: startPath });
      if (p) importFolderFlow(p);
    } },
    { label: 'Open in File Explorer', icon: 'external', run: () => api.open(startPath) },
  ], anchorOrPos instanceof Element ? { anchor: anchorOrPos } : anchorOrPos);
}

function renderSources() {
  const page = $('#page-sources');
  const X = S.src;
  if (X.browse) return renderBrowse(page);
  page.innerHTML = '';
  page.append(h('div', { class: 'page-head' },
    h('div', { class: 'head-text' }, h('h1', null, 'Drives & servers'), h('div', { class: 'head-sub' }, 'Bring videos in from any drive, your cloud storage or your media server — then convert them or add them to the library.')),
    h('div', { class: 'head-actions' }, btn('Refresh', { kind: 'ghost', icon: 'retry', onClick: () => loadSources(true) }))));

  if (!X.loaded) {
    page.append(h('div', { class: 'scanning' }, h('div', { class: 'spinner' }), h('div', null, 'Looking for drives…')));
    return;
  }

  // ---- drives ----
  page.append(h('div', { class: 'section-label' }, 'Drives on this PC'));
  const kindIcon = { local: 'drive', removable: 'usb', network: 'server' };
  page.append(h('div', { class: 'tile-grid' }, X.drives.map((d) => {
    const used = d.size ? 1 - d.free / d.size : 0;
    return h('button', { class: 'src-tile spot tilt', onclick: (e) => folderActions(e.currentTarget, d.root, d.label ? `${d.letter} ${d.label}` : d.letter) },
      h('div', { class: 'src-icon' }, ic(kindIcon[d.kind] || 'drive', 22)),
      h('div', { class: 'src-text' },
        h('div', { class: 'src-name' }, d.label || ({ removable: 'USB drive', network: 'Network drive' }[d.kind] || 'Local disk'), h('span', { class: 'src-letter' }, d.letter)),
        d.size ? h('div', { class: 'usage' }, h('i', { style: { width: `${used * 100}%` } })) : null,
        h('div', { class: 'src-meta' }, d.size ? `${fmtBytes(d.free)} free of ${fmtBytes(d.size)}` : d.kind)));
  }), h('button', {
    class: 'src-tile spot tilt dashed',
    onclick: async () => {
      const p = await api.pickFolder({ title: 'Choose a network folder (for example \\\\NAS\\Videos)' });
      if (p) folderActions({ x: innerWidth / 2 - 100, y: innerHeight / 2 - 60 }, p, baseName(p));
    },
  }, h('div', { class: 'src-icon' }, ic('server', 22)), h('div', { class: 'src-text' }, h('div', { class: 'src-name' }, 'Network folder / NAS'), h('div', { class: 'src-meta' }, 'Pick any shared folder')))));

  // ---- cloud ----
  page.append(h('div', { class: 'section-label' }, 'Cloud storage'));
  const found = new Set(X.cloud.map((c) => c.id));
  page.append(h('div', { class: 'tile-grid' },
    X.cloud.map((c) => h('button', { class: 'src-tile spot tilt', style: { '--brand': (CLOUD_INFO[c.id] || {}).color || 'var(--accent)' }, onclick: (e) => folderActions(e.currentTarget, c.path, c.name) },
      h('div', { class: 'src-icon brand' }, ic('cloud', 22)),
      h('div', { class: 'src-text' }, h('div', { class: 'src-name' }, c.name, h('span', { class: 'mini-pill ok' }, 'Connected')), h('div', { class: 'src-meta', title: c.path }, c.path)))),
    Object.entries(CLOUD_INFO).filter(([id]) => !found.has(id)).map(([id, info]) => h('button', { class: 'src-tile spot tilt dim', style: { '--brand': info.color }, onclick: () => cloudHelp(id) },
      h('div', { class: 'src-icon brand' }, ic('cloud', 22)),
      h('div', { class: 'src-text' }, h('div', { class: 'src-name' }, info.name), h('div', { class: 'src-meta' }, 'Not set up on this PC — click to see how'))))));

  // ---- servers ----
  page.append(h('div', { class: 'section-label' }, 'Media servers'));
  const acc = X.accounts || { plex: null, jellyfin: [] };
  const plexCard = h('div', { class: 'card server-card spot', style: { '--brand': '#e5a00d' } },
    h('div', { class: 'server-head' }, h('div', { class: 'src-icon brand big' }, ic('play', 24, 'fill')), h('div', null, h('h3', null, 'Plex'), h('p', { class: 'card-sub' }, acc.plex ? 'Signed in' : 'Download movies and shows from your Plex server.'))),
    acc.plex ? h('div', { class: 'server-list' },
      acc.plex.servers.length ? acc.plex.servers.map((s, i) => h('div', { class: 'server-row' },
        h('span', { class: `status-dot ${s.online ? 'ok' : 'bad'}` }),
        h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, s.name), h('div', { class: 'set-hint mono' }, s.url || 'Offline')),
        btn('Browse', { kind: 'primary', size: 'sm', disabled: !s.online, onClick: () => openBrowse('plex', i, s.name) }))) : h('p', { class: 'card-sub' }, 'No servers found on this account.'),
      h('div', { class: 'server-foot' },
        btn('Refresh', { kind: 'ghost sm', icon: 'retry', onClick: async () => { X.accounts = await api.src.plexRefresh().catch((e) => { toast(cleanError(e), { kind: 'error' }); return X.accounts; }); renderSources(); } }),
        btn('Add server by address', { kind: 'ghost sm', icon: 'plus', onClick: plexManual }),
        btn('Sign out', { kind: 'ghost sm danger-text', onClick: async () => { X.accounts = await api.src.forget('plex'); renderSources(); } })))
      : h('div', { class: 'server-actions' },
        btn('Sign in with Plex', { kind: 'primary', icon: 'external', onClick: plexSignIn }),
        btn('Connect by address', { kind: 'ghost', onClick: plexManual })));

  const jellyCard = h('div', { class: 'card server-card spot', style: { '--brand': '#aa5cc3' } },
    h('div', { class: 'server-head' }, h('div', { class: 'src-icon brand big' }, ic('server', 24)), h('div', null, h('h3', null, 'Jellyfin / Emby'), h('p', { class: 'card-sub' }, 'Download from your own Jellyfin or Emby server.'))),
    acc.jellyfin.length ? h('div', { class: 'server-list' }, acc.jellyfin.map((a, i) => h('div', { class: 'server-row' },
      h('span', { class: 'status-dot ok' }),
      h('div', { class: 'set-text' }, h('div', { class: 'set-label' }, a.user), h('div', { class: 'set-hint mono' }, a.url)),
      btn('Browse', { kind: 'primary', size: 'sm', onClick: () => openBrowse('jellyfin', i, a.url) }),
      btn('', { kind: 'ghost sm', icon: 'x', title: 'Sign out', onClick: async () => { X.accounts = await api.src.forget('jellyfin', i); renderSources(); } })))) : null,
    h('div', { class: 'server-actions' }, btn(acc.jellyfin.length ? 'Add another server' : 'Sign in', { kind: acc.jellyfin.length ? 'ghost' : 'primary', icon: 'plus', onClick: jellyfinSignIn })));

  page.append(h('div', { class: 'server-grid' }, plexCard, jellyCard));
  page.append(h('p', { class: 'fine-print' }, ic('shield', 13), 'Sign-ins are stored encrypted with your Windows account and only ever sent to your own servers.'));
  stagger(page, ':scope > *');
}

function cloudHelp(id) {
  const info = CLOUD_INFO[id];
  modal({
    title: `Use ${info.name} with Reframe`,
    body: h('div', { class: 'help-steps' },
      h('p', { class: 'modal-text' }, `Install the ${info.name} app for Windows and sign in. Your files then appear as a normal folder on this PC, and Reframe finds it here automatically — you can convert videos straight from it, and files that are only online download as they’re read.`),
      h('ol', null, h('li', null, `Get the ${info.name} app and sign in.`), h('li', null, 'Come back here and press Refresh.'), h('li', null, `Click ${info.name} to convert or add videos.`))),
    actions: [
      { label: 'Close', kind: 'ghost', value: null },
      { label: `Get ${info.name}`, kind: 'primary', icon: 'external', run: (close) => { api.external(info.url); close(); } },
    ],
  });
}

async function plexSignIn() {
  let pin;
  try {
    pin = await api.src.plexStart();
  } catch (e) {
    toast(cleanError(e), { kind: 'error' });
    return;
  }
  api.external(pin.url);
  let stop = false;
  const close = modal({
    title: 'Sign in with Plex',
    body: h('div', { class: 'wait-box' }, h('div', { class: 'spinner' }), h('p', { class: 'modal-text' }, 'A Plex sign-in page opened in your browser. Sign in there and approve Reframe — this window updates by itself.'),
      h('button', { class: 'link', onclick: () => api.external(pin.url) }, 'Open the page again')),
    actions: [{ label: 'Cancel', kind: 'ghost', value: null }],
    onClose: () => { stop = true; },
  });
  const t0 = Date.now();
  while (!stop && Date.now() - t0 < 10 * 60 * 1000) {
    await new Promise((r) => setTimeout(r, 2000));
    if (stop) return;
    try {
      const acc = await api.src.plexCheck(pin.id);
      if (acc) {
        S.src.accounts = acc;
        stop = true;
        close();
        toast('Connected to Plex.', { kind: 'ok' });
        renderSources();
        return;
      }
    } catch { /* keep waiting */ }
  }
}

function plexManual() {
  const url = h('input', { class: 'input', placeholder: 'http://192.168.1.20:32400', value: 'http://localhost:32400', spellcheck: 'false' });
  const token = h('input', { class: 'input', placeholder: 'X-Plex-Token', type: 'password' });
  modal({
    title: 'Connect to a Plex server',
    body: h('div', { class: 'form' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Server address'), url),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Plex token'), token),
      h('button', { class: 'link', onclick: () => api.external('https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/') }, 'How do I find my Plex token?')),
    actions: [
      { label: 'Cancel', kind: 'ghost', value: null },
      { label: 'Connect', kind: 'primary', run: async (close) => {
        try {
          S.src.accounts = await api.src.plexManual(url.value, token.value.trim());
          close();
          toast('Connected to Plex.', { kind: 'ok' });
          renderSources();
        } catch (e) {
          toast(cleanError(e), { kind: 'error' });
        }
      } },
    ],
  });
}

function jellyfinSignIn() {
  const url = h('input', { class: 'input', placeholder: 'http://192.168.1.20:8096', value: 'http://localhost:8096', spellcheck: 'false' });
  const user = h('input', { class: 'input', placeholder: 'Username', spellcheck: 'false' });
  const pass = h('input', { class: 'input', placeholder: 'Password', type: 'password' });
  modal({
    title: 'Sign in to Jellyfin or Emby',
    body: h('div', { class: 'form' },
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Server address'), url),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Username'), user),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Password'), pass)),
    actions: [
      { label: 'Cancel', kind: 'ghost', value: null },
      { label: 'Sign in', kind: 'primary', run: async (close) => {
        try {
          S.src.accounts = await api.src.jellyfinSignIn(url.value, user.value.trim(), pass.value);
          close();
          toast('Signed in to Jellyfin.', { kind: 'ok' });
          renderSources();
        } catch (e) {
          toast(cleanError(e), { kind: 'error' });
        }
      } },
    ],
  });
}

// ---------- browsing a server ----------
async function openBrowse(src, server, name) {
  S.src.browse = { src, server, name, libs: null, lib: null, items: null, selected: new Set(), search: '', loading: true };
  renderSources();
  try {
    S.src.browse.libs = await api.src.libraries(src, server);
    S.src.browse.loading = false;
    if (S.src.browse.libs.length) return openLib(S.src.browse.libs[0]);
  } catch (e) {
    toast(cleanError(e), { kind: 'error' });
    S.src.browse = null;
  }
  renderSources();
}

async function openLib(lib) {
  const B = S.src.browse;
  Object.assign(B, { lib, items: null, selected: new Set(), loading: true, search: '' });
  renderSources();
  try {
    B.items = await api.src.items(B.src, B.server, lib);
  } catch (e) {
    toast(cleanError(e), { kind: 'error' });
    B.items = [];
  }
  B.loading = false;
  renderSources();
}

function renderBrowse(page) {
  const B = S.src.browse;
  page.innerHTML = '';
  page.append(h('div', { class: 'page-head' },
    h('button', { class: 'btn ghost icon-only back', 'aria-label': 'Back', onclick: () => { S.src.browse = null; renderSources(); } }, ic('arrowLeft', 18)),
    h('div', { class: 'head-icon' }, ic(B.src === 'plex' ? 'play' : 'server', 22)),
    h('div', { class: 'head-text' }, h('h1', null, B.name), h('div', { class: 'head-sub' }, B.src === 'plex' ? 'Plex server' : 'Jellyfin server'))));

  if (B.libs && B.libs.length) {
    page.append(h('div', { class: 'tabs' }, B.libs.map((l) => h('button', { class: `tab ${B.lib && B.lib.id === l.id ? 'on' : ''}`, onclick: () => openLib(l) }, ic(l.type === 'show' ? 'layers' : 'film', 15), l.name))));
  } else if (B.libs) {
    page.append(emptyState({ iconName: 'server', title: 'No video libraries', text: 'This server has no movie or TV libraries your account can see.' }));
    return;
  }
  if (B.loading || !B.items) {
    page.append(h('div', { class: 'scanning' }, h('div', { class: 'spinner' }), h('div', null, 'Loading the library…')));
    return;
  }
  const q = B.search.toLowerCase();
  const items = B.items.filter((i) => !q || i.title.toLowerCase().includes(q));
  const chosen = B.items.filter((i) => B.selected.has(i.id));
  const size = chosen.reduce((n, i) => n + (i.size || 0), 0);
  const search = h('input', { class: 'input', placeholder: `Search ${B.lib.name}`, value: B.search, spellcheck: 'false' });
  search.addEventListener('input', () => {
    B.search = search.value;
    clearTimeout(B.t);
    B.t = setTimeout(() => {
      renderSources();
      const s = $('#page-sources .lib-search input');
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }, 150);
  });
  page.append(h('div', { class: 'browse-bar' },
    h('label', { class: 'lib-search' }, ic('search', 16), search),
    btn(B.selected.size === items.length && items.length ? 'Select none' : 'Select all', { kind: 'ghost', onClick: () => { B.selected = B.selected.size === items.length ? new Set() : new Set(items.map((i) => i.id)); renderSources(); } }),
    h('div', { class: 'grow' }),
    h('span', { class: 'browse-sum' }, chosen.length ? `${plural(chosen.length, 'item')}${size ? ` · ${fmtBytes(size)}` : ''}` : 'Pick what to download'),
    btn('Download', {
      kind: 'primary',
      icon: 'download',
      disabled: !chosen.length,
      onClick: async () => {
        try {
          await api.src.download({ src: B.src, server: B.server, lib: B.lib, groupIds: chosen.map((i) => i.id), title: chosen.length === 1 ? chosen[0].title : `${chosen.length} items from ${B.lib.name}` });
          toast(`Downloading ${plural(chosen.length, 'item')} — follow it in Activity.`, { kind: 'ok', action: { label: 'Activity', run: () => go('activity') } });
          B.selected.clear();
          renderSources();
        } catch (e) {
          toast(cleanError(e), { kind: 'error' });
        }
      },
    })));
  if (!items.length) {
    page.append(emptyState({ iconName: 'film', title: 'Nothing found', text: 'No videos match.' }));
    return;
  }
  const grid = h('div', { class: 'browse-grid' });
  for (const it of items) {
    const on = B.selected.has(it.id);
    grid.append(h('button', {
      class: `browse-item spot ${on ? 'on' : ''}`,
      onclick: () => {
        if (on) B.selected.delete(it.id);
        else B.selected.add(it.id);
        renderSources();
      },
    },
    h('span', { class: `vcheck static ${on ? 'on' : ''}` }, ic('check', 14)),
    h('div', { class: 'bi-icon' }, ic(it.kind === 'show' ? 'layers' : 'film', 20)),
    h('div', { class: 'bi-text' },
      h('div', { class: 'bi-title' }, it.title, it.year ? h('span', { class: 'bi-year' }, ` (${it.year})`) : null),
      h('div', { class: 'bi-meta' }, [it.kind === 'show' ? plural(it.count || 0, 'episode') : 'Movie', it.size ? fmtBytes(it.size) : null].filter(Boolean).join(' · ')))));
  }
  page.append(grid);
}
