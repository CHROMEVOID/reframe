'use strict';
// Where videos can come from besides a normal folder: drives, cloud-synced
// folders (OneDrive, Google Drive, Dropbox, iCloud), Plex and Jellyfin.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./tools');

const exists = (p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

async function listDrives() {
  const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const r = await run(ps, ['-NoProfile', '-NonInteractive', '-Command',
    'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,VolumeName,DriveType,Size,FreeSpace,ProviderName | ConvertTo-Json -Compress'], { timeout: 20000 });
  let list = [];
  try {
    const j = JSON.parse(r.stdout || '[]');
    list = Array.isArray(j) ? j : [j];
  } catch {
    list = [];
  }
  const kind = { 2: 'removable', 3: 'local', 4: 'network', 5: 'disc' };
  return list.filter((d) => d && d.DeviceID && d.DriveType !== 5).map((d) => ({
    root: `${d.DeviceID}\\`,
    letter: d.DeviceID,
    label: d.VolumeName || (d.ProviderName ? d.ProviderName : ''),
    kind: kind[d.DriveType] || 'local',
    size: Number(d.Size) || 0,
    free: Number(d.FreeSpace) || 0,
  }));
}

async function cloudFolders(drives) {
  const home = os.homedir();
  const out = [];
  const add = (id, name, p, note) => {
    if (p && exists(p) && !out.some((o) => o.path.toLowerCase() === p.toLowerCase())) out.push({ id, name, path: p, note });
  };
  add('onedrive', 'OneDrive', process.env.OneDriveConsumer || process.env.OneDrive);
  add('onedrive', 'OneDrive for work', process.env.OneDriveCommercial);
  // Google Drive for desktop shows up as its own drive with a "My Drive" folder.
  for (const d of drives || []) {
    const my = path.join(d.root, 'My Drive');
    if (exists(my)) add('gdrive', 'Google Drive', my, d.letter);
    const shared = path.join(d.root, 'Shared drives');
    if (exists(shared)) add('gdrive', 'Google shared drives', shared, d.letter);
  }
  add('gdrive', 'Google Drive', path.join(home, 'Google Drive'));
  add('gdrive', 'Google Drive', path.join(home, 'My Drive'));
  for (const base of [process.env.LOCALAPPDATA, process.env.APPDATA]) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(base || '', 'Dropbox', 'info.json'), 'utf8'));
      for (const v of Object.values(info)) add('dropbox', 'Dropbox', v && v.path);
    } catch { /* not installed */ }
  }
  add('dropbox', 'Dropbox', path.join(home, 'Dropbox'));
  add('icloud', 'iCloud Drive', path.join(home, 'iCloudDrive'));
  add('box', 'Box', path.join(home, 'Box'));
  add('mega', 'MEGA', path.join(home, 'MEGA'));
  return out;
}

async function getJson(url, headers = {}, { method = 'GET', body, timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      body,
      signal: ctrl.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    });
    if (res.status === 401 || res.status === 403) throw new Error('The server said no — sign in again.');
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The server didn’t answer in time.');
    if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(String(e.message) + String(e.cause && e.cause.code))) throw new Error('Couldn’t reach the server. Check the address and that it’s running.');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

const trimUrl = (u) => {
  let s = String(u || '').trim().replace(/\/+$/, '');
  if (s && !/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s;
};
const baseOf = (p) => String(p || '').split(/[\\/]/).pop();
const pad = (n) => String(n || 0).padStart(2, '0');
const clean = (s) => String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '') || 'Untitled';

// ---------------- Plex ----------------
class Plex {
  constructor(clientId) {
    this.clientId = clientId;
  }

  headers(token) {
    return {
      'X-Plex-Product': 'Reframe',
      'X-Plex-Client-Identifier': this.clientId,
      'X-Plex-Device-Name': os.hostname(),
      'X-Plex-Platform': 'Windows',
      ...(token ? { 'X-Plex-Token': token } : {}),
    };
  }

  // Official "sign in with Plex" PIN flow: the user signs in on plex.tv in
  // their own browser; Reframe never sees the password.
  async startSignIn() {
    const pin = await getJson('https://plex.tv/api/v2/pins?strong=true', this.headers(), { method: 'POST' });
    const url = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(this.clientId)}&code=${encodeURIComponent(pin.code)}&context%5Bdevice%5D%5Bproduct%5D=Reframe`;
    return { id: pin.id, code: pin.code, url };
  }

  async checkSignIn(pinId) {
    const pin = await getJson(`https://plex.tv/api/v2/pins/${pinId}`, this.headers());
    return pin.authToken || null;
  }

  async servers(token) {
    const list = await getJson('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', this.headers(token));
    const servers = (Array.isArray(list) ? list : []).filter((r) => String(r.provides || '').includes('server'));
    const out = [];
    for (const s of servers) {
      const conns = [...(s.connections || [])].sort((a, b) => Number(b.local) - Number(a.local) || Number(a.relay) - Number(b.relay));
      let url = null;
      for (const c of conns) {
        try {
          await getJson(`${c.uri}/identity`, this.headers(s.accessToken || token), { timeout: 4000 });
          url = c.uri;
          break;
        } catch { /* try the next connection */ }
      }
      out.push({ name: s.name, token: s.accessToken || token, url, owned: !!s.owned });
    }
    return out;
  }

  async test(url, token) {
    const j = await getJson(`${trimUrl(url)}/identity`, this.headers(token));
    return (j.MediaContainer && j.MediaContainer.machineIdentifier) || 'ok';
  }

  async libraries({ url, token }) {
    const j = await getJson(`${trimUrl(url)}/library/sections`, this.headers(token));
    return ((j.MediaContainer && j.MediaContainer.Directory) || [])
      .filter((d) => d.type === 'movie' || d.type === 'show')
      .map((d) => ({ id: String(d.key), name: d.title, type: d.type }));
  }

  // Returns the library as groups (movies, or shows with their episodes).
  async items({ url, token }, lib) {
    const base = trimUrl(url);
    const fileFor = (m, rel) => {
      const parts = [];
      for (const media of m.Media || []) {
        for (const p of media.Part || []) {
          parts.push({
            url: `${base}${p.key}?download=1`,
            headers: this.headers(token),
            size: Number(p.size) || 0,
            rel: rel(p, media),
          });
        }
        break; // first version only
      }
      return parts;
    };
    if (lib.type === 'show') {
      const shows = await getJson(`${base}/library/sections/${lib.id}/all`, this.headers(token));
      const groups = [];
      for (const s of (shows.MediaContainer && shows.MediaContainer.Metadata) || []) {
        groups.push({ id: String(s.ratingKey), title: s.title, year: s.year || null, kind: 'show', count: s.leafCount || 0, lazy: true });
      }
      return groups;
    }
    const j = await getJson(`${base}/library/sections/${lib.id}/all`, this.headers(token));
    return ((j.MediaContainer && j.MediaContainer.Metadata) || []).map((m) => {
      const files = fileFor(m, (p, media) => path.join(clean(lib.name), baseOf(p.file) || `${clean(m.title)}${m.year ? ` (${m.year})` : ''}.${p.container || media.container || 'mp4'}`));
      return { id: String(m.ratingKey), title: m.title, year: m.year || null, kind: 'movie', files, size: files.reduce((n, f) => n + f.size, 0) };
    });
  }

  async showFiles({ url, token }, lib, show) {
    const base = trimUrl(url);
    const j = await getJson(`${base}/library/metadata/${show.id}/allLeaves`, this.headers(token));
    const files = [];
    for (const e of (j.MediaContainer && j.MediaContainer.Metadata) || []) {
      const media = (e.Media || [])[0];
      for (const p of (media && media.Part) || []) {
        files.push({
          url: `${base}${p.key}?download=1`,
          headers: this.headers(token),
          size: Number(p.size) || 0,
          rel: path.join(clean(lib.name), clean(show.title), `Season ${pad(e.parentIndex)}`, baseOf(p.file) || `${clean(show.title)} - S${pad(e.parentIndex)}E${pad(e.index)} - ${clean(e.title)}.${p.container || 'mkv'}`),
        });
      }
    }
    return files;
  }
}

// ---------------- Jellyfin (also works with Emby) ----------------
class Jellyfin {
  constructor(deviceId) {
    this.deviceId = deviceId;
  }

  auth(token) {
    const h = { 'X-Emby-Authorization': `MediaBrowser Client="Reframe", Device="${os.hostname().replace(/"/g, '')}", DeviceId="${this.deviceId}", Version="1.0.0"${token ? `, Token="${token}"` : ''}` };
    if (token) h['X-Emby-Token'] = token;
    return h;
  }

  async signIn(url, username, password) {
    const base = trimUrl(url);
    const j = await getJson(`${base}/Users/AuthenticateByName`, this.auth(), { method: 'POST', body: JSON.stringify({ Username: username, Pw: password || '' }) })
      .catch((e) => {
        throw /said no/.test(e.message) ? new Error('Wrong username or password.') : e;
      });
    if (!j.AccessToken) throw new Error('Sign-in failed.');
    return { url: base, token: j.AccessToken, userId: j.User && j.User.Id, user: (j.User && j.User.Name) || username, server: j.ServerId || '' };
  }

  async libraries(acc) {
    const j = await getJson(`${acc.url}/Users/${acc.userId}/Views`, this.auth(acc.token));
    return (j.Items || [])
      .filter((v) => ['movies', 'tvshows', 'homevideos', 'musicvideos', 'mixed', undefined, null].includes(v.CollectionType))
      .map((v) => ({ id: v.Id, name: v.Name, type: v.CollectionType === 'tvshows' ? 'show' : 'movie' }));
  }

  async items(acc, lib) {
    const q = new URLSearchParams({
      ParentId: lib.id,
      Recursive: 'true',
      IncludeItemTypes: 'Movie,Episode,Video,MusicVideo',
      Fields: 'Path,MediaSources',
      SortBy: 'SeriesSortName,ParentIndexNumber,IndexNumber,SortName',
      SortOrder: 'Ascending',
    });
    const j = await getJson(`${acc.url}/Users/${acc.userId}/Items?${q}`, this.auth(acc.token), { timeout: 60000 });
    const fileOf = (it, rel) => {
      const src = (it.MediaSources || [])[0] || {};
      return {
        url: `${acc.url}/Items/${it.Id}/Download`,
        headers: this.auth(acc.token),
        size: Number(src.Size) || 0,
        rel,
      };
    };
    const nameOf = (it) => {
      const src = (it.MediaSources || [])[0] || {};
      return baseOf(it.Path || src.Path) || `${clean(it.Name)}.${src.Container || 'mp4'}`;
    };
    const groups = new Map();
    const loose = [];
    for (const it of j.Items || []) {
      if (it.Type === 'Episode' && it.SeriesName) {
        const key = it.SeriesId || it.SeriesName;
        if (!groups.has(key)) groups.set(key, { id: String(key), title: it.SeriesName, kind: 'show', files: [] });
        const season = it.SeasonName || `Season ${pad(it.ParentIndexNumber)}`;
        groups.get(key).files.push(fileOf(it, path.join(clean(lib.name), clean(it.SeriesName), clean(season), nameOf(it))));
      } else {
        const f = fileOf(it, path.join(clean(lib.name), nameOf(it)));
        loose.push({ id: it.Id, title: it.Name, year: it.ProductionYear || null, kind: 'movie', files: [f], size: f.size });
      }
    }
    const shows = [...groups.values()].map((g) => ({ ...g, count: g.files.length, size: g.files.reduce((n, f) => n + f.size, 0) }));
    return [...shows, ...loose];
  }
}

module.exports = { listDrives, cloudFolders, Plex, Jellyfin, trimUrl };
