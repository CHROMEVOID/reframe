'use strict';
// Capture browser: a small built-in browser that spots the video a page is
// playing (MP4/WebM files, HLS and DASH streams) and the pictures on it, so
// they can be saved even from sites yt-dlp has no extractor for.
// Copy-protected (DRM) video stays encrypted and is not touched, and
// "are you human" checks are left for the user to solve.
const { BaseWindow, BrowserWindow, WebContentsView, session, ipcMain, Menu, clipboard, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

const PARTITION = 'persist:reframe-capture';
const BAR = 58;
const PANEL = 540;
// The browser's real identity minus the app/Electron tags, so every signal a
// site checks (user agent, client hints, version) agrees. A mismatch is what
// makes 'are you human' checks loop.
let UA = '';
function realUA(ses) {
  if (!UA) UA = ses.getUserAgent().replace(/\s(Electron|reframe|Reframe)\/\S+/g, '');
  return UA;
}
const MEDIA_EXT = /\.(mp4|m4v|webm|mov|mkv|flv|m3u8|mpd)(\?|#|$)/i;
const SEGMENT = /\.(ts|m4s|aac|m4a|vtt|webvtt|key)(\?|#|$)|\/seg[-_]?\d|segment|\/chunk|frag(ment)?[-_]?\d|init\.mp4/i;
// Typical ad-video addresses (VAST/pre-roll servers), on top of the ad lists.
const AD_MEDIA = /doubleclick|googlesyndication|googleadservices|imasdk|adservice|adnxs|adsrvr|advertising|\bvast\b|vpaid|preroll|pre-roll|midroll|\/ads?\/|[?&]ad(id|_?unit|tag)=|adserver|exoclick|trafficjunky|juicyads|popads|propellerads|adsterra|tsyndicate|ad-?delivery|bidder|prebid/i;

function kindOf(url, type) {
  const t = (type || '').toLowerCase();
  if (/mpegurl/.test(t) || /\.m3u8(\?|#|$)/i.test(url)) return 'HLS';
  if (/dash\+xml/.test(t) || /\.mpd(\?|#|$)/i.test(url)) return 'DASH';
  if (t.startsWith('video/') || MEDIA_EXT.test(url)) return 'File';
  return null;
}

// Human-check (CAPTCHA) services: never blocked, scanned or treated as redirects.
const CHALLENGE_HOSTS = ['challenges.cloudflare.com', 'hcaptcha.com', 'newassets.hcaptcha.com', 'recaptcha.net', 'gstatic.com', 'arkoselabs.com', 'funcaptcha.com', 'captcha-delivery.com', 'perimeterx.net', 'px-cloud.net', 'px-cdn.net', 'ddos-guard.net', 'hcaptcha-assets-prod.com'];
const CHECK_TITLE = /just a moment|attention required|verify(ing)? (you|that)|are you (a )?(human|robot)|security check|ddos-guard|checking your browser|captcha|one more step/i;
const isChallenge = (u) => /challenges\.cloudflare\.com|cdn-cgi\/challenge|hcaptcha|recaptcha|arkoselabs|funcaptcha|captcha-delivery|perimeterx|px-cloud|px-cdn|ddos-guard|__cf_chl/i.test(String(u));

function hostOf(u) {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return 'Web';
  }
}

// The "came from" address to send with a download. Like a normal browser,
// another server only gets the site's address, not the full page address:
// Chromium refuses the request otherwise (with ERR_BLOCKED_BY_CLIENT, the
// same error an ad blocker gives, which made this hard to spot).
function refererFor(target, page) {
  try {
    const t = new URL(target);
    const p = new URL(page);
    return t.origin === p.origin ? p.href : `${p.origin}/`;
  } catch {
    return undefined;
  }
}

const refHeaders = (target, page) => {
  const r = refererFor(target, page);
  return r ? { Referer: r } : {};
};

// Rough "same site" check: example.co.uk and video.example.co.uk match.
function siteOf(u) {
  try {
    const parts = new URL(u).hostname.split('.');
    const two = parts.slice(-2).join('.');
    return /^(co|com|org|net|ac|gov|edu)\.[a-z]{2}$/.test(two) ? parts.slice(-3).join('.') : two;
  } catch {
    return '';
  }
}

function header(headers, name) {
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === name);
  return key ? String(headers[key][0] || '') : '';
}

// yt-dlp reads cookies in the Netscape format.
async function writeCookies(ses, file) {
  const cookies = await ses.cookies.get({});
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    const domain = c.domain || '';
    const prefix = c.httpOnly ? '#HttpOnly_' : '';
    lines.push([
      `${prefix}${domain}`, domain.startsWith('.') ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE',
      Math.round(c.expirationDate || 0), c.name, c.value,
    ].join('\t'));
  }
  await fs.promises.writeFile(file, `${lines.join('\n')}\n`);
  return file;
}

const fileNameOf = (u, fallback) => {
  try {
    const n = decodeURIComponent(new URL(u).pathname.split('/').filter(Boolean).pop() || '');
    return n.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim() || fallback;
  } catch {
    return fallback;
  }
};

class Capture {
  constructor({ rendererUrl, preload, dataDir, icon, onDownload, onFile, onBookmark, onPictures, settings, appearance, saveSettings, ffmpeg }) {
    Object.assign(this, { rendererUrl, preload, icon, onDownload, onFile, onBookmark, onPictures, settings, appearance, saveSettings, ffmpeg });
    this.adCache = path.join(dataDir, 'adblock-ads-engine-v2.bin');
    this.bundledAds = path.join(__dirname, '..', 'assets', 'adblock-ads.bin');
    this.previewDir = path.join(dataDir, 'capture-previews');
    this.cookieFile = path.join(dataDir, 'capture-cookies.txt');
    this.stats = { ads: 0, popups: 0, redirects: 0 };
    this.win = null;
    this.found = [];
    this.panelHeight = 0;
    this.wired = false;
  }

  getSession() {
    if (!this.ses) {
      const ses = session.fromPartition(PARTITION);
      ses.setUserAgent(realUA(ses));
      ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'fullscreen' || perm === 'clipboard-sanitized-write'));
      this.ses = ses;
    }
    return this.ses;
  }

  open(url) {
    if (this.win && !this.win.isDestroyed()) {
      // Bring the window back even if it was minimised behind Reframe.
      if (this.win.isMinimized()) this.win.restore();
      this.win.show();
      this.win.focus();
      if (url) this.go(url);
      return;
    }
    const ses = this.getSession();

    this.win = new BaseWindow({ width: 1280, height: 860, minWidth: 760, minHeight: 500, title: 'Reframe — Capture browser', backgroundColor: '#ffffff', icon: this.icon });
    this.bar = new WebContentsView({ webPreferences: { preload: this.preload, contextIsolation: true, sandbox: true } });
    this.page = new WebContentsView({ webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, backgroundThrottling: false } });
    this.bar.setBackgroundColor('#101218');
    this.page.setBackgroundColor('#ffffff');
    this.win.contentView.addChildView(this.page);
    this.win.contentView.addChildView(this.bar);
    this.panelHeight = 0;
    this.layout();
    // Keep the page filling the window however it's resized or maximised.
    for (const ev of ['resize', 'resized', 'maximize', 'unmaximize', 'restore', 'enter-full-screen', 'leave-full-screen', 'show']) this.win.on(ev, () => this.layout());
    this.win.on('closed', () => {
      clearInterval(this.scanTimer);
      this.win = null;
      this.found = [];
      this.stats = { ads: 0, popups: 0, redirects: 0 };
      fs.promises.rm(this.previewDir, { recursive: true, force: true }).catch(() => {});
    });
    this.bar.webContents.loadURL(this.rendererUrl);

    const wc = this.page.webContents;
    wc.setWindowOpenHandler(({ url: target, disposition }) => {
      if (!/^https?:/.test(target)) return { action: 'deny' };
      // Sign-in pop-ups and human checks need a real window.
      if (disposition === 'new-window' && (/accounts\.|login|signin|sign-in|oauth|auth/i.test(target) || isChallenge(target))) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true, webPreferences: { partition: PARTITION, sandbox: true } } };
      }
      // Links meant for a new tab open here (asking first if it's another
      // site); pop-ups and pop-unders are blocked.
      if (disposition === 'foreground-tab' || disposition === 'background-tab') this.navigateAsk(target);
      else this.bump('popups');
      return { action: 'deny' };
    });
    // Every time a page tries to take you to a different site, ask first.
    wc.on('will-navigate', (e) => {
      if (!e.isMainFrame) return;
      if (this.needsAsking(e.url)) {
        e.preventDefault();
        this.askRedirect(e.url);
      }
    });
    wc.on('will-redirect', (e) => {
      if (!e.isMainFrame || !e.isRendererInitiated) return;
      if (this.needsAsking(e.url)) {
        e.preventDefault();
        this.askRedirect(e.url);
      }
    });
    const push = () => this.sendState();
    // A new page: forget the old finds and close the drawer, so nothing from
    // the last page (or a stretched toolbar) is left behind.
    wc.on('did-navigate', () => {
      this.found = [];
      this.sendFound();
      // While Reframe is clicking through a reader page by page, its progress
      // and Stop button stay on screen.
      if (this.clicking) return;
      this.setPanel(0);
      if (this.bar && !this.bar.webContents.isDestroyed()) this.bar.webContents.send('cap:closePanel');
    });
    ['did-navigate', 'did-navigate-in-page', 'page-title-updated', 'did-start-loading', 'did-stop-loading'].forEach((ev) => wc.on(ev, push));
    ['did-navigate', 'page-title-updated', 'did-stop-loading'].forEach((ev) => wc.on(ev, () => this.checkGuard()));
    wc.on('did-finish-load', () => setTimeout(() => this.scanFrames(), 1200));
    // A page that fails (or that the ad blocker stopped) explains itself
    // instead of leaving a blank window. A site the ad blocker stopped
    // completely is let through automatically.
    wc.on('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
      if (!isMainFrame || code === -3) return;
      this.failedUrl = failedUrl;
      if (code === -20 && this.blocker && !this.autoAllowed) {
        this.autoAllowed = true;
        this.allowSite(siteOf(failedUrl), true).then(() => wc.loadURL(failedUrl).catch(() => {}));
        return;
      }
      this.bar.webContents.send('cap:failed', { code, desc, url: failedUrl, byAdblock: code === -20 });
    });
    wc.on('did-start-navigation', (e) => {
      if (e.isMainFrame && !e.isSameDocument) this.autoAllowed = false;
    });
    // Fullscreen video fills the whole window — no toolbar strip left behind.
    wc.on('enter-html-full-screen', () => {
      this.fullscreen = true;
      this.layout();
    });
    wc.on('leave-html-full-screen', () => {
      this.fullscreen = false;
      this.layout();
    });
    wc.on('context-menu', (_e, p) => this.contextMenu(p));
    // Keep looking while the page plays (players often load late).
    clearInterval(this.scanTimer);
    this.scanTimer = setInterval(() => {
      if (this.win && !this.win.isMinimized()) this.scanFrames();
    }, 5000);

    if (!this.wired) {
      this.wired = true;
      // Read-only hook, so it doesn't clash with the ad blocker's hooks.
      ses.webRequest.onResponseStarted({ urls: ['http://*/*', 'https://*/*'] }, (details) => this.consider(details));
      this.setupAdblock();
      // A site's own Download button (MEGA, MediaFire, Drive...) saves into
      // Reframe's download folder and shows up in Activity.
      ses.on('will-download', (_e, item) => {
        if (!this.onFile) return;
        if (this.saveAsPath) {
          item.setSavePath(this.saveAsPath);
          this.saveAsPath = null;
          return;
        }
        let site = 'Web';
        try {
          site = new URL(this.page.webContents.getURL()).hostname.replace(/^www\./, '');
        } catch { /* keep Web */ }
        this.onFile(item, site);
        if (this.bar && !this.bar.webContents.isDestroyed()) this.bar.webContents.send('cap:file', item.getFilename());
      });
    }
    this.go(url || 'https://www.google.com');
  }

  go(url) {
    this.allowedSite = siteOf(url);
    this.page.webContents.loadURL(url).catch(() => {});
  }

  needsAsking(target) {
    if (!this.settings().blockRedirects) return false;
    const wc = this.page.webContents;
    const from = siteOf(wc.getURL());
    const to = siteOf(target);
    if (!from || !to || from === to || to === this.allowedSite) return false;
    if (isChallenge(target) || isChallenge(wc.getURL()) || CHECK_TITLE.test(wc.getTitle())) return false;
    return true;
  }

  navigateAsk(target) {
    if (this.needsAsking(target)) this.askRedirect(target);
    else this.page.webContents.loadURL(target).catch(() => {});
  }

  askRedirect(target) {
    this.bump('redirects');
    this.blockedRedirect = target;
    this.bar.webContents.send('cap:redirect', target);
  }

  // ---------- ad blocking ----------
  // EasyList + uBlock Origin's ad, quick-fix and "unbreak" lists — the ad
  // part of uBlock Origin, without the tracker list that breaks many sites.
  // Sites you switch it off for are remembered; human checks are always allowed.
  // Starts instantly from the lists saved on disk (or the copy shipped with
  // Reframe), so it never depends on the internet to switch on. Fresh lists
  // are fetched in the background once a week; if that fails it retries.
  async setupAdblock() {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const load = (file) => ElectronBlocker.deserialize(new Uint8Array(fs.readFileSync(file)));
    for (const file of [this.adCache, this.bundledAds]) {
      if (this.lists || !file || !fs.existsSync(file)) continue;
      try {
        this.lists = load(file);
        this.listsBytes = fs.readFileSync(file);
      } catch { /* damaged or from an older version — try the next one */ }
    }
    if (this.lists) {
      this.adError = '';
      this.rebuildBlocker();
    }
    this.sendStats();
    let age = Infinity;
    try {
      age = Date.now() - fs.statSync(this.adCache).mtimeMs;
    } catch { /* no saved lists yet */ }
    if (age > 7 * 24 * 3600 * 1000) this.refreshAdLists();
  }

  async refreshAdLists() {
    clearTimeout(this.adRetry);
    try {
      const { ElectronBlocker } = require('@ghostery/adblocker-electron');
      const fresh = await ElectronBlocker.fromPrebuiltAdsOnly(fetch);
      this.listsBytes = Buffer.from(fresh.serialize());
      await fs.promises.writeFile(this.adCache, this.listsBytes);
      this.lists = fresh;
      this.adError = '';
      this.rebuildBlocker();
    } catch (e) {
      if (!this.lists) this.adError = e.message;
      // Try again in 2 minutes (e.g. the internet was down).
      this.adRetry = setTimeout(() => this.refreshAdLists(), 120000);
    }
    this.sendStats();
  }

  rebuildBlocker() {
    const { ElectronBlocker } = require('@ghostery/adblocker-electron');
    const allowed = this.settings().allowSites || [];
    // Human-check services are always allowed; switched-off sites get no
    // blocking at all on their pages.
    const exceptions = [
      ...CHALLENGE_HOSTS.flatMap((h) => [`@@||${h}^`, `@@*$domain=${h}`]),
      ...allowed.filter(Boolean).map((h) => `@@*$domain=${h}`),
    ];
    if (this.blocker) {
      try {
        this.blocker.disableBlockingInSession(this.ses);
      } catch { /* not enabled */ }
    }
    // A fresh copy of the lists each time with the allow rules added on top
    // (combining two separate lists fails, which left the blocker off).
    this.blocker = ElectronBlocker.deserialize(new Uint8Array(this.listsBytes));
    this.blocker.updateFromDiff({ added: exceptions, removed: [] });
    this.blocker.on('request-blocked', () => this.bump('ads'));
    this.blocker.on('request-redirected', () => this.bump('ads'));
    this.blockingOn = false;
    this.applyBlocking();
  }

  // On unless switched off globally — and paused while a human check is on
  // screen, so nothing can interfere with it.
  applyBlocking() {
    if (!this.blocker) return;
    const want = !!this.settings().adblock && !this.checking && !this.collecting;
    if (want === this.blockingOn) return;
    try {
      if (want) this.blocker.enableBlockingInSession(this.ses);
      else this.blocker.disableBlockingInSession(this.ses);
      this.blockingOn = want;
    } catch { /* already in that state */ }
  }

  // The ad blocker is paused while pictures are being collected: its lists
  // also catch some readers' own page pictures, which then never load.
  async whileCollecting(fn) {
    this.collecting = (this.collecting || 0) + 1;
    this.applyBlocking();
    try {
      return await fn();
    } finally {
      this.collecting -= 1;
      this.applyBlocking();
    }
  }

  checkGuard() {
    if (!this.page) return;
    const wc = this.page.webContents;
    const now = isChallenge(wc.getURL()) || CHECK_TITLE.test(wc.getTitle());
    if (now !== !!this.checking) {
      this.checking = now;
      this.applyBlocking();
      this.sendStats();
    }
  }

  async allowSite(site, on) {
    const s = this.settings();
    const list = new Set(s.allowSites || []);
    if (on) list.add(site);
    else list.delete(site);
    s.allowSites = [...list];
    this.saveSettings();
    if (this.lists) this.rebuildBlocker();
    this.sendStats();
  }

  isAdMedia(url, pageUrl) {
    if (AD_MEDIA.test(url)) return true;
    if (!this.blocker) return false;
    try {
      const { Request } = require('@ghostery/adblocker-electron');
      return this.lists.match(Request.fromRawDetails({ url, type: 'media', sourceUrl: pageUrl })).match;
    } catch {
      return false;
    }
  }

  bump(what) {
    this.stats[what] = (this.stats[what] || 0) + 1;
    clearTimeout(this.statsTimer);
    this.statsTimer = setTimeout(() => this.sendStats(), 250);
  }

  // The toolbar uses the same theme and accent colour as the main window.
  sendLook() {
    if (!this.bar || this.bar.webContents.isDestroyed() || !this.appearance) return;
    this.bar.webContents.send('cap:look', this.appearance());
  }

  sendStats() {
    if (!this.bar || this.bar.webContents.isDestroyed()) return;
    const site = this.page ? siteOf(this.page.webContents.getURL()) : '';
    const allowedHere = (this.settings().allowSites || []).includes(site);
    this.bar.webContents.send('cap:stats', {
      ...this.stats, site, allowedHere, checking: !!this.checking,
      adblock: !!(this.blocker && this.settings().adblock) && !allowedHere,
      adReady: !!this.blocker, adError: this.adError || '', blockRedirects: !!this.settings().blockRedirects,
    });
  }

  // ---------- layout ----------
  // The toolbar is exactly 58px tall, plus the drawer's measured height only
  // while the drawer is open. Nothing else can stretch it.
  setPanel(h) {
    this.panelHeight = Math.max(0, Math.min(PANEL, Math.round(Number(h) || 0)));
    this.layout();
  }

  layout() {
    if (!this.win || this.win.isDestroyed()) return;
    const { width, height } = this.win.getContentBounds();
    if (this.fullscreen) {
      this.bar.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      this.page.setBounds({ x: 0, y: 0, width, height });
      return;
    }
    this.page.setBounds({ x: 0, y: BAR, width, height: Math.max(0, height - BAR) });
    this.bar.setBounds({ x: 0, y: 0, width, height: Math.min(height, BAR + this.panelHeight) });
  }

  // ---------- finding videos ----------
  // Looks inside every frame of the page (embedded players included) for
  // video the network watcher can't see yet: <video>/<source> tags, page
  // info tags, media links in scripts and data, and embedded players.
  async scanFrames() {
    if (!this.win || !this.page) return;
    const wc = this.page.webContents;
    const frames = wc.mainFrame ? wc.mainFrame.framesInSubtree : [];
    const pageUrl = wc.getURL();
    const title = wc.getTitle();
    // Never touch a page while it's showing an "are you human" check —
    // checks treat any script poking at them as a bot and ask again.
    if (this.checking || isChallenge(pageUrl) || CHECK_TITLE.test(title)) return;
    for (const fr of frames) {
      if (isChallenge(fr.url)) continue;
      let res = null;
      try {
        res = await fr.executeJavaScript(`(() => {
          const out = [];
          const add = (u, how) => { if (u && /^https?:/i.test(u)) out.push([u, how]); };
          document.querySelectorAll('video, audio, source').forEach((v) => add(v.currentSrc || v.src || v.getAttribute('data-src'), 'player'));
          document.querySelectorAll('meta[property^="og:video"], meta[name="twitter:player:stream"]').forEach((m) => add(m.content, 'page info'));
          const text = Array.from(document.scripts).map((s) => s.textContent).join('\\n').slice(0, 3000000) + (document.documentElement ? document.documentElement.outerHTML.slice(0, 2000000) : '');
          const re = /https?:(?:\\\\?\\/){2}[^"'\\s<>()]+?\\.(?:m3u8|mpd|mp4|webm|m4v|mov|flv)(?:\\?[^"'\\s<>()]*)?/gi;
          for (const m of text.matchAll(re)) add(m[0].replace(/\\\\\\//g, '/'), 'page data');
          document.querySelectorAll('iframe').forEach((f) => { if (/youtube|vimeo|dailymotion|streamable|player|embed|video/i.test(f.src)) add(f.src, 'embedded player'); });
          return out.slice(0, 80);
        })()`);
      } catch {
        continue;
      }
      for (const [u, how] of res || []) {
        const kind = how === 'embedded player' ? 'Player' : kindOf(u, '');
        if (!kind || SEGMENT.test(u) || this.isAdMedia(u, pageUrl)) continue;
        const key = u.split('?')[0];
        if (this.found.some((f) => f.key === key)) continue;
        this.found.push({ id: `m${this.found.length + 1}`, key, url: u, kind, size: 0, type: '', how, page: pageUrl, title });
        this.sendFound();
      }
    }
  }

  // Presses play on every video so lazy players start loading their stream.
  async wake() {
    for (const fr of this.page.webContents.mainFrame.framesInSubtree) {
      if (isChallenge(fr.url)) continue;
      fr.executeJavaScript(`document.querySelectorAll('video').forEach((v) => { try { v.muted = true; v.play(); } catch (e) {} }); document.querySelectorAll('[class*="play" i], [aria-label*="play" i]').forEach((b, i) => { if (i < 3 && b.click) try { b.click(); } catch (e) {} }); true`).catch(() => {});
    }
    setTimeout(() => this.scanFrames(), 2500);
  }

  consider(d) {
    if (!this.win || !this.page || d.statusCode >= 400 || d.resourceType === 'mainFrame') return;
    const url = d.url;
    const type = header(d.responseHeaders, 'content-type');
    let kind = kindOf(url, type);
    // Some servers send video as a generic file; big ones are worth listing.
    if (!kind && /octet-stream|binary/i.test(type) && Number(header(d.responseHeaders, 'content-length')) > 3 * 1024 * 1024 && !/\.(js|css|wasm|woff2?|zip|exe|json|pdf|png|jpe?g|webp)(\?|$)/i.test(url)) kind = 'File';
    if (!kind || SEGMENT.test(url) || /mp2t/.test(type)) return;
    const pageUrl = this.page.webContents.getURL();
    if (this.isAdMedia(url, pageUrl)) return;
    const size = Number(header(d.responseHeaders, 'content-length')) || 0;
    const range = header(d.responseHeaders, 'content-range');
    const total = Number((/\/(\d+)$/.exec(range) || [])[1]) || size;
    if (kind === 'File' && total && total < 300 * 1024) return; // previews, ads, UI clips
    const key = url.split('?')[0];
    const existing = this.found.find((f) => f.key === key);
    if (existing) {
      if (total > existing.size) existing.size = total;
      return;
    }
    // A master HLS playlist lists every quality; its variants add nothing.
    if (kind === 'HLS' && this.found.some((f) => f.kind === 'HLS' && f.master)) return;
    this.found.push({
      id: `m${this.found.length + 1}`, key, url, kind, size: total, type,
      master: kind === 'HLS', page: pageUrl, title: this.page.webContents.getTitle(),
    });
    this.sendFound();
  }

  sendState() {
    if (!this.win || this.bar.webContents.isDestroyed()) return;
    const wc = this.page.webContents;
    const nav = wc.navigationHistory;
    this.bar.webContents.send('cap:state', {
      url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(),
      canBack: nav.canGoBack(), canForward: nav.canGoForward(),
    });
    this.win.setTitle(`${wc.getTitle() || 'Capture browser'} — Reframe`);
    this.sendStats();
  }

  sendFound() {
    if (this.win && !this.bar.webContents.isDestroyed()) this.bar.webContents.send('cap:found', this.found.map(({ key, ...f }) => f));
  }

  async download(what) {
    const wc = this.page.webContents;
    const cookies = await writeCookies(this.ses, this.cookieFile).catch(() => null);
    const pageUrl = wc.getURL();
    const title = wc.getTitle() || new URL(pageUrl).hostname;
    if (what === 'page') {
      return this.onDownload({ url: pageUrl, title, referer: pageUrl, cookiesFile: cookies, userAgent: UA, page: true });
    }
    if (what && typeof what === 'object' && what.url) {
      return this.onDownload({ url: what.url, title: what.title || title, referer: pageUrl, cookiesFile: cookies, userAgent: UA, page: !!what.page, kind: what.kind });
    }
    const f = this.found.find((x) => x.id === what);
    if (!f) throw new Error('That video is gone — play it again.');
    return this.onDownload({ url: f.url, title: f.title || title, referer: f.page || pageUrl, cookiesFile: cookies, userAgent: UA, kind: f.kind });
  }

  // ---------- right-click menu ----------
  // Finds everything under the cursor — even beneath invisible overlays — and
  // offers to save it: the biggest version of a picture, a video file, or the
  // real stream behind a streaming player.
  async contextMenu(p) {
    const wc = this.page.webContents;
    const items = [];
    const ref = wc.getURL();
    let media = [];
    try {
      const { mediaAt } = require('./media-at');
      media = await wc.mainFrame.executeJavaScript(`(${mediaAt.toString()})(${Number(p.x)}, ${Number(p.y)})`);
    } catch { /* fall back to what Chromium reported */ }
    if (p.srcURL && /^https?:/i.test(p.srcURL) && !media.some((m) => m.url === p.srcURL)) {
      media.unshift({ type: p.mediaType === 'image' ? 'image' : p.mediaType, url: p.srcURL });
    }
    const say = (msg) => { if (this.bar && !this.bar.webContents.isDestroyed()) this.bar.webContents.send('cap:file', msg); };
    const size = (m) => (m.w && m.h ? ` · ${m.w}×${m.h}` : '');
    const pictures = media.filter((m) => m.type === 'image' && m.url && /^https?:/i.test(m.url));
    const videos = media.filter((m) => m.type === 'video' || m.type === 'audio');

    pictures.slice(0, 4).forEach((m, i) => {
      const what = m.how === 'full-size link' ? 'Full-size picture' : m.how === 'video cover' ? 'Video cover' : m.how === 'background' ? 'Background picture' : 'Picture';
      const actions = [
        { label: 'Save', click: () => { wc.downloadURL(m.url, { headers: refHeaders(m.url, ref) }); say(fileNameOf(m.url, 'picture')); } },
        { label: 'Save as…', click: () => this.saveAs(m.url, fileNameOf(m.url, 'picture.jpg')) },
        { label: 'Copy picture', click: () => wc.copyImageAt(p.x, p.y) },
        { label: 'Copy address', click: () => clipboard.writeText(m.url) },
        { label: 'Open it on its own', click: () => this.navigateAsk(m.url) },
      ];
      if (i === 0) items.push({ label: `Save ${what.toLowerCase()}${size(m)}`, click: actions[0].click }, { label: 'Save picture as…', click: actions[1].click });
      items.push({ label: `${what}${size(m)}`, submenu: actions });
    });
    for (const v of videos.slice(0, 2)) {
      const noun = v.type === 'audio' ? 'audio' : 'video';
      if (!v.stream) {
        items.push(
          { label: `Save ${noun}${size(v)}`, click: () => this.download({ url: v.url, kind: kindOf(v.url, '') || 'File' }).then(() => say(fileNameOf(v.url, noun))).catch(() => {}) },
          { label: `Save ${noun} as…`, click: () => this.saveAs(v.url, fileNameOf(v.url, `${noun}.mp4`)) },
          { label: `Copy ${noun} address`, click: () => clipboard.writeText(v.url) },
        );
      } else {
        // A streaming player: find the real stream and save the best one.
        items.push({ label: `Save this ${noun} (stream${size(v)})`, click: () => this.saveStream() });
      }
    }
    if (media.some((m) => m.type === 'canvas') && !pictures.length) {
      items.push({ label: 'This picture is drawn by a protected viewer — it can’t be saved', enabled: false });
    }
    if (pictures.length || videos.length) {
      items.push(
        { type: 'separator' },
        { label: 'Save all pictures on this page…', click: () => this.bar.webContents.send('cap:openPanel', 'pictures') },
        { label: 'Show all videos on this page', click: () => this.bar.webContents.send('cap:openPanel', 'videos') },
        { type: 'separator' },
      );
    }
    if (p.linkURL && /^https?:/i.test(p.linkURL)) {
      items.push(
        { label: 'Open link', click: () => this.navigateAsk(p.linkURL) },
        { label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) },
        { label: 'Download link with Reframe', click: () => this.download({ url: p.linkURL, page: true, title: p.linkText || '' }).catch(() => {}) },
        { label: 'Save pictures from link (comic)', click: () => this.picturesFromLinks([p.linkURL], true).catch(() => {}) },
        { type: 'separator' },
      );
    }
    if (p.isEditable) items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' });
    else if (p.selectionText) items.push({ role: 'copy' }, { label: 'Search for it', click: () => this.go(`https://www.google.com/search?q=${encodeURIComponent(p.selectionText)}`) }, { type: 'separator' });
    items.push(
      { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
      { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
      { label: 'Reload', click: () => wc.reload() },
      { label: 'Download this page with Reframe', click: () => this.download('page').catch(() => {}) },
    );
    Menu.buildFromTemplate(items).popup({ window: this.win });
  }

  // Wakes the players, scans the page, then saves the best stream found
  // (a master HLS playlist beats single files; bigger beats smaller).
  async saveStream() {
    const say = (msg) => this.bar.webContents.send('cap:note', msg);
    say('Looking for the stream…');
    await this.wake();
    await new Promise((r) => setTimeout(r, 3000));
    await this.scanFrames();
    const best = [...this.found].sort((a, b) => (b.master ? 1 : 0) - (a.master ? 1 : 0) || (b.size || 0) - (a.size || 0))[0];
    if (!best) {
      say('No stream found yet — press play, then try again.');
      this.bar.webContents.send('cap:openPanel', 'videos');
      return;
    }
    await this.download(best.id);
    say(`Saving “${best.title || 'video'}” — follow it in Reframe’s Activity.`);
  }

  async saveAs(url, name) {
    const r = await dialog.showSaveDialog(this.win, { defaultPath: name });
    if (r.canceled || !r.filePath) return;
    this.saveAsPath = r.filePath;
    this.page.webContents.downloadURL(url, { headers: refHeaders(url, this.page.webContents.getURL()) });
  }

  // ---------- pictures ----------
  // Scrolls through a page (so lazy-loaded pictures appear) and lists every
  // real picture in reading order — see picture-scan.js.
  async collectPictures(wc) {
    const { pageScan } = require('./picture-scan');
    return wc.executeJavaScript(`(${pageScan.toString()})(${JSON.stringify({ scroll: true })})`, true);
  }

  async findPictures() {
    const wc = this.page.webContents;
    const r = await this.whileCollecting(async () => {
      // Pictures the blocker stopped before the pause show as broken: load
      // the page again (once) so they come in.
      const broken = await wc.executeJavaScript(
        'Array.from(document.images).filter((i) => i.complete && !i.naturalWidth && /^https?:/.test(i.currentSrc || i.src) && i.getBoundingClientRect().width > 100).length',
        true,
      ).catch(() => 0);
      if (broken) {
        wc.reload();
        await new Promise((res) => {
          const t = setTimeout(res, 30000);
          wc.once('did-stop-loading', () => { clearTimeout(t); res(); });
        });
        await new Promise((res) => setTimeout(res, 2500));
      }
      return this.collectPictures(wc);
    });
    this.pictures = r;
    return { title: r.title, count: r.images.length, sample: r.images.slice(0, 12).map((i) => i.url), sizes: r.images.slice(0, 1).map((i) => `${i.w}×${i.h}`)[0] || '', paged: r.images.length <= 3 };
  }

  // Pictures read straight out of a page (blob:, data:, canvas) are kept here
  // until the comic is saved, because they can't be downloaded again.
  stash(images) {
    this.inline = this.inline || new Map();
    return images.map(({ data, type, ...p }) => {
      if (data) this.inline.set(p.url, { data, type });
      return p;
    });
  }

  // Reads the given pictures out of the page's memory now, while it's still
  // loaded, so saving them later needs no second download.
  async remember(wc, pics) {
    const { grabLoaded } = require('./page-turner');
    this.inline = this.inline || new Map();
    let urls = pics.map((p) => p.url).filter((u) => /^https?:/i.test(u) && !this.inline.has(u));
    // A page that's still downloading isn't in memory yet: give it a moment.
    for (let t = 0; t < 4 && urls.length; t++) {
      if (t) await new Promise((r) => setTimeout(r, 700));
      for (const [u, v] of await grabLoaded(wc, urls)) this.inline.set(u, v);
      urls = urls.filter((u) => !this.inline.has(u));
    }
  }

  // A second session with no ad blocker, used only to re-download a picture
  // that wasn't in the page's memory. It sends the Capture browser's own
  // cookies and browser ID, so the site sees the same visitor.
  async cleanFetch(u, referer) {
    if (!this.fetchSes) this.fetchSes = session.fromPartition('reframe-picture-fetch');
    const cookies = (await this.ses.cookies.get({ url: u }).catch(() => [])).map((c) => `${c.name}=${c.value}`).join('; ');
    const headers = { ...refHeaders(u, referer), 'User-Agent': this.ses.getUserAgent() || UA, Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' };
    if (cookies) headers.Cookie = cookies;
    try {
      return await this.fetchSes.fetch(u, { headers });
    } catch (e) {
      // Some servers still won't take the page address: try once without it.
      delete headers.Referer;
      return this.fetchSes.fetch(u, { headers });
    }
  }

  fetcherFor(referer) {
    return (u) => {
      const kept = this.inline && this.inline.get(u);
      if (kept) {
        this.inline.delete(u);
        return Promise.resolve(new Response(kept.data, { headers: { 'content-type': kept.type || 'image/jpeg' } }));
      }
      return this.cleanFetch(u, referer);
    };
  }

  async savePictures(cbz) {
    const r = this.pictures;
    if (!r || !r.images.length) throw new Error('No pictures found on this page.');
    await this.remember(this.page.webContents, r.images);
    this.releaseDebugger(this.page.webContents);
    let site = 'Web';
    try {
      site = new URL(r.url).hostname.replace(/^www\./, '');
    } catch { /* keep Web */ }
    return this.onPictures({ title: r.title || site, site, images: r.images, cbz, fetcher: this.fetcherFor(r.url) });
  }

  hiddenWindow() {
    this.getSession();
    const w = new BrowserWindow({ show: false, width: 1280, height: 1600, webPreferences: { partition: PARTITION, sandbox: true, backgroundThrottling: false } });
    w.webContents.setAudioMuted(true);
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    return w;
  }

  async loadIn(w, u) {
    await Promise.race([w.loadURL(u).catch(() => {}), new Promise((r) => setTimeout(r, 30000))]);
    // Readers keep building themselves after the page has "loaded": wait
    // until the pictures and the page length stop changing (up to 10 s).
    const sig = () => w.webContents.executeJavaScript(
      'Array.from(document.images).filter((i) => i.complete && i.naturalWidth > 100).length + ":" + document.documentElement.scrollHeight + ":" + document.querySelectorAll("*").length',
      true,
    ).catch(() => '');
    let last = '';
    let same = 0;
    for (let t = 0; t < 20 && same < 3; t++) {
      await new Promise((r) => setTimeout(r, 500));
      const now = await sig();
      same = now && now === last ? same + 1 : 0;
      last = now;
    }
  }

  // One-picture-per-page readers: follow "Next" links from page to page, or,
  // for readers that change page in place (arrow buttons, arrow keys,
  // clicking the side of the page), keep turning — see page-turner.js.
  collectPaged(cbz, onProgress) {
    return this.whileCollecting(() => this.collectPagedNow(cbz, onProgress));
  }

  async collectPagedNow(cbz, onProgress) {
    const start = this.page.webContents.getURL();
    const w = this.hiddenWindow();
    let got;
    try {
      got = await this.gatherPaged(w, start, onProgress, this.page.webContents.getTitle());
    } finally {
      w.destroy();
    }
    if (!got.images.length) throw new Error('No pages found. Open the first page of a chapter (not the chapter list) and try again.');
    this.onPictures({ title: got.title, site: hostOf(start), images: this.stash(got.images), cbz, fetcher: this.fetcherFor(start) });
    return got.images.length;
  }

  // Gathers every page of a one-page-at-a-time reader in the hidden window
  // `w`: follows "Next" links, or turns pages in place (page-turner.js).
  // Each page's picture is read from memory as soon as it shows.
  // `followLinks: false` keeps it on this one page (turning pages in place),
  // so a "next episode" link can't walk off through a whole series.
  async gatherPaged(w, start, onProgress, fallbackTitle = '', { followLinks = true } = {}) {
    const { turnPages, onScreen } = require('./page-turner');
    const images = [];
    const seenPages = new Set();
    const seenImgs = new Set();
    const keep = async (pics) => {
      const fresh = pics.filter((p) => !seenImgs.has(p.url));
      for (const p of fresh) {
        seenImgs.add(p.url);
        images.push(p);
      }
      await this.remember(w.webContents, fresh);
    };
    let url = start;
    let title = fallbackTitle;
    for (let i = 0; i < 500 && url && !seenPages.has(url); i++) {
      seenPages.add(url);
      if (onProgress) onProgress(images.length + 1);
      await this.loadIn(w, url);
      const r = await this.collectPictures(w.webContents).catch(() => null);
      if (!r) break;
      if (i === 0) title = r.title || title;
      // The page's picture (or both pages of a two-page spread).
      await keep(await onScreen(w.webContents));
      url = followLinks && r.next && siteOf(r.next) === siteOf(start) ? r.next : null;
      // No "Next" link on the very first page: the reader turns pages in place.
      if (!url && i === 0) {
        await turnPages(w, images, seenImgs, onProgress, { sameSite: (u) => siteOf(u) === siteOf(start), onFresh: (pics) => this.remember(w.webContents, pics) });
        break;
      }
    }
    return { title, images };
  }

  releaseDebugger(wc) {
    try {
      if (!this.clicking && wc.debugger.isAttached()) wc.debugger.detach();
    } catch { /* already gone */ }
  }

  // ---------- "I click Next" readers ----------
  // The person shows Reframe the reader's Next and Previous buttons (the page
  // doesn't react to those clicks), then Reframe clicks Next itself, in the
  // visible page, saving each new picture until the pages stop changing.
  async pickControls() {
    const { pickControls } = require('./page-turner');
    const wc = this.page.webContents;
    wc.focus();
    const c = await wc.executeJavaScript(`(${pickControls.toString()})()`, true).catch(() => null);
    if (c) {
      this.controlsBySite = this.controlsBySite || {};
      this.controlsBySite[siteOf(wc.getURL())] = c;
    }
    return c;
  }

  cancelPick() {
    if (this.page) this.page.webContents.executeJavaScript('window.__reframeCancelPick && window.__reframeCancelPick()', true).catch(() => {});
  }

  lastControls() {
    return (this.controlsBySite || {})[siteOf(this.page.webContents.getURL())] || null;
  }

  async clickThrough({ controls, fromStart = false, cbz = true }, onProgress) {
    const wc = this.page.webContents;
    const start = wc.getURL();
    this.stopClicking = false;
    this.clicking = true;
    try {
      return await this.whileCollecting(() => this.clickPages(wc, controls, fromStart, cbz, onProgress, start));
    } finally {
      this.clicking = false;
      try {
        if (wc.debugger.isAttached()) wc.debugger.detach();
      } catch { /* already gone */ }
    }
  }

  async clickPages(wc, controls, fromStart, cbz, onProgress, start) {
    const { onScreen, clickControl, waitForNew } = require('./page-turner');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const keyOf = (pics) => pics.map((p) => p.url).join('|');
    // Go back to the first page first, if asked: press Back until nothing changes.
    if (fromStart && controls.prev) {
      let last = keyOf(await onScreen(wc));
      for (let i = 0, same = 0; i < 500 && same < 2 && !this.stopClicking; i++) {
        if (!(await clickControl(wc, controls.prev))) break; // no Back button: this is page 1
        await sleep(1100);
        const now = keyOf(await onScreen(wc));
        if (now === last) same++;
        else same = 0;
        last = now;
        if (onProgress) onProgress({ phase: 'rewind', n: i + 1 });
      }
    }
    const title = wc.getTitle();
    const images = [];
    const seen = new Set();
    const keep = async (pics) => {
      const fresh = pics.filter((p) => !seen.has(p.url));
      for (const p of fresh) {
        seen.add(p.url);
        images.push(p);
      }
      await this.remember(wc, fresh);
      if (onProgress) onProgress({ phase: 'collect', n: images.length });
    };
    await keep(await onScreen(wc));
    for (let stuck = 0; images.length < 2000 && stuck < 2 && !this.stopClicking;) {
      if (!(await clickControl(wc, controls.next))) break; // no Next button: last page
      // Pages that load a new address need longer than ones that swap in place.
      const fresh = await waitForNew(wc, seen, 18);
      if (fresh.length && siteOf(wc.getURL()) === siteOf(start)) {
        await keep(fresh);
        stuck = 0;
      } else stuck++;
    }
    if (!images.length) throw new Error('No pages found. Pick the buttons again and make sure the picture is on screen.');
    let site = 'Web';
    try {
      site = new URL(start).hostname.replace(/^www./, '');
    } catch { /* keep Web */ }
    this.onPictures({ title, site, images: this.stash(images), cbz, fetcher: this.fetcherFor(start) });
    return images.length;
  }

  // For a list of links (e.g. chapters from a .txt file): open each one in a
  // hidden page, collect its pictures and save them, one comic per link.
  picturesFromLinks(urls, cbz, onProgress) {
    return this.whileCollecting(() => this.picturesFromLinksNow(urls, cbz, onProgress));
  }

  async picturesFromLinksNow(urls, cbz, onProgress) {
    this.getSession();
    const w = this.hiddenWindow();
    let saved = 0;
    try {
      for (const [i, u] of urls.entries()) {
        if (onProgress) onProgress(i, urls.length);
        await this.loadIn(w, u);
        const r = await this.collectPictures(w.webContents).catch(() => null);
        if (!r || !r.images.length) continue;
        const site = hostOf(u);
        let images = r.images;
        let title = r.title || `${site} ${i + 1}`;
        // Nobody's here to say how the reader works, so: keep what scrolling
        // found, and if the page has a Next / flip control (or shows only a
        // page or two), also try turning pages. The bigger haul wins.
        await this.remember(w.webContents, images);
        const { findTurnControls } = require('./page-turner');
        const controls = await w.webContents.executeJavaScript(`(${findTurnControls.toString()})()`, true).catch(() => ({}));
        if (images.length <= 3 || (controls && controls.next)) {
          // A link that already scrolls to several pages is one chapter: only
          // turn pages in place there, never follow links off to other pages.
          const got = await this.gatherPaged(w, u, null, title, { followLinks: images.length <= 3 });
          const loser = got.images.length > images.length ? images : got.images;
          if (got.images.length > images.length) ({ images, title } = got);
          const keepUrls = new Set(images.map((p) => p.url));
          for (const p of loser) if (!keepUrls.has(p.url) && this.inline) this.inline.delete(p.url);
        }
        this.onPictures({ title, site, images: this.stash(images), cbz, fetcher: this.fetcherFor(u) });
        saved++;
      }
    } finally {
      w.destroy();
    }
    return saved;
  }

  // ---------- previews ----------
  // Thumbnail + length/resolution for a found video, made by FFmpeg with the
  // page's cookies and referrer so protected CDNs answer.
  async preview(id) {
    const f = this.found.find((x) => x.id === id);
    if (!f) return null;
    if (f.preview) return f.preview;
    if (f.kind === 'Player') return { thumb: null, duration: 0, width: 0, height: 0 };
    const info = { thumb: null, duration: 0, width: 0, height: 0 };
    const ff = this.ffmpeg();
    if (!ff) return info;
    const cookies = (await this.ses.cookies.get({ url: f.url }).catch(() => [])).map((c) => `${c.name}=${c.value}`).join('; ');
    const headers = `Referer: ${f.page}\r\n${cookies ? `Cookie: ${cookies}\r\n` : ''}`;
    const common = ['-user_agent', UA, '-headers', headers];
    await fs.promises.mkdir(this.previewDir, { recursive: true });
    const out = path.join(this.previewDir, `${id}-${Date.now()}.jpg`);
    const { run } = require('./tools');
    const probe = await run(ff.probe, ['-v', 'error', ...common, '-show_entries', 'format=duration:stream=width,height,codec_type', '-of', 'json', f.url], { timeout: 30000 });
    try {
      const j = JSON.parse(probe.stdout);
      info.duration = Number(j.format && j.format.duration) || 0;
      const v = (j.streams || []).filter((s) => s.codec_type === 'video').sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      if (v) Object.assign(info, { width: v.width || 0, height: v.height || 0 });
    } catch { /* keep zeros */ }
    const at = info.duration ? Math.min(info.duration * 0.15, 30) : 1;
    const t = await run(ff.ffmpeg, ['-y', '-v', 'error', ...common, '-ss', String(at), '-i', f.url, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '5', out], { timeout: 45000 });
    if (t.ok && fs.existsSync(out)) {
      info.thumb = `data:image/jpeg;base64,${(await fs.promises.readFile(out)).toString('base64')}`;
      fs.promises.rm(out, { force: true });
    }
    // Short clips from another site playing before the real video are ads.
    if (info.duration && info.duration < 35 && siteOf(f.url) !== siteOf(f.page) && this.found.length > 1) info.likelyAd = true;
    f.preview = info;
    return info;
  }

  // Lets the toolbar's preview player load a video (or HLS pieces) with the
  // page's cookies and referrer. Only answers while the Capture browser is open.
  async proxy(target, request) {
    if (!this.win || !this.ses || !/^https?:\/\//i.test(target)) return new Response('Not available', { status: 404 });
    const headers = { ...refHeaders(target, this.page.webContents.getURL()), 'User-Agent': this.ses.getUserAgent() || UA };
    const range = request.headers.get('range');
    if (range) headers.Range = range;
    const res = await this.ses.fetch(target, { headers });
    const out = new Headers();
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) if (res.headers.get(k)) out.set(k, res.headers.get(k));
    return new Response(res.body, { status: res.status, headers: out });
  }

  registerIpc() {
    const own = (e) => this.bar && !this.bar.webContents.isDestroyed() && e.sender === this.bar.webContents;
    const h = (ch, fn) => ipcMain.handle(ch, (e, arg) => (own(e) ? fn(arg) : null));
    h('cap:preview', (id) => this.preview(id));
    h('cap:pictures', () => this.findPictures());
    h('cap:pickControls', () => this.pickControls());
    h('cap:cancelPick', () => this.cancelPick());
    h('cap:lastControls', () => this.lastControls());
    h('cap:clickThrough', (opts) => this.clickThrough(opts || {}, (p) => this.bar.webContents.send('cap:clickProgress', p)));
    h('cap:stopClicking', () => { this.stopClicking = true; });
    h('cap:paged', (cbz) => this.collectPaged(cbz !== false, (n) => this.bar.webContents.send('cap:pagedProgress', n)));
    h('cap:wake', () => this.wake());
    h('cap:savePictures', (cbz) => this.savePictures(!!cbz));
    h('cap:download', (what) => this.download(what));
    h('cap:panel', (height) => this.setPanel(height));
    h('cap:retry', async (withoutAds) => {
      if (!this.failedUrl) return;
      if (withoutAds) await this.allowSite(siteOf(this.failedUrl), true);
      this.page.webContents.loadURL(this.failedUrl).catch(() => {});
    });
    h('cap:bookmark', () => {
      if (!this.onBookmark) return null;
      const wc = this.page.webContents;
      return this.onBookmark(wc.getTitle() || new URL(wc.getURL()).hostname, wc.getURL());
    });
    // The shield turns ad blocking off/on for the current site only.
    h('cap:toggle', async (what) => {
      if (what === 'adblock') {
        const site = siteOf(this.page.webContents.getURL());
        const allowed = (this.settings().allowSites || []).includes(site);
        if (!this.settings().adblock) {
          this.settings().adblock = true;
          this.saveSettings();
          this.applyBlocking();
        } else await this.allowSite(site, !allowed);
        this.page.webContents.reload();
      } else if (what === 'redirects') {
        this.settings().blockRedirects = !this.settings().blockRedirects;
        this.saveSettings();
      }
      this.sendStats();
      return true;
    });
    h('cap:allowRedirect', () => {
      if (!this.blockedRedirect) return;
      const u = this.blockedRedirect;
      this.blockedRedirect = null;
      this.allowedSite = siteOf(u);
      this.page.webContents.loadURL(u).catch(() => {});
    });
    h('cap:go', (url) => {
      let u = String(url || '').trim();
      if (!/^https?:\/\//i.test(u)) u = /\s/.test(u) || !/\./.test(u) ? `https://www.google.com/search?q=${encodeURIComponent(u)}` : `https://${u}`;
      this.go(u);
    });
    h('cap:nav', (cmd) => {
      const wc = this.page.webContents;
      if (cmd === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
      if (cmd === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
      if (cmd === 'reload') wc.reload();
    });
    h('cap:hello', () => {
      this.setPanel(0);
      this.sendLook();
      this.sendState();
      this.sendFound();
      this.sendStats();
      return true;
    });
  }
}

module.exports = { Capture, kindOf, writeCookies, siteOf };
