'use strict';
const {
  app, BrowserWindow, ipcMain, dialog, shell, protocol, Notification, powerSaveBlocker, nativeImage, clipboard, safeStorage,
} = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const engine = require('./engine');
const { loadPresets, findPreset, defaultPresetsFile } = require('./presets');
const { Library, COLORS } = require('./library');
const { Tools, detectGpuEncoders, run } = require('./tools');
const { Transfers, safeName } = require('./downloader');
const sources = require('./sources');
const pcscan = require('./pcscan');
const { Capture } = require('./capture');

app.setAppUserModelId('com.chr0m3void.reframe');

// Windows tells Chromium when a window is covered, and Chromium then treats
// it as hidden: pages pause and stop taking input. That would stall a long
// conversion preview or a Capture browser click-through the moment another
// window is put on top, so covered windows keep running normally.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

protocol.registerSchemesAsPrivileged([{
  scheme: 'reframe',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const RENDERER_DIR = path.join(__dirname, 'renderer');
const ASSET_DIR = path.join(__dirname, '..', 'assets');
const DATA_DIR = app.getPath('userData');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const CUSTOM_PRESETS_FILE = path.join(DATA_DIR, 'custom-presets.json');
// Deleting this file (shipped next to Reframe.exe) removes every 18+ part of
// the app: the built-in adult sites and the 18+ switch. Links in your own
// .txt files still show. While the file is there nothing changes.
const NSFW_FILE_NAME = 'DELETE THIS FILE to remove all 18+ (NSFW) content.txt';
const NSFW_FILE = app.isPackaged
  ? path.join(path.dirname(process.execPath), NSFW_FILE_NAME)
  : path.join(__dirname, '..', 'release-extras', NSFW_FILE_NAME);
const SFW_ONLY = !fs.existsSync(NSFW_FILE);

const DEFAULT_SETTINGS = {
  presetName: null,
  suffix: ' converted',
  copyOthers: true,
  skipExisting: true,
  keepDates: true,
  addToLibrary: true,
  autoCategorize: true,
  lowPriority: true,
  concurrency: 0, // 0 = automatic
  turbo: false,
  notify: true,
  openWhenDone: false,
  cliPath: '',
  presetsPath: '',
  libraryView: 'grid',
  librarySort: 'added',
  firstRunDone: false,
  setupDone: false,
  showScanned: true,
  showAdult: false,
  capture: { adblock: true, blockRedirects: true, allowSites: [] },
  stats: { converted: 0, savedBytes: 0, folders: 0, downloads: 0, downloadBytes: 0, comics: 0 },
  appearance: {
    accent: 'ember', custom: '#ff5e62', theme: 'graphite', motion: 'full', radius: 'round',
    density: 'comfortable', zoom: 1, aurora: true, cardSize: 230, splash: true,
  },
  downloads: {
    dir: path.join(app.getPath('videos'), 'Reframe Downloads'),
    quality: 'best', addToLibrary: true, convertAfter: false, convertPreset: null, cookiesBrowser: '', subtitles: false,
  },
  clientId: '',
  accounts: { plex: null, jellyfin: [] },
};

let settings = structuredClone(DEFAULT_SETTINGS);
try {
  const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  settings = {
    ...settings,
    ...saved,
    appearance: { ...DEFAULT_SETTINGS.appearance, ...(saved.appearance || {}) },
    downloads: { ...DEFAULT_SETTINGS.downloads, ...(saved.downloads || {}) },
    accounts: { ...DEFAULT_SETTINGS.accounts, ...(saved.accounts || {}) },
    capture: { ...DEFAULT_SETTINGS.capture, ...(saved.capture || {}) },
    stats: { ...DEFAULT_SETTINGS.stats, ...(saved.stats || {}) },
  };
  if (!settings.downloads.dir) settings.downloads.dir = DEFAULT_SETTINGS.downloads.dir;
  // Older versions switched the ad blocker off for every site from one
  // "retry without ad blocker" click. Turn it back on once; sites are now
  // switched off one at a time instead.
  if (SFW_ONLY) settings.showAdult = false;
  if (!settings.capture.adblockReset) {
    settings.capture.adblock = true;
    settings.capture.adblockReset = true;
  }
  // Older versions saved 1 as the default; automatic is faster.
  if (saved.concurrency === 1 && !saved.concurrencyChosen) settings.concurrency = 0;
} catch { /* defaults */ }
if (!settings.clientId) settings.clientId = crypto.randomUUID();

function saveSettings() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
  } catch { /* ignore */ }
}

// Server sign-in tokens are encrypted with the Windows account's key.
const seal = (s) => (s && safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(s).toString('base64')}` : s);
const unseal = (s) => {
  if (!s || !String(s).startsWith('enc:')) return s;
  try {
    return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64'));
  } catch {
    return null;
  }
};

function bundledCli() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'handbrake', 'HandBrakeCLI.exe')
    : path.join(__dirname, '..', 'vendor', 'handbrake', 'HandBrakeCLI.exe');
}
const cliPath = () => settings.cliPath || bundledCli();

let presets = loadPresets({ file: settings.presetsPath || null, writeCustomTo: CUSTOM_PRESETS_FILE });
const library = new Library(DATA_DIR);
const tools = new Tools(DATA_DIR);
const converter = new engine.Converter({
  getCli: cliPath,
  getSettings: () => settings,
  getCustomPresetFile: () => presets.customFile,
});
const transfers = new Transfers({ tools, getSettings: () => settings });
const plex = new sources.Plex(settings.clientId);
const jellyfin = new sources.Jellyfin(settings.clientId);

const downloadAfter = () => {
  const d = settings.downloads;
  return { addToLibrary: d.addToLibrary, convert: d.convertAfter, presetName: d.convertPreset || settings.presetName };
};

// The Capture browser hands its finds to the normal downloader.
const capture = new Capture({
  rendererUrl: 'reframe://app/capture.html',
  preload: path.join(__dirname, 'capture-preload.js'),
  dataDir: DATA_DIR,
  icon: path.join(ASSET_DIR, 'icon.png'),
  onFile: (item, site) => transfers.trackBrowserDownload(item, { outDir: settings.downloads.dir, site, after: downloadAfter() }),
  settings: () => settings.capture,
  appearance: () => settings.appearance,
  saveSettings: () => saveSettings(),
  onPictures: (o) => transfers.addImages({ ...o, outDir: settings.downloads.dir }),
  ffmpeg: () => (tools.hasFfmpeg() ? { ffmpeg: tools.ffmpegPath, probe: tools.ffprobePath } : null),
  // The bookmark star adds the page to Other sites (Bookmarks.txt).
  onBookmark: async (title, url) => {
    ensureOtherDir();
    const file = path.join(OTHER_DIR, 'Bookmarks.txt');
    const existing = await fsp.readFile(file, 'utf8').catch(() => '');
    if (existing.includes(url)) return 'already';
    await fsp.appendFile(file, `${existing && !existing.endsWith('\n') ? '\r\n' : ''}${title.replace(/[\r\n]+/g, ' ').replace(/\s+-\s+/g, ' – ').slice(0, 80)} - ${url}\r\n`);
    send('other:changed');
    return 'added';
  },
  onDownload: (o) => {
    const isFile = o.kind === 'File';
    if (!tools.hasYtdlp() && !isFile) throw new Error('Set up the downloader first (Downloader page → Set it up).');
    let host = 'Web';
    try {
      host = new URL(o.referer || o.url).hostname.replace(/^www\./, '');
    } catch { /* keep Web */ }
    return transfers.addUrl({
      url: o.url,
      info: { title: o.title, site: host, thumbnail: '', via: isFile && !tools.hasYtdlp() ? 'direct' : 'ytdlp' },
      fixedTitle: o.page || o.kind === 'Player' ? '' : o.title,
      referer: o.referer,
      cookiesFile: o.cookiesFile,
      userAgent: o.userAgent,
      quality: settings.downloads.quality,
      subtitles: settings.downloads.subtitles,
      outDir: settings.downloads.dir,
      after: downloadAfter(),
    });
  },
});

let gpu = { encoders: [], name: '' };
let win = null;
let blockerId = null;

const send = (channel, payload) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
};

function iconImage() {
  const p = path.join(ASSET_DIR, 'icon.png');
  return fs.existsSync(p) ? nativeImage.createFromPath(p) : undefined;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 1000,
    minHeight: 660,
    backgroundColor: '#0b0c10',
    show: false,
    title: 'Reframe',
    icon: iconImage(),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0c10', symbolColor: '#a3a9b8', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  win.removeMenu();
  win.on('closed', () => {
    if (capture.win && !capture.win.isDestroyed()) capture.win.close();
  });
  win.once('ready-to-show', () => {
    win.webContents.setZoomFactor(Number(settings.appearance.zoom) || 1);
    win.show();
  });
  win.loadURL('reframe://app/index.html');

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('reframe://app/')) e.preventDefault();
  });

  win.on('close', (e) => {
    const busy = converter.isBusy() || transfers.isBusy() || scanState.running;
    if (!busy || win.forceClose) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep going', 'Stop and quit'],
      defaultId: 0,
      cancelId: 0,
      title: 'Reframe',
      message: 'Reframe is still working.',
      detail: 'If you quit now, anything converting or downloading is stopped and its unfinished file is removed. Your original videos are not touched.',
    });
    if (choice === 1) {
      converter.killAll();
      transfers.killAll();
      scanState.stop = true;
      win.forceClose = true;
      setTimeout(() => win.close(), 400);
    }
  });
}

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
  '.ogv': 'video/ogg',
};

// Serves files with HTTP range support so the built-in player can seek.
async function serveFile(file, request) {
  const st = await fsp.stat(file);
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const range = request.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? +m[1] : 0;
    let end = m && m[2] ? +m[2] : st.size - 1;
    if (m && !m[1] && m[2]) {
      start = Math.max(0, st.size - +m[2]);
      end = st.size - 1;
    }
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    }
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(stream, {
      status: 206,
      headers: {
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), {
    status: 200,
    headers: { 'Content-Type': type, 'Content-Length': String(st.size), 'Accept-Ranges': 'bytes' },
  });
}

function registerProtocol() {
  protocol.handle('reframe', async (request) => {
    const url = new URL(request.url);
    try {
      // Media and thumbnails are served from the app's own origin so the
      // renderer can draw video frames to a canvas for thumbnails.
      if (url.host === 'app' && url.pathname.startsWith('/@media/')) {
        const file = Buffer.from(url.pathname.slice('/@media/'.length), 'base64url').toString('utf8');
        if (!engine.isVideo(file)) return new Response('Not a video', { status: 403 });
        return await serveFile(file, request);
      }
      if (url.host === 'app' && url.pathname.startsWith('/@capu/')) {
        return await capture.proxy(Buffer.from(url.pathname.slice('/@capu/'.length), 'base64url').toString('utf8'), request);
      }
      if (url.host === 'app' && url.pathname.startsWith('/@thumb/')) {
        const name = path.basename(decodeURIComponent(url.pathname));
        return await serveFile(path.join(library.thumbDir, name), request);
      }
      if (url.host === 'app') {
        const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
        const file = path.normalize(path.join(RENDERER_DIR, rel));
        const assetFile = path.normalize(path.join(ASSET_DIR, rel.replace(/^assets\//, '')));
        if (rel.startsWith('assets/') && engine.isInside(assetFile, ASSET_DIR)) return await serveFile(assetFile, request);
        if (!engine.isInside(file, RENDERER_DIR)) return new Response('Not found', { status: 404 });
        return await serveFile(file, request);
      }
    } catch {
      return new Response('Not found', { status: 404 });
    }
    return new Response('Not found', { status: 404 });
  });
}

function updateTaskbar() {
  if (!win || win.isDestroyed()) return;
  const job = converter.activeJob();
  if (!job) {
    win.setProgressBar(-1);
    return;
  }
  const done = job.items.reduce((n, i) => n + (['done', 'skipped', 'failed', 'cancelled'].includes(i.status) ? i.size : i.size * i.progress), 0);
  win.setProgressBar(job.totalBytes ? Math.max(0.01, done / job.totalBytes) : 2);
}

function keepAwake() {
  const busy = converter.isBusy() || transfers.isBusy();
  if (busy && blockerId === null) blockerId = powerSaveBlocker.start('prevent-app-suspension');
  if (!busy && blockerId !== null) {
    powerSaveBlocker.stop(blockerId);
    blockerId = null;
  }
}

function notify(title, body, onClick) {
  if (!settings.notify || !Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: iconImage() });
  if (onClick) n.on('click', onClick);
  n.show();
}

converter.on('update', (job) => {
  send('jobs:update', job);
  updateTaskbar();
  keepAwake();
});
converter.on('idle', () => {
  keepAwake();
  updateTaskbar();
});

// Lifetime totals shown on the Home page.
function bumpStats(patch) {
  const s = settings.stats;
  for (const [k, v] of Object.entries(patch)) s[k] = (s[k] || 0) + v;
  saveSettings();
  send('stats:changed', s);
}

converter.on('finished', (job) => {
  const ok = job.items.filter((i) => i.status === 'done' || i.status === 'skipped');
  const failed = job.items.filter((i) => i.status === 'failed').length;
  const done = job.items.filter((i) => i.status === 'done');
  if (done.length) bumpStats({ converted: done.length, savedBytes: done.reduce((n, i) => n + Math.max(0, i.size - i.outSize), 0), folders: 1 });

  if (job.options.addToLibrary && ok.length) {
    const res = library.addTree(
      job.dest,
      job.name,
      ok.map((i) => ({ rel: i.out, size: i.outSize, source: path.join(job.source, i.src), fresh: i.status === 'done' })),
      { autoCategorize: job.options.autoCategorize, origin: 'convert', parentCategoryId: job.options.parentCategoryId || null },
    );
    send('library:added', { jobId: job.id, ...res });
  }

  if (job.status !== 'cancelled') {
    notify(
      job.status === 'done' ? `“${job.name}” is converted` : `“${job.name}” finished with problems`,
      failed ? `${ok.length} converted, ${failed} could not be converted.` : `${ok.length} video${ok.length === 1 ? '' : 's'} ready in “${path.basename(job.dest)}”.`,
      () => {
        shell.openPath(job.dest);
        if (win) win.show();
      },
    );
    if (settings.openWhenDone && ok.length) shell.openPath(job.dest);
    if (win && !win.isFocused()) win.flashFrame(true);
  }
});

transfers.on('update', (job) => {
  send('jobs:update', job);
  keepAwake();
});

transfers.on('finished', async (job) => {
  keepAwake();
  const files = (job.files || []).filter((f) => fs.existsSync(f));
  if (!files.length || job.status === 'cancelled') return;
  bumpStats(job.type === 'images'
    ? { comics: 1, downloadBytes: files.reduce((n, f) => n + fileSize(f), 0) }
    : { downloads: files.length, downloadBytes: files.reduce((n, f) => n + fileSize(f), 0) });
  const after = job.after || {};
  const videos = files.filter((f) => engine.isVideo(f));

  if (after.addToLibrary && videos.length) {
    const downloads = library.findOrCreate('Downloads', null);
    if (job.type === 'server') {
      library.addTree(job.outDir, job.site || 'Server', videos.map((f) => ({ rel: path.relative(job.outDir, f), size: fileSize(f) })), { origin: 'download', parentCategoryId: downloads.id });
    } else {
      library.addTree(job.outDir, safeName(job.site || 'Web'), videos.map((f) => ({ rel: path.basename(f), size: fileSize(f) })), { origin: 'download', parentCategoryId: downloads.id });
    }
  }

  if (after.convert && after.presetName && videos.length) {
    const preset = findPreset(presets, after.presetName);
    if (preset && fs.existsSync(cliPath())) {
      if (job.type === 'server') {
        // Whole tree: mirror it into "<folder> converted" like a normal convert.
        const scan = await engine.scanFolder(job.outDir, { exclude: [`${job.outDir}${settings.suffix}`] });
        await converter.addJob({ source: job.outDir, dest: `${job.outDir}${settings.suffix}`, preset, options: convertOptions(after), scan, gpuEncoder: turboEncoder(preset) }).catch(() => {});
      } else {
        const byDir = new Map();
        for (const f of videos) {
          const d = path.dirname(f);
          if (!byDir.has(d)) byDir.set(d, []);
          byDir.get(d).push({ path: f, size: fileSize(f) });
        }
        for (const [dir, list] of byDir) {
          const scan = engine.fileScan(dir, list);
          await converter.addJob({ source: dir, dest: path.join(dir, 'Converted'), preset, options: convertOptions(after), scan, gpuEncoder: turboEncoder(preset), name: job.title }).catch(() => {});
        }
      }
    }
  }

  if (job.status === 'done' || job.status === 'partial') {
    notify('Download finished', `${job.title}`, () => shell.openPath(job.outDir));
  }
});

function convertOptions(after) {
  return {
    copyOthers: false, skipExisting: true, keepDates: true, addToLibrary: !!after.addToLibrary, autoCategorize: true,
    parentCategoryId: library.findOrCreate('Downloads', null).id,
  };
}

function fileSize(f) {
  try {
    return fs.statSync(f).size;
  } catch {
    return 0;
  }
}

function turboEncoder(preset) {
  return settings.turbo ? engine.gpuEncoderFor(preset.encoder, gpu.encoders) : null;
}

function presetsPayload() {
  return {
    source: presets.source,
    groups: presets.groups,
    defaultName: presets.defaultName,
    selected: settings.presetName && findPreset(presets, settings.presetName) ? settings.presetName : presets.defaultName,
  };
}

// ---------- Other sites ----------
const OTHER_DIR = path.join(app.getPath('documents'), 'Reframe Other Sites');

function ensureOtherDir() {
  const readme = path.join(OTHER_DIR, 'README - how this folder works.txt');
  if (fs.existsSync(readme)) return;
  fs.mkdirSync(OTHER_DIR, { recursive: true });
  fs.writeFileSync(readme, [
    'Put .txt files of website or video links in this folder and they show up',
    'in Reframe under Downloader > Your own sites.',
    '',
    'One link per line. You can give a link a name like this:',
    '  My site - https://example.com',
    '',
    'Links to videos can be downloaded straight away ("Download all").',
    'Links to websites open in the Capture browser.',
    'Cloud drive share links (Google Drive, Dropbox, OneDrive, Box) work too.',
  ].join('\r\n'));
}

async function readOtherSites() {
  ensureOtherDir();
  const files = (await fsp.readdir(OTHER_DIR)).filter((f) => /\.txt$/i.test(f) && !/^readme/i.test(f));
  const sites = [];
  const seen = new Set();
  for (const f of files) {
    const text = await fsp.readFile(path.join(OTHER_DIR, f), 'utf8').catch(() => '');
    const added = (await fsp.stat(path.join(OTHER_DIR, f)).catch(() => ({ mtimeMs: 0 }))).mtimeMs;
    // A short line without a link ("# Anime", "Movies:", "[Manga]") is a
    // heading: the links under it go into that group.
    let section = '';
    for (const line of text.split(/\r?\n/)) {
      if (!/https?:\/\//i.test(line)) {
        const head = line.trim()
          .replace(/\s*\(\s*\d+\s*\)\s*$/, '') // "Movies (120)" -> "Movies"
          .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '') // emoji
          .replace(/^[#=\-*\[(\s]+|[\]):=\-*\s]+$/g, '')
          .trim();
        if (head && head.length <= 40 && !/[.!?]\s|^\/\//.test(line.trim()) && /[a-z]/i.test(head)) section = head;
        continue;
      }
      for (const m of line.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
        const u = m[0].replace(/[),.;]+$/, '');
        if (seen.has(u)) continue;
        let parsed;
        try {
          parsed = new URL(u);
        } catch {
          continue;
        }
        seen.add(u);
        const hostName = parsed.hostname.replace(/^www\./, '');
        const label = line.slice(0, m.index).replace(/[-–—:|]\s*$/, '').trim();
        sites.push({ n: label && label.length < 60 ? label : hostName, u, h: hostName, file: f, deep: parsed.pathname.length > 1, section, order: sites.length, added });
      }
    }
  }
  return { dir: OTHER_DIR, files, sites };
}

// ---------- PC scan ----------
const scanState = { running: false, stop: false, last: null };

async function runPcScan(roots) {
  if (scanState.running) return;
  scanState.running = true;
  scanState.stop = false;
  send('pcscan:progress', { running: true, folders: 0, found: 0, current: '' });
  try {
    const drives = await sources.listDrives().catch(() => []);
    const list = roots && roots.length ? roots : pcscan.defaultRoots(drives);
    const { results, stats, stopped } = await pcscan.scanPc(list, {
      onProgress: (p) => send('pcscan:progress', { running: true, ...p }),
      shouldStop: () => scanState.stop,
      exclude: [DATA_DIR],
    });
    const res = library.addScanned(results);
    scanState.last = { at: Date.now(), found: stats.found, folders: stats.folders, stopped };
    send('pcscan:progress', { running: false, done: true, ...stats, stopped, added: res.added, categoryId: res.categoryId });
  } catch (e) {
    send('pcscan:progress', { running: false, error: e.message });
  } finally {
    scanState.running = false;
  }
}

// ---------- media server browsing ----------
// Browse results keep their download links here; the window only sees titles.
const browseCache = new Map();

function plexAccount() {
  const a = settings.accounts.plex;
  if (!a) return null;
  return { ...a, token: unseal(a.token), servers: (a.servers || []).map((s) => ({ ...s, token: unseal(s.token) })) };
}

function jellyAccount(i) {
  const a = settings.accounts.jellyfin[i];
  return a ? { ...a, token: unseal(a.token) } : null;
}

function publicAccounts() {
  const p = settings.accounts.plex;
  return {
    plex: p ? { user: p.user || 'Plex account', servers: (p.servers || []).map((s) => ({ name: s.name, url: s.url, online: !!s.url })) } : null,
    jellyfin: settings.accounts.jellyfin.map((a) => ({ url: a.url, user: a.user })),
  };
}

function stripGroups(groups) {
  return groups.map((g) => ({ id: g.id, title: g.title, year: g.year || null, kind: g.kind, count: g.count || (g.files ? g.files.length : 0), size: g.size || 0, lazy: !!g.lazy }));
}

async function serverConn(src, serverIdx) {
  if (src === 'plex') {
    const a = plexAccount();
    const s = a && a.servers[serverIdx];
    if (!s || !s.url) throw new Error('That Plex server is offline.');
    return { url: s.url, token: s.token, name: s.name };
  }
  const a = jellyAccount(serverIdx);
  if (!a) throw new Error('Sign in to Jellyfin first.');
  return a;
}

function registerIpc() {
  const h = (ch, fn) => ipcMain.handle(ch, (_e, arg) => fn(arg));

  h('app:info', () => ({
    version: require('../package.json').version,
    cli: { path: cliPath(), exists: fs.existsSync(cliPath()), bundled: !settings.cliPath },
    presetsFile: presets.source,
    defaultPresetsFile: defaultPresetsFile(),
    dataDir: DATA_DIR,
    colors: COLORS,
    gpu,
    cores: os.cpus().length,
    sfwOnly: SFW_ONLY,
  }));

  h('ui:zoom', (z) => {
    if (win) win.webContents.setZoomFactor(Math.max(0.8, Math.min(1.3, Number(z) || 1)));
  });
  h('ui:titlebar', ({ color, symbol }) => {
    try {
      if (win) win.setTitleBarOverlay({ color: color || '#00000000', symbolColor: symbol || '#a3a9b8', height: 44 });
    } catch { /* older Windows */ }
  });

  h('dialog:folder', async ({ title, defaultPath } = {}) => {
    const res = await dialog.showOpenDialog(win, { title: title || 'Choose a folder', defaultPath, properties: ['openDirectory', 'createDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });
  h('dialog:file', async ({ title, filters, defaultPath } = {}) => {
    const res = await dialog.showOpenDialog(win, { title, defaultPath, filters, properties: ['openFile'] });
    return res.canceled ? null : res.filePaths[0];
  });

  h('fs:inspect', async (target) => {
    try {
      const st = await fsp.stat(target);
      return { exists: true, isDir: st.isDirectory() };
    } catch {
      return { exists: false, isDir: false };
    }
  });
  h('fs:scan', ({ root, exclude }) => engine.scanFolder(root, { exclude: exclude || [] }));
  h('fs:defaultDest', (root) => engine.defaultDestination(root, settings.suffix));
  h('fs:freeSpace', async (target) => {
    let p = path.resolve(target);
    while (p && !fs.existsSync(p)) {
      const up = path.dirname(p);
      if (up === p) break;
      p = up;
    }
    try {
      const s = await fsp.statfs(p);
      return s.bavail * s.bsize;
    } catch {
      return null;
    }
  });

  h('presets:list', () => presetsPayload());
  h('presets:reload', () => {
    presets = loadPresets({ file: settings.presetsPath || null, writeCustomTo: CUSTOM_PRESETS_FILE });
    return presetsPayload();
  });

  h('settings:get', () => ({ ...settings, accounts: undefined }));
  h('settings:set', (patch) => {
    const allowed = Object.keys(DEFAULT_SETTINGS).filter((k) => k !== 'accounts' && k !== 'clientId');
    for (const [k, v] of Object.entries(patch || {})) {
      if (!allowed.includes(k)) continue;
      if (k === 'appearance' || k === 'downloads') settings[k] = { ...settings[k], ...v };
      else settings[k] = v;
    }
    if ('concurrency' in (patch || {})) settings.concurrencyChosen = true;
    if (SFW_ONLY) settings.showAdult = false;
    settings.concurrency = Math.max(0, Math.min(4, Number(settings.concurrency) || 0));
    if (!settings.downloads.dir) settings.downloads.dir = DEFAULT_SETTINGS.downloads.dir;
    if (typeof settings.suffix !== 'string' || !settings.suffix.trim()) settings.suffix = DEFAULT_SETTINGS.suffix;
    saveSettings();
    if ('appearance' in (patch || {})) capture.sendLook();
    if ('presetsPath' in (patch || {})) presets = loadPresets({ file: settings.presetsPath || null, writeCustomTo: CUSTOM_PRESETS_FILE });
    return { ...settings, accounts: undefined };
  });

  // ---------- conversions & downloads ----------
  h('jobs:start', async ({ source, dest, presetName, options, files }) => {
    const preset = findPreset(presets, presetName);
    if (!preset) throw new Error('Choose a preset first.');
    if (!fs.existsSync(cliPath())) throw new Error('HandBrakeCLI.exe was not found. Set its location in Settings.');
    settings.presetName = presetName;
    saveSettings();
    if (files && files.length) {
      // Single videos (from the library): converted into a "Converted" folder beside them.
      const byDir = new Map();
      for (const f of files) {
        const d = path.dirname(f);
        if (!byDir.has(d)) byDir.set(d, []);
        byDir.get(d).push({ path: f, size: fileSize(f) });
      }
      let id = null;
      for (const [dir, list] of byDir) {
        id = await converter.addJob({ source: dir, dest: path.join(dir, 'Converted'), preset, options, scan: engine.fileScan(dir, list), gpuEncoder: turboEncoder(preset), name: list.length === 1 ? path.parse(list[0].path).name : path.basename(dir) });
      }
      return id;
    }
    const src = path.resolve(source);
    const out = path.resolve(dest);
    if (src.toLowerCase() === out.toLowerCase()) throw new Error('Choose a different output folder: it cannot be the original folder.');
    const scan = await engine.scanFolder(src, { exclude: [out] });
    return converter.addJob({ source: src, dest: out, preset, options, scan, gpuEncoder: turboEncoder(preset) });
  });
  const isDl = (id) => String(id).startsWith('dl');
  h('jobs:list', () => [...converter.list(), ...transfers.list()]);
  h('jobs:cancel', (id) => (isDl(id) ? transfers.cancel(id) : converter.cancel(id)));
  h('jobs:skip', ({ jobId, itemId }) => converter.skipItem(jobId, itemId));
  h('jobs:retry', (id) => (isDl(id) ? transfers.retry(id) : converter.retry(id)));
  h('jobs:log', ({ jobId, itemId }) => (isDl(jobId) ? transfers.log(jobId) : converter.log(jobId, itemId)));
  h('jobs:clear', () => {
    converter.clearFinished();
    transfers.clearFinished();
    return [...converter.list(), ...transfers.list()];
  });
  h('jobs:speed', ({ presetName }) => {
    const preset = findPreset(presets, presetName);
    if (!preset) return null;
    const enc = turboEncoder(preset);
    const fakeJob = { gpuEncoder: enc, preset: { height: preset.height } };
    return { parallel: engine.parallelFor(fakeJob, settings.concurrency), gpuEncoder: enc, canTurbo: !!engine.gpuEncoderFor(preset.encoder, gpu.encoders) };
  });

  h('tools:status', () => tools.status());
  h('tools:install', (name) => tools.install(name, (n, done, total) => send('tools:progress', { name: n, done, total })));

  h('dl:inspect', ({ url, cookiesBrowser }) => transfers.inspect(url, { cookiesBrowser }));
  h('dl:start', (opts) => {
    const d = settings.downloads;
    // Several links at once are queued straight away, one after another.
    const urls = opts.urls && opts.urls.length ? opts.urls : [opts.url];
    let id = null;
    for (const url of urls) {
      id = transfers.addUrl({
        url,
        info: urls.length === 1 ? opts.info : null,
        quality: opts.quality || d.quality,
        playlist: !!opts.playlist,
        cookiesBrowser: opts.cookiesBrowser || '',
        subtitles: d.subtitles,
        outDir: d.dir,
        after: downloadAfter(),
      });
    }
    return id;
  });
  h('capture:open', (url) => capture.open(url && /^https?:\/\//i.test(url) ? url : null));

  // "Other sites": .txt files of links in Documents\Reframe Other Sites.
  h('other:list', () => readOtherSites());
  h('other:pictures', async ({ urls, cbz }) => {
    const n = await capture.picturesFromLinks(urls, cbz, (i, total) => send('other:picturesProgress', { i, total }));
    send('other:picturesProgress', { done: true, saved: n, total: urls.length });
    return n;
  });
  h('other:open', () => {
    ensureOtherDir();
    return shell.openPath(OTHER_DIR);
  });
  h('other:import', async () => {
    const res = await dialog.showOpenDialog(win, { title: 'Choose a .txt file of links', filters: [{ name: 'Text files', extensions: ['txt'] }], properties: ['openFile', 'multiSelections'] });
    if (res.canceled) return null;
    ensureOtherDir();
    for (const f of res.filePaths) {
      let to = path.join(OTHER_DIR, path.basename(f));
      if (path.resolve(f).toLowerCase() === path.resolve(to).toLowerCase()) continue;
      for (let n = 2; fs.existsSync(to); n++) to = path.join(OTHER_DIR, `${path.parse(f).name} (${n}).txt`);
      await fsp.copyFile(f, to);
    }
    return readOtherSites();
  });
  h('other:remove', async (file) => {
    const p = path.join(OTHER_DIR, path.basename(String(file)));
    if (/\.txt$/i.test(p) && fs.existsSync(p)) await fsp.rm(p);
    return readOtherSites();
  });
  h('clipboard:read', () => clipboard.readText());

  // ---------- sources ----------
  h('src:drives', () => sources.listDrives());
  h('src:cloud', async () => sources.cloudFolders(await sources.listDrives().catch(() => [])));
  h('src:accounts', () => publicAccounts());

  h('plex:startSignIn', () => plex.startSignIn());
  h('plex:checkSignIn', async (pinId) => {
    const token = await plex.checkSignIn(pinId);
    if (!token) return null;
    const servers = await plex.servers(token);
    settings.accounts.plex = { user: 'Plex account', token: seal(token), servers: servers.map((s) => ({ ...s, token: seal(s.token) })) };
    saveSettings();
    return publicAccounts();
  });
  h('plex:connectManual', async ({ url, token }) => {
    const base = sources.trimUrl(url);
    await plex.test(base, token);
    const prev = settings.accounts.plex || { user: 'Plex', servers: [] };
    prev.servers = [...(prev.servers || []).filter((s) => s.url !== base), { name: new URL(base).host, url: base, token: seal(token) }];
    settings.accounts.plex = prev;
    saveSettings();
    return publicAccounts();
  });
  h('plex:refresh', async () => {
    const a = plexAccount();
    if (!a || !a.token) return publicAccounts();
    const servers = await plex.servers(a.token);
    settings.accounts.plex.servers = servers.map((s) => ({ ...s, token: seal(s.token) }));
    saveSettings();
    return publicAccounts();
  });
  h('jellyfin:signIn', async ({ url, username, password }) => {
    const acc = await jellyfin.signIn(url, username, password);
    settings.accounts.jellyfin = [...settings.accounts.jellyfin.filter((a) => a.url !== acc.url || a.user !== acc.user), { ...acc, token: seal(acc.token) }];
    saveSettings();
    return publicAccounts();
  });
  h('src:forget', ({ type, index }) => {
    if (type === 'plex') settings.accounts.plex = null;
    else settings.accounts.jellyfin.splice(index, 1);
    saveSettings();
    return publicAccounts();
  });

  h('src:libraries', async ({ src, server }) => {
    const conn = await serverConn(src, server);
    return src === 'plex' ? plex.libraries(conn) : jellyfin.libraries(conn);
  });
  h('src:items', async ({ src, server, lib }) => {
    const conn = await serverConn(src, server);
    const groups = src === 'plex' ? await plex.items(conn, lib) : await jellyfin.items(conn, lib);
    browseCache.set(`${src}:${server}:${lib.id}`, { lib, groups });
    return stripGroups(groups);
  });
  h('src:download', async ({ src, server, lib, groupIds, title }) => {
    const conn = await serverConn(src, server);
    const cache = browseCache.get(`${src}:${server}:${lib.id}`);
    if (!cache) throw new Error('Open the library again, then choose what to download.');
    const files = [];
    for (const g of cache.groups.filter((x) => groupIds.includes(x.id))) {
      if (g.lazy && src === 'plex') files.push(...await plex.showFiles(conn, cache.lib, g));
      else files.push(...(g.files || []));
    }
    if (!files.length) throw new Error('Nothing to download there.');
    const d = settings.downloads;
    const site = src === 'plex' ? `Plex - ${safeName(conn.name || 'Server')}` : 'Jellyfin';
    return transfers.addFiles({
      title: title || `${files.length} file${files.length === 1 ? '' : 's'} from ${cache.lib.name}`,
      site,
      outDir: path.join(d.dir, site),
      files,
      after: { addToLibrary: d.addToLibrary, convert: d.convertAfter, presetName: d.convertPreset || settings.presetName },
    });
  });

  // ---------- PC scan ----------
  h('pcscan:roots', async () => pcscan.defaultRoots(await sources.listDrives().catch(() => [])));
  h('pcscan:start', (roots) => {
    runPcScan(roots);
    return true;
  });
  h('pcscan:stop', () => {
    scanState.stop = true;
  });
  h('pcscan:state', () => ({ running: scanState.running, last: scanState.last }));

  // Only folders and media files are opened, never programs or scripts.
  h('shell:open', (p) => {
    if (typeof p !== 'string' || !path.isAbsolute(p)) return 'Not allowed';
    let st = null;
    try { st = fs.statSync(p); } catch { return 'Not found'; }
    if (st.isDirectory() || engine.isVideo(p) || /\.(cbz|zip|jpe?g|png|gif|webp|avif|mp3|m4a|flac|wav|opus|ogg|txt|pdf)$/i.test(p)) return shell.openPath(p);
    return 'Not allowed';
  });
  h('shell:reveal', (p) => shell.showItemInFolder(p));
  h('shell:external', (url) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
  });

  h('library:get', () => library.get());
  h('library:createCategory', (data) => library.createCategory(data));
  h('library:updateCategory', ({ id, patch }) => library.updateCategory(id, patch));
  h('library:deleteCategory', (id) => library.deleteCategory(id));
  h('library:assign', ({ videoIds, categoryId, move }) => library.assign(videoIds, categoryId, { move }));
  h('library:unassign', ({ videoIds, categoryId }) => library.unassign(videoIds, categoryId));
  h('library:renameVideo', ({ id, title }) => library.renameVideo(id, title));
  h('library:favourite', ({ ids, value }) => library.setFavourite(ids, value));
  h('library:remove', (ids) => library.removeVideos(ids));
  h('library:saveThumb', ({ id, dataUrl, meta }) => library.saveThumb(id, dataUrl, meta));
  h('library:probe', async (id) => {
    const v = library.get().videos.find((x) => x.id === id);
    if (!v || !tools.hasFfmpeg()) return false;
    const res = await tools.probe(v.path, path.join(library.thumbDir, `${v.id}.jpg`));
    library.setThumbFile(id, !!(res && res.thumb), res ? res.meta : {});
    return !!(res && res.thumb);
  });
  h('library:missing', () => library.checkMissing());
  h('library:clearThumbs', () => library.clearThumbs());
  h('library:reset', () => library.reset());
  h('library:forgetScanned', () => library.forgetScanned());
  h('library:import', async ({ root, autoCategorize }) => {
    const scan = await engine.scanFolder(root);
    const files = [];
    const walk = (node) => {
      node.videos.forEach((v) => files.push({ rel: v.rel, size: v.size }));
      node.dirs.forEach(walk);
    };
    walk(scan.tree);
    const res = library.addTree(scan.root, scan.tree.name, files, { autoCategorize, origin: 'import' });
    return { ...res, found: files.length };
  });
}

library.on('changed', (data) => send('library:changed', data));
library.on('patch', (p) => send('library:patch', p));

async function detectGpu() {
  gpu.encoders = await detectGpuEncoders(cliPath()).catch(() => []);
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const r = await run(ps, ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join "|"'], { timeout: 15000 });
  const names = r.stdout.trim().split('|').filter(Boolean);
  const want = gpu.encoders.some((e) => e.startsWith('vce')) ? /amd|radeon/i : gpu.encoders.some((e) => e.startsWith('nvenc')) ? /nvidia|geforce|rtx|gtx/i : /intel/i;
  gpu.name = names.find((n) => want.test(n)) || names[0] || '';
  send('app:gpu', gpu);
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  registerProtocol();
  registerIpc();
  capture.registerIpc();
  createWindow();
  detectGpu();
});

app.on('before-quit', () => library.flush());
app.on('window-all-closed', () => {
  converter.killAll();
  transfers.killAll();
  library.flush();
  app.quit();
});
