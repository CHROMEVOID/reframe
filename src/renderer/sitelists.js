'use strict';
// The Downloader's two site lists — built-in sites and your own "Other sites"
// links — with categories, sorting, search and smooth animated re-ordering.

const CAT_ORDER = ['Video sites', 'TV & movies', 'Anime', 'Social', 'Live streaming', 'Comics & manga', 'Music & podcasts',
  'File hosts', 'Sharing & business', 'Archives & learning', 'Adult (18+)', 'Other'];
const KNOWN_HOSTS = new Map(SITES.map((s) => [s.h, s.g]));
// Guesses a category from a link's name and address (first match wins).
const CAT_RULES = [
  [/porn|xxx|\bsex|adult|nsfw|\bcams?\b|camgirl|onlyfans|18\+|xvideo|xhamster|nude|erotic|fetish|jav\b/i, 'Adult (18+)'],
  [/anime|crunchyroll|otaku|\bani[a-z]*\.(?:to|me|tv)/i, 'Anime'],
  [/manga|manhwa|manhua|comic|webtoon|toon|doujin|\bscans?\b/i, 'Comics & manga'],
  [/twitch|kick\.com|\blive\b|streamer/i, 'Live streaming'],
  [/movie|\bfilms?\b|cinema|\bseries\b|flix|\bepisodes?\b|\bseasons?\b|\btv\b/i, 'TV & movies'],
  [/music|sound|song|audio|radio|podcast|bandcamp|mixcloud|mp3|flac/i, 'Music & podcasts'],
  [/drive|mega\.nz|mediafire|dropbox|upload|files?\b|share|gofile|pixeldrain|1fichier/i, 'File hosts'],
  [/twitter|x\.com|instagram|facebook|tiktok|reddit|discord|threads|bsky|social|tumblr|vk\.com|telegram/i, 'Social'],
  [/youtube|vimeo|dailymotion|video|clip|tube/i, 'Video sites'],
  [/archive|wiki|\.edu|learn|course|library|museum/i, 'Archives & learning'],
];

function guessCategory(text) {
  for (const [re, cat] of CAT_RULES) if (re.test(text)) return cat;
  return null;
}

// Your own heading wins; then a known site's group; then a guess.
function categoryOf(s) {
  if (s.section) {
    const mapped = guessCategory(s.section);
    // ALL-CAPS headings read better in Title Case.
    const text = s.section === s.section.toUpperCase() ? s.section.toLowerCase() : s.section;
    return mapped || text.replace(/(^|[\s/&-])(\w)/g, (m, a, c) => a + c.toUpperCase()).replace(/\s+/g, ' ').trim();
  }
  return KNOWN_HOSTS.get(s.h) || guessCategory(`${s.n} ${s.h} ${s.u}`) || 'Other';
}

// Clicks are remembered (on this PC only) for "Most used".
const siteUse = (() => {
  try {
    return JSON.parse(localStorage.getItem('reframe.siteUse') || '{}');
  } catch {
    return {};
  }
})();
function useSite(u) {
  siteUse[u] = (siteUse[u] || 0) + 1;
  try {
    localStorage.setItem('reframe.siteUse', JSON.stringify(siteUse));
  } catch { /* fine without it */ }
}

// Animates changes (sorting, filtering) so tiles glide to their new places.
function smooth(fn) {
  if (document.documentElement.dataset.motion === 'off' || !document.startViewTransition) return fn();
  document.startViewTransition(fn);
}

// World popularity from the Tranco top-sites ranking (top 100,000, bundled).
let POPULAR = null;
let popularLoading = false;
function loadPopularity() {
  if (POPULAR || popularLoading) return;
  popularLoading = true;
  fetch('assets/popular-sites.txt').then((r) => r.text()).then((t) => {
    POPULAR = new Map();
    t.split(/\r?\n/).forEach((d, i) => { if (d) POPULAR.set(d.trim(), i + 1); });
    if (S.page === 'download') smooth(renderDownload);
  }).catch(() => { popularLoading = false; });
}
function rankOf(host) {
  if (!POPULAR) return 0;
  const parts = String(host).split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const r = POPULAR.get(parts.slice(i).join('.'));
    if (r) return r;
  }
  return 0;
}

const SORTS = [['cat', 'By category'], ['popular', 'Most popular'], ['newest', 'Newest'], ['oldest', 'Oldest'], ['az', 'A–Z'], ['za', 'Z–A'], ['used', 'Most used'], ['direct', 'Direct first']];
function sortSites(list, sort) {
  const rank = (s) => rankOf(s.h) || 1e9;
  // Built-in sites: when the website started. Your links: when you added them.
  // 0 = unknown, which always goes last.
  const age = (s) => (s.y ? s.y * 1e7 + (s.order || 0) / 1e9 : s.added ? s.added / 1e6 + (s.order || 0) / 1e9 : 0);
  const name = (a, b) => a.n.localeCompare(b.n, undefined, { sensitivity: 'base', numeric: true });
  const cat = (a, b) => {
    const ia = CAT_ORDER.indexOf(a.g);
    const ib = CAT_ORDER.indexOf(b.g);
    return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || a.g.localeCompare(b.g);
  };
  const by = {
    az: name,
    za: (a, b) => name(b, a),
    used: (a, b) => (siteUse[b.u] || 0) - (siteUse[a.u] || 0) || name(a, b),
    popular: (a, b) => rank(a) - rank(b) || name(a, b),
    newest: (a, b) => age(b) - age(a) || name(a, b),
    oldest: (a, b) => (age(a) || 9e15) - (age(b) || 9e15) || name(a, b),
    direct: (a, b) => (a.b === b.b ? 0 : a.b === 'direct' ? -1 : 1) || name(a, b),
    cat: (a, b) => cat(a, b) || (a.order ?? 0) - (b.order ?? 0),
  }[sort] || name;
  return [...list].sort(by);
}

const hueOf = (name) => [...name].reduce((n, c) => n + c.charCodeAt(0) * 7, 0) % 360;
const vtName = (prefix, u) => `${prefix}${[...u].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)}`;
function avatar(s) {
  return h('span', { class: 'site-avatar', style: { '--h': hueOf(s.n) } }, s.n.replace(/[^A-Za-z0-9]/g, '').slice(0, 2) || '?');
}
function siteIcon(s) {
  const src = s.i ? `assets/sites/${s.i}` : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(s.h)}&sz=64`;
  return h('span', { class: 'site-icon' }, h('img', { src, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.parentNode.replaceWith(avatar(s)) }));
}

// Little facts under a site's name: world ranking, year it started, your clicks.
function siteFacts(s) {
  const facts = [];
  const r = rankOf(s.h);
  if (r) facts.push(h('span', { class: `fact-chip ${r <= 1000 ? 'hot' : ''}`, title: 'Rank among the world’s most visited websites (Tranco list)' }, r <= 1000 ? `🔥 #${r.toLocaleString()}` : `#${r.toLocaleString()}`));
  if (s.y) facts.push(h('span', { class: 'fact-chip', title: 'When the website’s address was first registered' }, `since ${s.y}`));
  if (siteUse[s.u]) facts.push(h('span', { class: 'fact-chip', title: 'How often you’ve opened it from Reframe' }, `${siteUse[s.u]}× used`));
  return facts.length ? h('span', { class: 'site-facts' }, facts) : null;
}

let tileIndex = 0;
function siteTile(s, prefix, mine) {
  const tile = h('div', {
    class: 'site-tile spot tilt',
    title: mine ? s.u : s.b === 'direct' ? `${s.u}\nPaste any video link from here, or browse it in the Capture browser.` : `${s.u}\nOpens in the Capture browser: play the video, then download it.`,
    style: { 'view-transition-name': vtName(prefix, s.u), '--i': Math.min(tileIndex++, 24) },
    onclick: () => { useSite(s.u); api.capture(s.u); },
  },
  !s.i && !mine && !s.fav ? avatar(s) : siteIcon(s),
  h('span', { class: 'site-text' }, h('span', { class: 'site-name' }, s.n), h('span', { class: 'site-host' }, mine && s.deep ? s.u.replace(/^https?:\/\/(www\.)?/, '') : s.h),
    siteFacts(s)),
  mine
    ? (s.deep ? h('button', { class: 'site-dl', title: 'Download this link', onclick: async (e) => { e.stopPropagation(); useSite(s.u); await api.dl.start({ urls: [s.u] }); toast('Added to downloads.', { kind: 'ok', timeout: 2000 }); } }, ic('download', 14)) : null)
    : h('span', { class: `site-badge ${s.b}` }, s.b === 'direct' ? 'Direct' : 'Capture'));
  return tile;
}

// A list card: search, sort, group chips, then tiles (grouped under headings
// when sorted by category).
function siteListCard({ key, list, title, sub, head, mine, prefix, emptyText, foot }) {
  const D = S.dl;
  loadPopularity();
  tileIndex = 0;
  const st = D[key] || (D[key] = { group: 'All', sort: 'cat', search: '', all: false, collapsed: new Set() });
  const groups = ['All', ...CAT_ORDER.filter((c) => list.some((s) => s.g === c)), ...[...new Set(list.map((s) => s.g))].filter((c) => !CAT_ORDER.includes(c)).sort()];
  if (!groups.includes(st.group)) st.group = 'All';
  const q = st.search.toLowerCase();
  const hideAdultInAll = !mine;
  const shown = sortSites(list.filter((s) => (st.group === 'All' ? !(hideAdultInAll && s.g === 'Adult (18+)') || q : s.g === st.group)
    && (!q || s.n.toLowerCase().includes(q) || s.h.includes(q) || s.g.toLowerCase().includes(q))), st.sort);
  const limit = st.all || q ? shown.length : (mine ? 30 : 36);

  const search = h('input', { class: 'input', placeholder: 'Find a site', value: st.search, spellcheck: 'false' });
  search.addEventListener('input', () => {
    st.search = search.value;
    clearTimeout(st.timer);
    st.timer = setTimeout(() => {
      smooth(renderDownload);
      const s = document.querySelector(`#page-download [data-list="${key}"] .sites-search input`);
      if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
    }, 140);
  });
  const sortSel = h('select', { class: 'select', title: 'Sort' }, SORTS.filter(([v]) => !(mine && v === 'direct')).map(([v, l]) => {
    const o = h('option', { value: v }, l);
    if (st.sort === v) o.selected = true;
    return o;
  }));
  sortSel.addEventListener('change', () => { st.sort = sortSel.value; smooth(renderDownload); });

  let body;
  if (!shown.length) {
    body = list.length ? h('p', { class: 'card-sub' }, 'No site matches — open it in the Capture browser anyway.') : emptyState({ iconName: 'link', title: 'No links yet', text: emptyText || '' });
  } else if (st.sort === 'cat' && st.group === 'All' && !q) {
    // Every group under its own heading (collapsible), first 12 of each with
    // "+N more" to open the rest.
    body = h('div', { class: 'site-sections' });
    st.open = st.open || new Set();
    const order = groups.slice(1).filter((g) => shown.some((s) => s.g === g));
    for (const g of order) {
      const items = shown.filter((s) => s.g === g);
      const closed = st.collapsed.has(g);
      const full = st.all || st.open.has(g);
      const take = closed ? [] : items.slice(0, full ? items.length : 12);
      body.append(h('div', { class: `site-section ${closed ? 'closed' : ''}` },
        h('button', { class: 'site-section-head', onclick: () => { if (closed) st.collapsed.delete(g); else st.collapsed.add(g); smooth(renderDownload); } },
          ic('chevronRight', 14, 'twist'), h('span', null, g), h('b', null, items.length)),
        take.length ? h('div', { class: 'site-grid' }, take.map((s) => siteTile(s, prefix, mine))) : null,
        !closed && items.length > take.length ? h('button', { class: 'link sites-more', onclick: () => { st.open.add(g); smooth(renderDownload); } }, `+${items.length - take.length} more in ${g}`) : null));
    }
  } else {
    body = h('div', { class: 'site-grid' }, shown.slice(0, limit).map((s) => siteTile(s, prefix, mine)));
  }

  return h('div', { class: 'card sites-card', dataset: { list: key } },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, `${title} (${list.length})`), h('p', { class: 'card-sub' }, sub)),
      h('div', { class: 'head-actions' }, h('label', { class: 'lib-search sites-search' }, ic('search', 16), search), sortSel, head || null)),
    h('div', { class: 'filter-chips' }, groups.map((g) => h('button', {
      class: `chip-btn ${st.group === g ? 'on' : ''} ${g === 'Adult (18+)' ? 'adult' : ''}`,
      onclick: () => { st.group = g; st.all = false; smooth(renderDownload); },
    }, g === 'All' ? `All ${list.length}` : `${g} ${list.filter((s) => s.g === g).length}`))),
    body,
    shown.length > limit && !(st.sort === 'cat' && st.group === 'All' && !q) ? h('button', { class: 'link sites-more', onclick: () => { st.all = true; smooth(renderDownload); } }, `Show all ${shown.length}`) : null,
    foot || null);
}

function sitesPanel() {
  const list = SITES.filter((s) => S.settings.showAdult || s.g !== 'Adult (18+)').map((s, i) => ({ ...s, order: i }));
  return siteListCard({
    key: 'builtIn',
    list,
    title: 'Sites',
    sub: 'Click a site to browse it inside Reframe. Direct: paste any video link above. Capture: play the video in the Capture browser and press Download.',
    prefix: 'a',
    mine: false,
  });
}

function otherSitesPanel() {
  const D = S.dl;
  if (!D.other) {
    loadOther();
    return h('div', { class: 'card sites-card' }, h('h2', null, 'Your own sites (.txt)'), h('p', { class: 'card-sub' }, 'Loading…'));
  }
  const { sites, files } = D.other;
  const list = sites.map((s) => ({ ...s, g: categoryOf(s) }));
  const videos = sites.filter((s) => s.deep);
  const foot = h('div', null,
    files.length ? h('div', { class: 'filter-chips files-chips' }, files.map((f) => h('span', { class: 'chip-static' }, ic('list', 13), f,
      h('button', { class: 'chip-x', title: `Remove ${f}`, onclick: async () => { if (await confirmBox({ title: `Remove “${f}”?`, message: 'The text file is deleted from the Reframe Other Sites folder. Nothing you downloaded is touched.', confirm: 'Remove', danger: true })) loadOther(() => api.other.remove(f)); } }, ic('x', 12))))) : null,
    videos.length ? h('div', { class: 'other-foot' },
      btn(`Download all ${plural(videos.length, 'link')}`, { kind: 'primary', icon: 'download', onClick: async () => {
        if (videos.length > 5 && !(await confirmBox({ title: `Download ${videos.length} links?`, message: 'Each link is queued in the downloader. Links that aren’t videos are skipped with a note in Activity.', confirm: 'Download all' }))) return;
        await api.dl.start({ urls: videos.map((s) => s.u) });
        toast(`Queued ${videos.length} links — follow them in Activity.`, { kind: 'ok', action: { label: 'Activity', run: () => go('activity') } });
      } }),
      btn('Save pictures from all links', { kind: 'ghost', icon: 'layers', title: 'For comic chapters or galleries: opens each link, collects its pages and saves one .cbz comic per link', onClick: async () => {
        if (!(await confirmBox({ title: `Save pictures from ${plural(videos.length, 'link')}?`, message: 'Reframe opens each link in the background, scrolls through it and saves the big pictures (comic pages, galleries) as one .cbz comic per link, in Downloads › Comics.', confirm: 'Save pictures' }))) return;
        const close = toast(`Reading ${plural(videos.length, 'link')}…`, { timeout: 0 });
        const off = api.other.onPicturesProgress((p) => {
          if (p.done) {
            close();
            off();
            toast(p.saved ? `Saving ${plural(p.saved, 'comic')} — follow them in Activity.` : 'No pictures were found at those links.', { kind: p.saved ? 'ok' : 'warn', action: p.saved ? { label: 'Activity', run: () => go('activity') } : null });
          }
        });
        api.other.pictures(videos.map((s) => s.u), true).catch((e) => { close(); off(); toast(cleanError(e), { kind: 'error' }); });
      } }),
      h('span', { class: 'card-sub' }, 'Links to a page (not just a home page) count as downloadable.')) : null,
    h('div', { class: 'drive-help' }, ic('info', 16),
      h('div', null, h('b', null, 'Sorting your links: '), 'put a heading line in your .txt file — like ', h('code', null, '# Anime'), ', ', h('code', null, 'Movies:'), ' or ', h('code', null, '[Manga]'), ' — and the links under it go into that group. Otherwise Reframe sorts them by what the site is.')),
    h('div', { class: 'drive-help' }, ic('cloud', 16),
      h('div', null, h('b', null, 'Online drives: '), 'share links from Google Drive, Dropbox, OneDrive, Box and Yandex Disk download straight from the box at the top. For MEGA, MediaFire, pCloud, WeTransfer, Gofile and others, open the link in the Capture browser and press the site’s own Download button.')));
  return siteListCard({
    key: 'mine',
    list,
    title: 'Your own sites (.txt)',
    sub: 'Your own links. Drop .txt files of http/https links into the Reframe Other Sites folder (in Documents) or import one here — one link per line, optionally “Name - link”.',
    prefix: 'b',
    mine: true,
    emptyText: 'Import a .txt file, or put one in the folder and press refresh.',
    head: h('span', { class: 'head-btns' },
      btn('Import .txt', { kind: 'primary sm', icon: 'import', onClick: () => loadOther(api.other.import) }),
      btn('', { kind: 'ghost sm', icon: 'folderOpen', title: 'Open the folder', onClick: () => api.other.open() }),
      btn('', { kind: 'ghost sm', icon: 'retry', title: 'Read the folder again', onClick: () => loadOther() })),
    foot,
  });
}
