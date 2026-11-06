'use strict';
// Downloads: online videos from a link (yt-dlp, with a direct-download
// fallback) and files from media servers (Plex, Jellyfin).
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { isVideo } = require('./engine');
const { sniff, fixExtension } = require('./filetype');

// GIF sites: the address of the real GIF (not the site's video copy of it).
// Giphy and Tenor pages both serve a small video by default, and Tenor even
// sends a video for some ".gif" addresses.
async function gifSource(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '');
  // giphy.com/gifs/some-name-ID, /stickers/..., /embed/ID, media*.giphy.com/media/.../ID/giphy.mp4
  if (/(^|\.)giphy\.com$/.test(host)) {
    const parts = u.pathname.split('/').filter(Boolean);
    let id = null;
    if (/^(gifs|stickers|embed|clips)$/.test(parts[0]) && parts[1]) id = parts[1].split('-').pop();
    else if (parts[0] === 'media' && parts.length >= 3) id = parts[parts.length - 2];
    if (id && /^[A-Za-z0-9]+$/.test(id)) return `https://media.giphy.com/media/${id}/giphy.gif`;
    return null;
  }
  // media.tenor.com/<code>/<name>.<ext>: the code's ending picks the format; AAAAC is the GIF.
  if (/(^|\.)tenor\.com$/.test(host) && /^media\d*\.tenor\.com$/.test(u.hostname)) {
    const m = /^\/(m\/)?([A-Za-z0-9_-]+?)AAA[A-Za-z0-9]{2}\/([^/]+?)(\.[a-z0-9]+)?$/.exec(u.pathname);
    if (m) return `https://media.tenor.com/${m[2]}AAAAC/${m[3]}.gif`;
    return null;
  }
  // tenor.com/view/...: the page names its GIF.
  if (/(^|\.)tenor\.com$/.test(host) && /^\/(\w{2}(-\w{2})?\/)?view\//.test(u.pathname)) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36' } });
      const html = await res.text();
      const m = /<meta[^>]+property="og:image"[^>]+content="([^"]+\.gif)"/i.exec(html) || /<meta[^>]+content="([^"]+\.gif)"[^>]+property="og:image"/i.exec(html);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }
  return null;
}

let seq = 1;
const uid = () => `dl${Date.now().toString(36)}${(seq++).toString(36)}`;

const QUALITY = {
  best: { sort: 'res,fps', label: 'Best available' },
  2160: { sort: 'res:2160,fps', label: '4K' },
  1080: { sort: 'res:1080,fps', label: '1080p' },
  720: { sort: 'res:720,fps', label: '720p' },
  480: { sort: 'res:480,fps', label: '480p' },
  audio: { label: 'Audio only' },
};

function safeName(name) {
  return String(name || 'video').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 150) || 'video';
}

// A comic's name from its page title, without the site's own tail
// ("Chapter 3 | SomeSite", "Book : Free Download ... : Internet Archive").
function tidyTitle(title, site) {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  const word = String(site || '').replace(/^www\./, '').split('.')[0].toLowerCase();
  for (let i = 0; i < 4; i++) {
    const m = /^(.+?)\s+(?:[|·•–—:]|-|::)\s+([^|·•–—:]+)$/.exec(t);
    if (!m) break;
    const tail = m[2].toLowerCase();
    const siteish = (word && tail.replace(/[^a-z0-9]/g, '').includes(word)) || /free download|read online|online free|streaming|official site/.test(tail);
    if (!siteish) break;
    t = m[1].trim();
  }
  return (t || site || 'Comic').slice(0, 100).trim();
}

function nameFromResponse(res, url) {
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
  if (m) return decodeURIComponent(m[1] || m[2]);
  try {
    const last = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop() || '');
    if (last) return last;
  } catch { /* fall through */ }
  return '';
}

// Turns a cloud-drive share link into a link to the file itself.
function driveDirect(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (/(^|\.)dropbox(usercontent)?\.com$/.test(host)) {
      u.searchParams.set('dl', '1');
      return u.toString();
    }
    if (host === '1drv.ms' || /(^|\.)onedrive\.live\.com$/.test(host)) {
      const b64 = Buffer.from(url).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
      return `https://api.onedrive.com/v1.0/shares/u!${b64}/root/content`;
    }
    if (host === 'drive.google.com') {
      const id = (/\/file\/d\/([^/]+)/.exec(u.pathname) || [])[1] || u.searchParams.get('id');
      if (id) return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
    }
  } catch { /* not a URL */ }
  return url;
}

// Last resort when no extractor knows a site: read the page and keep only
// the video. Returns candidates best-first, plus the page title/thumbnail.
const SCRAPE_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
async function scrapePage(pageUrl) {
  const res = await fetch(pageUrl, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': SCRAPE_UA, Accept: 'text/html,*/*' } });
  const type = res.headers.get('content-type') || '';
  if (!res.ok || !/html|xml|text/.test(type)) return null;
  const html = (await res.text()).slice(0, 4 * 1024 * 1024);
  const base = res.url || pageUrl;
  const abs = (u) => {
    try {
      return new URL(u.replace(/\\\//g, '/').replace(/&amp;/g, '&').replace(/\\u002[fF]/g, '/'), base).toString();
    } catch {
      return null;
    }
  };
  const found = new Map();
  const add = (u, score, how) => {
    const a = u && abs(u);
    if (!a || !/^https?:/i.test(a) || /\b(ads?|advert|promo|preroll|teaser|preview|thumb|sprite|blank)\b/i.test(a)) return;
    const prev = found.get(a);
    if (!prev || prev.score < score) found.set(a, { url: a, score, how });
  };
  const attr = (tag, name) => (new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag) || [])[1];
  for (const m of html.matchAll(/<(video|source)\b[^>]*>/gi)) add(attr(m[0], 'src') || attr(m[0], 'data-src'), 90, 'video tag');
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const prop = (attr(m[0], 'property') || attr(m[0], 'name') || '').toLowerCase();
    if (/^(og:video(:secure_url|:url)?|twitter:player:stream)$/.test(prop)) add(attr(m[0], 'content'), 85, 'page info');
  }
  for (const m of html.matchAll(/"(?:contentUrl|embedUrl)"\s*:\s*"([^"]+)"/gi)) add(m[1], 80, 'page data');
  for (const m of html.matchAll(/["'](https?:)?(\\?\/\\?\/[^"'\s]+?\.(m3u8|mpd|mp4|webm|m4v|mov)(\?[^"'\s]*)?)["']/gi)) {
    const ext = m[3].toLowerCase();
    add((m[1] || 'https:') + m[2], ext === 'm3u8' || ext === 'mpd' ? 75 : 70, 'link in page');
  }
  for (const m of html.matchAll(/<iframe\b[^>]*>/gi)) {
    const src = attr(m[0], 'src') || attr(m[0], 'data-src');
    if (src && /player|embed|video|youtube|vimeo|dailymotion|streamable|jwplayer|brightcove|wistia/i.test(src)) add(src, 60, 'embedded player');
  }
  const list = [...found.values()].map((c) => {
    let score = c.score;
    if (/2160|4k/i.test(c.url)) score += 6;
    else if (/1080/.test(c.url)) score += 5;
    else if (/720/.test(c.url)) score += 3;
    if (/\b(240|360)p?\b/.test(c.url)) score -= 3;
    return { ...c, score, kind: /\.m3u8/i.test(c.url) ? 'HLS' : /\.mpd/i.test(c.url) ? 'DASH' : c.how === 'embedded player' ? 'Player' : 'File' };
  }).sort((a, b) => b.score - a.score);
  const title = ((/<title[^>]*>([^<]{1,200})/i.exec(html) || [])[1] || '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
  const og = (name) => (new RegExp(`<meta[^>]+property=["']${name}["'][^>]+content=["']([^"']+)`, 'i').exec(html) || [])[1];
  return { pageUrl: base, title: og('og:title') || title || new URL(base).hostname, thumbnail: og('og:image') ? abs(og('og:image')) : '', candidates: list.slice(0, 8) };
}

async function uniquePath(p) {
  const { dir, name, ext } = path.parse(p);
  let out = p;
  for (let n = 2; fs.existsSync(out); n++) out = path.join(dir, `${name} (${n})${ext}`);
  return out;
}

class Transfers extends EventEmitter {
  constructor({ tools, getSettings }) {
    super();
    this.tools = tools;
    this.getSettings = getSettings;
    this.jobs = [];
    this.timers = new Map();
  }

  list() {
    return this.jobs.map((j) => this.snapshot(j));
  }

  snapshot(job) {
    const { child, abort, log, fetcher, ...rest } = job;
    return { ...rest, items: job.items ? job.items.map(({ headers, url, ...i }) => i) : undefined };
  }

  emitJob(job, now = false) {
    if (now) {
      clearTimeout(this.timers.get(job.id));
      this.timers.delete(job.id);
      this.emit('update', this.snapshot(job));
      return;
    }
    if (this.timers.has(job.id)) return;
    this.timers.set(job.id, setTimeout(() => {
      this.timers.delete(job.id);
      this.emit('update', this.snapshot(job));
    }, 200));
  }

  isBusy() {
    return this.jobs.some((j) => j.status === 'queued' || j.status === 'running');
  }

  // ---------- link lookups ----------
  async inspect(url, { cookiesBrowser } = {}) {
    if (!/^https?:\/\//i.test(url)) throw new Error('Paste a full link starting with http:// or https://');
    if (this.tools.hasYtdlp()) {
      const args = ['-J', '--flat-playlist', '--no-warnings', '--no-colors'];
      if (cookiesBrowser) args.push('--cookies-from-browser', cookiesBrowser);
      args.push(url);
      const r = await new Promise((resolve) => {
        const c = spawn(this.tools.ytdlpPath, args, { windowsHide: true });
        let out = '';
        let err = '';
        c.stdout.on('data', (d) => { out += d; });
        c.stderr.on('data', (d) => { err += d; });
        c.on('close', (code) => resolve({ code, out, err }));
        c.on('error', (e) => resolve({ code: -1, out: '', err: e.message }));
        setTimeout(() => c.kill(), 60000);
      });
      if (r.code === 0) {
        try {
          const j = JSON.parse(r.out);
          const isList = j._type === 'playlist';
          const heights = [...new Set((j.formats || []).map((f) => f.height).filter(Boolean))].sort((a, b) => b - a);
          return {
            via: 'ytdlp',
            title: j.title || j.id || 'Video',
            uploader: j.uploader || j.channel || j.uploader_id || '',
            site: j.extractor_key && !/^generic$/i.test(j.extractor_key) ? j.extractor_key : new URL(url).hostname.replace(/^www\./, ''),
            duration: j.duration || 0,
            thumbnail: j.thumbnail || (j.thumbnails && j.thumbnails.length ? j.thumbnails[j.thumbnails.length - 1].url : '') || '',
            playlist: isList ? (j.entries || []).length : 0,
            heights,
            webpage: j.webpage_url || url,
          };
        } catch { /* fall back to direct */ }
      }
      const direct = await this.inspectDirect(url).catch(() => null);
      if (direct) return direct;
      const scraped = await this.inspectScrape(url);
      if (scraped) return scraped;
      throw new Error(`${friendlyYtdlpError(r.err)} No video was found in the page either — try the Capture browser, which catches videos as they play.`);
    }
    const direct = await this.inspectDirect(url).catch(() => null);
    if (direct) return direct;
    const scraped = await this.inspectScrape(url);
    if (scraped) return scraped;
    throw new Error('No video found at this link. Set up the downloader (button below) for 1,700+ sites, or open it in the Capture browser.');
  }

  // The address of the file yt-dlp picks for a link (its own download is
  // skipped), so it can be fetched with ordinary headers.
  async mediaUrl(url) {
    if (!this.tools.hasYtdlp()) return null;
    const r = await new Promise((resolve) => {
      const c = spawn(this.tools.ytdlpPath, ['-J', '--no-playlist', '--no-warnings', '--no-colors', url], { windowsHide: true });
      let out = '';
      c.stdout.on('data', (d) => { out += d; });
      c.on('close', (code) => resolve({ code, out }));
      c.on('error', () => resolve({ code: -1, out: '' }));
      setTimeout(() => c.kill(), 60000);
    });
    if (r.code !== 0) return null;
    try {
      const j = JSON.parse(r.out);
      if (j.url) return j.url;
      const f = (j.requested_downloads || [])[0] || [...(j.formats || [])].reverse().find((x) => x.url && x.vcodec !== 'none');
      return f ? f.url : null;
    } catch {
      return null;
    }
  }

  async inspectScrape(url) {
    const s = await scrapePage(url).catch(() => null);
    if (!s || !s.candidates.length) return null;
    return {
      via: 'scrape', title: s.title, uploader: '', site: new URL(s.pageUrl).hostname.replace(/^www\./, ''), duration: 0,
      thumbnail: s.thumbnail, playlist: 0, heights: [], webpage: url,
      found: s.candidates.map((c) => `${c.kind} · ${c.how}`),
    };
  }

  async inspectDirect(url) {
    const drive = driveDirect(url) !== url;
    url = driveDirect(url);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 Reframe' } });
    clearTimeout(t);
    ctrl.abort();
    const type = res.headers.get('content-type') || '';
    const name = nameFromResponse(res, res.url || url);
    if (!res.ok || !(drive || type.startsWith('video/') || (name && isVideo(name)))) return null;
    return {
      via: 'direct',
      title: path.parse(name).name || 'video',
      uploader: '',
      site: new URL(res.url || url).hostname,
      duration: 0,
      thumbnail: '',
      playlist: 0,
      heights: [],
      size: Number(res.headers.get('content-length')) || 0,
      webpage: url,
    };
  }

  // ---------- jobs ----------
  addUrl(opts) {
    const job = {
      id: uid(),
      kind: 'download',
      type: 'url',
      url: opts.url,
      title: opts.info ? opts.info.title : opts.url,
      site: opts.info ? opts.info.site : '',
      thumbnail: opts.info ? opts.info.thumbnail : '',
      via: opts.info ? opts.info.via : 'ytdlp',
      quality: opts.quality || 'best',
      playlist: !!opts.playlist,
      cookiesBrowser: opts.cookiesBrowser || '',
      cookiesFile: opts.cookiesFile || '',
      referer: opts.referer || '',
      userAgent: opts.userAgent || '',
      fixedTitle: opts.fixedTitle || '',
      subtitles: !!opts.subtitles,
      outDir: opts.outDir,
      after: opts.after || {},
      status: 'queued',
      progress: 0,
      speed: '',
      eta: '',
      phase: '',
      files: [],
      error: '',
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      log: [],
    };
    this.jobs.push(job);
    this.emitJob(job, true);
    this.pump();
    return job.id;
  }

  addFiles({ title, site, outDir, files, after }) {
    const job = {
      id: uid(),
      kind: 'download',
      type: 'server',
      title,
      site,
      outDir,
      after: after || {},
      status: 'queued',
      progress: 0,
      speed: '',
      eta: '',
      phase: '',
      files: [],
      error: '',
      totalBytes: files.reduce((n, f) => n + (f.size || 0), 0),
      items: files.map((f, i) => ({ id: `f${i}`, url: f.url, headers: f.headers || {}, rel: f.rel, size: f.size || 0, status: 'queued', done: 0, error: '' })),
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      log: [],
    };
    this.jobs.push(job);
    this.emitJob(job, true);
    this.pump();
    return job.id;
  }

  async pump() {
    if (this.jobs.some((j) => j.status === 'running')) return;
    const job = this.jobs.find((j) => j.status === 'queued');
    if (!job) return;
    job.status = 'running';
    job.startedAt = Date.now();
    this.emitJob(job, true);
    try {
      await fsp.mkdir(job.outDir, { recursive: true });
      if (job.type === 'url') await this.runUrl(job);
      else if (job.type === 'images') await this.runImages(job);
      else await this.runServer(job);
      // Every file gets the extension that matches what's really inside.
      for (let i = 0; i < job.files.length; i++) job.files[i] = (await fixExtension(job.files[i])).file;
      if (job.status === 'running') job.status = job.items && job.items.some((i) => i.status === 'failed') ? (job.files.length ? 'partial' : 'failed') : 'done';
    } catch (e) {
      if (job.status === 'running') {
        job.status = job.cancelRequested ? 'cancelled' : 'failed';
        job.error = job.cancelRequested ? '' : e.message;
      }
    }
    if (job.cancelRequested) job.status = 'cancelled';
    // Jobs queued from a bare link get the downloaded file's name as title.
    if (job.title === job.url && job.files.length) job.title = path.parse(job.files[0]).name;
    job.finishedAt = Date.now();
    job.speed = '';
    job.eta = '';
    if (job.status === 'done') job.progress = 1;
    this.emitJob(job, true);
    this.emit('finished', this.snapshot(job));
    setImmediate(() => this.pump());
  }

  async runUrl(job) {
    // A Giphy or Tenor link: save the actual GIF.
    const gif = await gifSource(job.url);
    if (gif) {
      try {
        job.phase = 'Saving the GIF';
        this.emitJob(job, true);
        return await this.runDirect(job, gif, { anyMedia: true, name: job.title });
      } catch (e) {
        job.log.push(`GIF: ${e.message}`);
      }
    }
    if (job.via === 'direct') return this.runDirect(job, job.url, { anyMedia: true });
    let firstError = null;
    if (job.via !== 'scrape' && this.tools.hasYtdlp()) {
      try {
        await this.runYtdlp(job);
        // Some sites answer yt-dlp's request with a web page instead of the
        // video (it asks like a browser opening a page). Catch that and
        // download the real file the ordinary way.
        const pages = [];
        for (const f of job.files) {
          const head = await fsp.readFile(f).then((b) => b.slice(0, 512)).catch(() => null);
          const t = head && sniff(head);
          if (t && t.kind === 'page') pages.push(f);
        }
        if (!pages.length) return;
        for (const f of pages) await fsp.rm(f, { force: true });
        job.files = job.files.filter((f) => !pages.includes(f));
        job.log.push('yt-dlp saved a web page instead of the video; fetching the file directly');
        const media = await this.mediaUrl(job.url);
        if (!media) throw new Error('The site sent a web page instead of the video.');
        job.phase = 'Downloading the file directly';
        this.emitJob(job, true);
        return await this.runDirect(job, media, { anyMedia: true, referer: job.url, name: job.title });
      } catch (e) {
        if (job.cancelRequested) throw e;
        firstError = e;
        job.log.push(`yt-dlp failed: ${e.message}`);
      }
    }
    // Maybe the link itself is a video file (or a drive share link).
    job.phase = 'Trying the link directly';
    this.emitJob(job, true);
    if (await this.runDirect(job, job.url).then(() => true, (e) => { job.log.push(`direct: ${e.message}`); return false; })) return;
    if (job.cancelRequested) throw new Error('Cancelled');
    // Last resort: read the page and keep only the video.
    job.phase = 'Searching the page for the video';
    this.emitJob(job, true);
    const page = await scrapePage(job.url).catch(() => null);
    const pageUrl = job.url;
    for (const c of (page && page.candidates) || []) {
      if (job.cancelRequested) throw new Error('Cancelled');
      job.log.push(`trying ${c.kind} from ${c.how}: ${c.url}`);
      job.phase = `Found a video (${c.how}) — downloading`;
      this.emitJob(job, true);
      const saved = { url: job.url, referer: job.referer, fixedTitle: job.fixedTitle };
      Object.assign(job, { url: c.url, referer: pageUrl, fixedTitle: c.kind === 'Player' ? '' : (page.title || '') });
      try {
        if (c.kind === 'File' && !this.tools.hasYtdlp()) await this.runDirect(job, c.url);
        else if (this.tools.hasYtdlp()) await this.runYtdlp(job);
        else continue;
        if (job.thumbnail === '' && page.thumbnail) job.thumbnail = page.thumbnail;
        job.url = saved.url;
        return;
      } catch (e) {
        job.log.push(`  failed: ${e.message}`);
        Object.assign(job, saved);
      }
    }
    throw firstError || new Error(page && page.candidates.length
      ? 'Found video on the page but couldn’t download it. Try the Capture browser.'
      : 'No video found on this page. Open it in the Capture browser and press play — it catches videos as they load.');
  }

  runYtdlp(job) {
    const hasFfmpeg = this.tools.hasFfmpeg();
    const args = [
      '--newline', '--no-colors', '--progress', '--no-warnings',
      '--progress-template', 'download:[[P]]%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s',
      '--print', 'after_move:[[F]]%(filepath)s',
      '-P', job.outDir,
      // Streams caught by the Capture browser have no useful title of their
      // own, so they're named after the page they came from.
      '-o', job.fixedTitle ? `${safeName(job.fixedTitle).replace(/%/g, '%%')} (%(epoch>%Y-%m-%d %H.%M.%S)s).%(ext)s`
        : job.playlist ? '%(playlist_title|Playlist).120B/%(playlist_index)03d - %(title).150B [%(id)s].%(ext)s' : '%(title).150B [%(id)s].%(ext)s',
      job.playlist ? '--yes-playlist' : '--no-playlist',
      '--windows-filenames', '--no-mtime',
    ];
    if (hasFfmpeg) args.push('--ffmpeg-location', this.tools.ffmpegDir);
    if (job.quality === 'audio') {
      if (hasFfmpeg) args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
      else args.push('-f', 'ba[ext=m4a]/ba');
    } else if (hasFfmpeg) {
      // Best video + best audio, merged into an MP4 that plays everywhere.
      // Any height works ("360"), not only the ones the app offers.
      const h = Number(job.quality);
      const sort = h ? `res:${h},fps` : QUALITY.best.sort;
      args.push('-f', 'bv*+ba/b', '-S', `${sort},vcodec:h264,acodec:m4a`, '--merge-output-format', 'mp4');
    } else {
      // Without FFmpeg only single-file formats can be used.
      const h = Number(job.quality) || 0;
      args.push('-f', h ? `b[height<=${h}][ext=mp4]/b[height<=${h}]/b` : 'b[ext=mp4]/b');
    }
    if (job.cookiesFile) args.push('--cookies', job.cookiesFile);
    else if (job.cookiesBrowser) args.push('--cookies-from-browser', job.cookiesBrowser);
    if (job.referer) args.push('--referer', job.referer);
    if (job.userAgent) args.push('--user-agent', job.userAgent);
    if (job.subtitles && job.quality !== 'audio') {
      args.push('--write-subs', '--sub-langs', 'en.*,en,-live_chat');
      if (hasFfmpeg) args.push('--embed-subs');
    }
    args.push(job.url);

    return new Promise((resolve, reject) => {
      const child = spawn(this.tools.ytdlpPath, args, { windowsHide: true });
      job.child = child;
      const parts = [];
      let buf = '';
      const onLine = (line) => {
        if (line.startsWith('[[P]]')) {
          const [pct, speed, eta] = line.slice(5).split('|').map((s) => s.trim());
          const p = parseFloat(pct);
          if (!isNaN(p)) {
            // HD sites send picture and sound separately: the second stream
            // starts again from 0%, so say which one is coming down.
            if (job.progress > 0.9 && p < 20) job.part = (job.part || 1) + 1;
            job.progress = Math.min(0.999, p / 100);
          }
          job.speed = speed && !/unknown|N\/A/i.test(speed) ? speed : '';
          job.eta = eta && !/unknown|N\/A/i.test(eta) ? eta : '';
          if (!/^Video \d+ of/.test(job.phase) || !job.playlist) job.phase = (job.part || 1) > 1 ? 'Downloading the sound' : (hasFfmpeg && job.quality !== 'audio' ? 'Downloading the picture' : 'Downloading');
          this.emitJob(job);
        } else if (line.startsWith('[[F]]')) {
          const f = line.slice(5).trim();
          if (f) job.files.push(f);
          this.emitJob(job, true);
        } else if (/^\[Merger\]|^\[ExtractAudio\]|^\[VideoConvertor\]|^\[FixupM3u8\]/.test(line)) {
          job.phase = 'Finishing';
          this.emitJob(job);
        } else if (/^\[download\] Downloading item (\d+) of (\d+)/.test(line)) {
          const m = /item (\d+) of (\d+)/.exec(line);
          job.phase = `Video ${m[1]} of ${m[2]}`;
          this.emitJob(job);
        } else if (line.trim()) {
          job.log.push(line);
          if (job.log.length > 300) job.log.shift();
        }
      };
      const feed = (d) => {
        buf += d.toString();
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        lines.forEach(onLine);
      };
      child.stdout.on('data', feed);
      child.stderr.on('data', (d) => {
        String(d).split(/\r?\n/).filter(Boolean).forEach((l) => {
          parts.push(l);
          job.log.push(l);
        });
      });
      child.on('error', (e) => reject(e));
      child.on('close', (code) => {
        job.child = null;
        if (buf) onLine(buf);
        if (job.cancelRequested) return reject(new Error('Cancelled'));
        // Some entries can fail (e.g. a dead extra source) while the video
        // itself downloaded fine — that's still a success.
        if (job.files.length) return resolve();
        if (code === 0) return reject(new Error('Nothing was downloaded.'));
        reject(new Error(friendlyYtdlpError(parts.join('\n'))));
      });
    });
  }

  async runDirect(job, url, { anyMedia = false, referer = '', name: wanted = '' } = {}) {
    // Drive links may be any kind of file (zip, photos...), not just video.
    const drive = driveDirect(url) !== url;
    url = driveDirect(url);
    const ctrl = new AbortController();
    job.abort = ctrl;
    const headers = { 'User-Agent': job.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36', Accept: '*/*' };
    if (referer || job.referer) headers.Referer = referer || job.referer;
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers });
    if (!res.ok || !res.body) throw new Error(`The server answered ${res.status}.`);
    const type = res.headers.get('content-type') || '';
    const raw = nameFromResponse(res, res.url || url);
    const picture = type.startsWith('image/') || /\.(gif|webp|png|jpe?g|avif)$/i.test(raw || '');
    if (!drive && !type.startsWith('video/') && !(raw && isVideo(raw)) && !(anyMedia && picture)) {
      // A link straight to a GIF or picture is fine too.
      if (!picture) throw new Error('This link does not point to a video.');
    }
    if (/^text\/html/i.test(type)) throw new Error('The site sent a web page instead of the file.');
    let name = wanted && wanted !== job.url ? safeName(wanted) + (path.extname(raw) || '')
      : job.fixedTitle ? safeName(job.fixedTitle) + (path.extname(raw) || '') : safeName(raw || 'video');
    if (!path.extname(name)) name += type.includes('webm') ? '.webm' : '.mp4';
    const final = await uniquePath(path.join(job.outDir, name));
    const tmp = `${final}.part`;
    const total = Number(res.headers.get('content-length')) || 0;
    await this.stream(job, res.body, tmp, total, (done) => {
      job.progress = total ? Math.min(0.999, done / total) : 0;
    });
    await fsp.rename(tmp, final);
    const checked = await fixExtension(final);
    if (checked.kind === 'page') {
      await fsp.rm(final, { force: true });
      throw new Error('The site sent a web page instead of the file.');
    }
    job.files.push(checked.file);
    if (job.title === job.url) job.title = path.parse(checked.file).name;
  }

  async stream(job, webBody, tmp, total, onDone) {
    const t0 = Date.now();
    let done = 0;
    const body = Readable.fromWeb(webBody);
    body.on('data', (c) => {
      done += c.length;
      onDone(done);
      const secs = (Date.now() - t0) / 1000;
      if (secs > 0.5) {
        const rate = done / secs;
        job.speed = `${(rate / 1048576).toFixed(1)} MB/s`;
        job.eta = total ? fmtSecs((total - done) / rate) : '';
      }
      this.emitJob(job);
    });
    try {
      await pipeline(body, fs.createWriteStream(tmp));
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      throw job.cancelRequested ? new Error('Cancelled') : e;
    }
  }

  async runServer(job) {
    let doneBytes = 0;
    for (const item of job.items) {
      if (job.cancelRequested) break;
      if (item.status !== 'queued') {
        if (item.status === 'done' || item.status === 'skipped') doneBytes += item.size;
        continue;
      }
      const final = path.join(job.outDir, item.rel);
      item.status = 'running';
      job.phase = path.basename(item.rel);
      this.emitJob(job, true);
      try {
        await fsp.mkdir(path.dirname(final), { recursive: true });
        const st = await fsp.stat(final).catch(() => null);
        if (st && item.size && st.size === item.size) {
          item.status = 'skipped';
          job.files.push(final);
          doneBytes += item.size;
          continue;
        }
        const ctrl = new AbortController();
        job.abort = ctrl;
        const res = await fetch(item.url, { headers: item.headers, signal: ctrl.signal, redirect: 'follow' });
        if (!res.ok || !res.body) throw new Error(res.status === 401 || res.status === 403 ? 'The server refused the download. Check that downloads are allowed for your account.' : `The server answered ${res.status}.`);
        const size = Number(res.headers.get('content-length')) || item.size;
        const base = doneBytes;
        await this.stream(job, res.body, `${final}.part`, size, (d) => {
          item.done = d;
          job.progress = job.totalBytes ? Math.min(0.999, (base + d) / job.totalBytes) : 0;
        });
        await fsp.rename(`${final}.part`, final);
        item.status = 'done';
        doneBytes += item.size || size;
        job.files.push(final);
      } catch (e) {
        item.status = job.cancelRequested ? 'cancelled' : 'failed';
        item.error = e.message;
      }
      this.emitJob(job, true);
    }
    job.phase = '';
  }

  // Pictures from a page (comic pages, galleries), saved in page order as
  // 001.jpg, 002.jpg... and optionally packed into one .cbz comic file.
  // `fetcher` comes from the Capture browser so its cookies and referrer apply.
  addImages({ title, site, outDir, images, cbz, fetcher }) {
    title = tidyTitle(title, site);
    const job = {
      id: uid(), kind: 'download', type: 'images', title, site, outDir, cbz: !!cbz, after: {}, status: 'queued',
      progress: 0, speed: '', eta: '', phase: '', files: [], error: '', createdAt: Date.now(), startedAt: null, finishedAt: null, log: [],
      items: images.map((im, i) => ({ id: `p${i}`, url: im.url, rel: String(i + 1).padStart(3, '0'), size: 0, status: 'queued', done: 0, error: '' })),
    };
    job.fetcher = fetcher;
    this.jobs.push(job);
    this.emitJob(job, true);
    this.pump();
    return job.id;
  }

  async runImages(job) {
    const comics = path.join(job.outDir, 'Comics');
    // Pages for a .cbz are gathered in a short temporary folder: Windows'
    // tar can't open folders whose full path is longer than 260 characters.
    const dir = job.cbz
      ? path.join(require('os').tmpdir(), `reframe-${job.id}`)
      : path.join(comics, safeName(job.title));
    await fsp.mkdir(dir, { recursive: true });
    await fsp.mkdir(comics, { recursive: true });
    const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };
    let n = 0;
    for (const item of job.items) {
      if (job.cancelRequested) break;
      item.status = 'running';
      job.phase = `Picture ${n + 1} of ${job.items.length}`;
      this.emitJob(job);
      try {
        const res = await job.fetcher(item.url);
        if (!res.ok) throw new Error(`server answered ${res.status}`);
        const type = (res.headers.get('content-type') || '').split(';')[0].trim();
        const buf = Buffer.from(await res.arrayBuffer());
        // Tiny files are icons or spacers that slipped through, not pages.
        if (buf.length < 8 * 1024 && job.items.length > 3) {
          item.status = 'skipped';
          n++;
          continue;
        }
        const real = sniff(buf.slice(0, 512));
        const ext = (real && real.kind === 'image' ? `.${real.ext}` : '') || EXT[type] || (path.extname(new URL(item.url).pathname).toLowerCase().match(/^\.(jpe?g|png|webp|gif|avif)$/) || ['.jpg'])[0];
        const file = path.join(dir, `${item.rel}${ext}`);
        await fsp.writeFile(file, buf);
        item.status = 'done';
        job.files.push(file);
      } catch (e) {
        item.status = 'failed';
        item.error = e.message;
      }
      n++;
      job.progress = Math.min(0.999, n / job.items.length);
      this.emitJob(job);
    }
    if (job.cbz && job.files.length && !job.cancelRequested) {
      // Windows' own tar.exe makes the zip; a .cbz is a zip of the pages.
      job.phase = 'Packing the comic';
      this.emitJob(job, true);
      const { run } = require('./tools');
      const zip = path.join(dir, 'comic.zip');
      const cbz = await uniquePath(path.join(comics, `${safeName(job.title)}.cbz`));
      const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
      const r = await run(tar, ['-a', '-cf', zip, '-C', dir, ...job.files.map((f) => path.basename(f))], { timeout: 300000 });
      if (r.ok) {
        // copy + remove rather than rename: the downloads folder may be on another drive.
        await fsp.copyFile(zip, cbz);
        await fsp.rm(dir, { recursive: true, force: true });
        job.files = [cbz];
      } else {
        job.log.push(`cbz failed: ${r.stderr}`);
        // Keep the pages as a folder rather than lose them.
        const keep = await uniquePath(path.join(comics, safeName(job.title)));
        await fsp.mkdir(keep, { recursive: true });
        for (const f of job.files) await fsp.copyFile(f, path.join(keep, path.basename(f)));
        await fsp.rm(dir, { recursive: true, force: true });
        job.files = job.files.map((f) => path.join(keep, path.basename(f)));
      }
    } else if (job.cbz) {
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    if (!job.files.length) {
      const why = (job.items.find((i) => i.error) || {}).error;
      throw new Error(`No pictures could be saved${why ? ` (${why})` : ''}.`);
    }
    job.phase = '';
  }

  // A file the Capture browser downloads the normal way (a site's own
  // Download button, e.g. MEGA or MediaFire) shows up as a job too.
  trackBrowserDownload(item, { outDir, site, after }) {
    const name = safeName(item.getFilename() || 'download');
    let final = path.join(outDir, name);
    for (let n = 2; fs.existsSync(final); n++) final = path.join(outDir, `${path.parse(name).name} (${n})${path.extname(name)}`);
    fs.mkdirSync(outDir, { recursive: true });
    item.setSavePath(final);
    const job = {
      id: uid(), kind: 'download', type: 'browser', title: name, site, outDir, after: after || {}, status: 'running',
      progress: 0, speed: '', eta: '', phase: 'Downloading', files: [], error: '', createdAt: Date.now(), startedAt: Date.now(), finishedAt: null, log: [],
    };
    job.abort = { abort: () => item.cancel() };
    this.jobs.push(job);
    let lastBytes = 0;
    let lastT = Date.now();
    item.on('updated', () => {
      const total = item.getTotalBytes();
      const got = item.getReceivedBytes();
      job.progress = total ? Math.min(0.999, got / total) : 0;
      const now = Date.now();
      if (now - lastT > 800) {
        const rate = (got - lastBytes) / ((now - lastT) / 1000);
        job.speed = rate > 0 ? `${(rate / 1048576).toFixed(1)} MB/s` : '';
        job.eta = rate > 0 && total ? fmtSecs((total - got) / rate) : '';
        lastBytes = got;
        lastT = now;
      }
      this.emitJob(job);
    });
    item.once('done', async (_e, state) => {
      job.finishedAt = Date.now();
      job.speed = '';
      job.eta = '';
      if (state === 'completed') {
        job.status = 'done';
        // Name the file after what's really inside (see filetype.js), before
        // anything else hears it's finished.
        const c = await fixExtension(final).catch(() => ({ file: final }));
        if (c.file !== final) job.title = path.basename(c.file);
        job.progress = 1;
        job.files = [c.file];
      } else {
        job.status = state === 'cancelled' ? 'cancelled' : 'failed';
        job.error = state === 'cancelled' ? '' : 'The site stopped the download.';
      }
      this.emitJob(job, true);
      this.emit('finished', this.snapshot(job));
    });
    this.emitJob(job, true);
    return job.id;
  }

  cancel(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    job.cancelRequested = true;
    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.finishedAt = Date.now();
    }
    if (job.child) job.child.kill();
    if (job.abort) job.abort.abort();
    if (job.items) job.items.forEach((i) => { if (i.status === 'queued') i.status = 'cancelled'; });
    this.emitJob(job, true);
  }

  retry(id) {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || job.status === 'running' || job.status === 'queued') return;
    job.cancelRequested = false;
    job.status = 'queued';
    job.error = '';
    job.progress = 0;
    if (job.items) job.items.forEach((i) => { if (i.status === 'failed' || i.status === 'cancelled') Object.assign(i, { status: 'queued', error: '', done: 0 }); });
    if (job.type === 'url') job.files = [];
    this.emitJob(job, true);
    this.pump();
  }

  log(id) {
    const job = this.jobs.find((j) => j.id === id);
    return job ? job.log.join('\n') : '';
  }

  clearFinished() {
    this.jobs = this.jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  }

  killAll() {
    for (const j of this.jobs) {
      j.cancelRequested = true;
      if (j.child) j.child.kill();
      if (j.abort) j.abort.abort();
    }
  }
}

function fmtSecs(s) {
  if (!isFinite(s)) return '';
  s = Math.round(s);
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
}

function friendlyYtdlpError(text) {
  const t = String(text || '');
  if (/Unsupported URL/i.test(t)) return 'This site isn’t supported and the link isn’t a direct video file.';
  if (/Private video|members-only|Sign in to confirm|login required|requires authentication|cookies/i.test(t)) return 'This video needs you to be signed in. Turn on “Use my browser sign-in” and try again.';
  if (/Video unavailable|video is unavailable|has been removed|not available/i.test(t)) return 'The video is unavailable — it may have been removed or blocked in your country.';
  if (/DRM/i.test(t)) return 'This video is DRM-protected, so it can’t be downloaded.';
  if (/HTTP Error 403/i.test(t)) return 'The site refused the download (403). Updating the downloader in Settings often fixes this.';
  if (/HTTP Error 404/i.test(t)) return 'The link leads nowhere (404). Check that it’s complete.';
  if (/getaddrinfo|Unable to connect|timed out|Connection refused/i.test(t)) return 'Couldn’t reach the site. Check your internet connection.';
  const err = t.split('\n').reverse().find((l) => /ERROR/.test(l));
  return err ? err.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '') : 'The download failed.';
}

module.exports = { Transfers, QUALITY, safeName, driveDirect, scrapePage, gifSource };
