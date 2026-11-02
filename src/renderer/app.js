'use strict';
// App shell: state, navigation, folder drag & drop and start-up.

const S = {
  page: 'home',
  info: null,
  settings: null,
  presets: null,
  tools: null,
  toolProgress: {},
  scan: null,
  jobs: new Map(),
  library: { categories: [], videos: [] },
  missing: new Set(),
  expandedJobs: new Set(),
  convert: { source: null, scan: null, dest: null, destCustom: false, preset: null, scanning: false, expanded: new Set(), showFiles: true, free: null },
  dl: { url: '', info: null, loading: false, error: '', quality: 'best', playlist: false, cookies: '' },
  src: { loaded: false, drives: [], cloud: [], accounts: null, browse: null },
  lib: { cat: 'all', search: '', sort: 'added', view: 'grid', filter: 'any', selected: new Set(), open: new Set(), anchor: null, shown: 120, firstPaint: true },
};

const RENDER = {
  home: () => renderHome(),
  convert: () => renderConvert(),
  download: () => renderDownload(),
  sources: () => renderSources(),
  activity: () => renderActivity(),
  library: () => renderLibrary(),
  settings: () => renderSettings(),
  help: () => renderHelp(),
};

// Pages cross-fade into each other (unless animations are off).
function go(page) {
  if (page !== S.page && typeof smooth === 'function' && !go.inner) {
    // The flag is set inside the callback, which the transition runs later.
    smooth(() => {
      go.inner = true;
      try {
        go(page);
      } finally {
        go.inner = false;
      }
    });
    return;
  }
  closeMenus();
  if (S.page !== page && page === 'library') S.lib.firstPaint = true;
  S.page = page;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${page}`));
  movePill();
  RENDER[page]();
  if (page === 'library') refreshMissing();
  if (page === 'sources') loadSources();
  if (page === 'download') refreshTools();
}

// The highlight behind the active nav item glides between items.
function movePill() {
  const active = $('.nav-item.active');
  const pill = $('#navPill');
  if (!active || !pill) return;
  pill.style.transform = `translateY(${active.offsetTop}px)`;
  pill.style.height = `${active.offsetHeight}px`;
  pill.classList.add('on');
}

function updateChrome() {
  const jobs = [...S.jobs.values()];
  const active = jobs.filter((j) => ACTIVE.includes(j.status));
  const badge = $('#activityBadge');
  badge.hidden = !active.length;
  badge.textContent = active.length;

  const running = active.find((j) => j.kind !== 'download' && (j.status === 'running' || j.status === 'preparing'));
  const dl = active.find((j) => j.kind === 'download' && j.status === 'running');
  const status = $('#titleStatus');
  if (running) {
    const n = jobNumbers(running);
    status.innerHTML = '';
    append(status, [h('span', { class: 'ts-dot' }), `Converting “${running.name}” · ${n.finished} of ${running.items.length} · ${Math.floor(n.fraction * 100)}%`]);
    status.hidden = false;
    status.onclick = () => go('activity');
  } else if (dl) {
    status.innerHTML = '';
    append(status, [h('span', { class: 'ts-dot' }), `Downloading · ${Math.floor(dl.progress * 100)}%${dl.speed ? ` · ${dl.speed}` : ''}`]);
    status.hidden = false;
    status.onclick = () => go('activity');
  } else {
    status.hidden = true;
  }

  const count = visibleLibrary().videos.length;
  $('#libraryCount').textContent = count ? count.toLocaleString() : '';

  const card = $('#engineCard');
  card.innerHTML = '';
  const ok = S.info && S.info.cli.exists;
  append(card, [
    h('span', { class: `status-dot ${ok ? 'ok' : 'bad'}` }),
    h('div', null,
      h('div', { class: 'ec-title' }, ok ? 'HandBrake ready' : 'HandBrake missing'),
      h('div', { class: 'ec-sub' }, ok ? (S.settings.turbo ? 'Turbo on' : S.presets && S.presets.source ? 'Using your presets' : 'Standard presets') : 'Set it up in Settings')),
    S.settings.turbo && ok ? h('span', { class: 'ec-bolt' }, ic('bolt', 14)) : null,
  ]);
  card.onclick = () => go('settings');
}

async function refreshMissing() {
  const ids = await api.library.missing();
  const next = new Set(ids);
  const changed = next.size !== S.missing.size || ids.some((id) => !S.missing.has(id));
  S.missing = next;
  if (changed && S.page === 'library') renderLibrary();
}

// ---------- drag a folder in from Explorer ----------
function setupDrop() {
  const veil = $('#dropVeil');
  let depth = 0;
  const isFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  window.addEventListener('dragenter', (e) => {
    if (!isFiles(e)) return;
    depth++;
    const toLibrary = S.page === 'library';
    $('#dropVeilTitle').textContent = toLibrary ? 'Drop to add these videos to the library' : 'Drop the folder to convert it';
    $('#dropVeilText').textContent = toLibrary ? 'Folders inside become categories.' : 'Everything inside, including every folder within it, comes along.';
    veil.classList.add('show');
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) veil.classList.remove('show');
  });
  window.addEventListener('dragover', (e) => {
    if (isFiles(e)) e.preventDefault();
  });
  window.addEventListener('drop', async (e) => {
    if (!isFiles(e)) return;
    e.preventDefault();
    depth = 0;
    veil.classList.remove('show');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const p = api.pathForFile(file);
    if (!p) return;
    const info = await api.inspect(p);
    if (!info.isDir) {
      toast('Drop a folder rather than a single file.', { kind: 'warn' });
      return;
    }
    if (e.dataTransfer.files.length > 1) toast('Only the first folder was used. Drop folders one at a time.', { kind: 'info' });
    if (S.page === 'library') importFolderFlow(p);
    else chooseSource(p);
  });
  // Dropping a link (from a browser) on the downloader fills it in.
  window.addEventListener('drop', (e) => {
    const url = e.dataTransfer && e.dataTransfer.getData('text/uri-list');
    if (url && /^https?:/i.test(url)) {
      e.preventDefault();
      go('download');
      fetchLink(url.split('\n')[0]);
    }
  });
}

function setupKeys() {
  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.ctrlKey && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      chooseSource();
    }
    if (e.ctrlKey && e.key.toLowerCase() === 'v' && S.page === 'download') {
      e.preventDefault();
      api.readClipboard().then((t) => fetchLink(t));
    }
    if (S.page === 'library' && e.ctrlKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      S.lib.selected = new Set(visibleVideos(libIndex()).map((v) => v.id));
      renderLibrary();
    }
    if (S.page === 'library' && e.key === 'Escape' && S.lib.selected.size && !$('#layer').children.length) {
      S.lib.selected.clear();
      renderLibrary();
    }
    if (e.ctrlKey && e.key === 'f' && S.page === 'library') {
      e.preventDefault();
      const s = $('#page-library .lib-search input');
      if (s) s.focus();
    }
  });
}

let libRenderTimer = null;
function onLibraryChange(data) {
  S.library = data;
  updateChrome();
  if (S.page !== 'library') return;
  clearTimeout(libRenderTimer);
  libRenderTimer = setTimeout(() => {
    const focused = document.activeElement && document.activeElement.closest('.lib-search');
    renderLibrary();
    if (focused) {
      const s = $('#page-library .lib-search input');
      if (s) {
        s.focus();
        s.setSelectionRange(s.value.length, s.value.length);
      }
    }
  }, 120);
}

function playSplash() {
  const splash = $('#splash');
  const ap = S.settings.appearance;
  if (ap.splash === false || ap.motion === 'off') {
    splash.remove();
    return Promise.resolve();
  }
  splash.classList.add('play');
  return new Promise((r) => setTimeout(() => {
    splash.classList.add('out');
    setTimeout(() => splash.remove(), 600);
    r();
  }, 1650));
}

async function boot() {
  hydrateIcons();
  const [info, settings, presets, jobs, library, tools] = await Promise.all([
    api.info(), api.getSettings(), api.presets(), api.jobs(), api.library.get(), api.tools.status(),
  ]);
  S.info = info;
  // NSFW file deleted: the built-in 18+ sites leave the app entirely.
  if (info.sfwOnly) for (let i = SITES.length - 1; i >= 0; i--) if (SITES[i].g === 'Adult (18+)') SITES.splice(i, 1);
  S.settings = settings;
  S.presets = presets;
  S.tools = tools;
  S.jobs = new Map(jobs.map((j) => [j.id, j]));
  S.library = library;
  S.lib.view = settings.libraryView || 'grid';
  S.lib.sort = settings.librarySort || 'added';
  applyAppearance(settings.appearance);

  $$('.nav-item').forEach((b) => b.addEventListener('click', () => go(b.dataset.page)));
  $('#creditChip').addEventListener('click', () => api.external(TIKTOK));
  api.onJob(onJobUpdate);
  api.onGpu((gpu) => { S.info.gpu = gpu; if (['convert', 'settings', 'home'].includes(S.page)) RENDER[S.page](); });
  api.library.onChange(onLibraryChange);
  api.library.onPatch(onLibraryPatch);
  api.library.onAdded(() => queueThumbs());
  api.pcscan.onProgress(onScanProgress);
  api.other.onChange(() => loadOther());
  api.onStats((st) => { S.settings.stats = st; if (S.page === 'home') renderHome(); });
  api.tools.onProgress(({ name, done, total }) => {
    S.toolProgress[name] = { done, total };
    const bars = $$(`.tool-progress[data-tool="${name}"]`);
    if (!bars.length && (S.page === 'download' || S.page === 'settings')) RENDER[S.page]();
    for (const el of bars) {
      el.querySelector('.bar i').style.width = `${total ? (done / total) * 100 : 0}%`;
      el.querySelector('span').textContent = total ? `${fmtBytes(done)} of ${fmtBytes(total)}` : 'Starting…';
    }
  });
  setupDrop();
  setupKeys();
  window.addEventListener('resize', movePill);
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('input, textarea')) e.preventDefault();
  });
  setInterval(() => {
    if (S.page === 'activity') {
      for (const job of S.jobs.values()) {
        if (job.status === 'running' && job.kind !== 'download') updateJobCard(document.querySelector(`.job[data-id="${job.id}"]`), job);
      }
    }
  }, 2000);

  updateChrome();
  go('home');
  queueThumbs();
  document.body.classList.add('ready');
  const st = await api.pcscan.state();
  if (st.running) onScanProgress({ running: true, folders: 0, found: 0 });
  await playSplash();
  movePill();
  if (!settings.setupDone) openSetup();
  if (!info.cli.exists) {
    toast('HandBrakeCLI.exe was not found. Open Settings to point Reframe at it.', { kind: 'warn', timeout: 0, action: { label: 'Settings', run: () => go('settings') } });
  }
}

boot();
