'use strict';
// Toolbar of the Capture browser.
const $ = (id) => document.getElementById(id);
let found = [];
let open = false;
let mode = 'videos';
let pics = null;
let toastTimer = null;
const previews = new Map();

const fmtSize = (n) => (!n ? '' : n > 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1048576))} MB`);
const fmtDur = (s) => {
  if (!s) return '';
  s = Math.round(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
};
const clean = (e) => String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const proxyUrl = (u) => {
  const bytes = new TextEncoder().encode(u);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return `reframe://app/@capu/${btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
};

function toast(text, err) {
  const t = $('toast');
  t.textContent = text;
  t.className = `toast show ${err ? 'err' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

// The toolbar is 58px, plus the drawer's real height only while it's open.
// Measured continuously, so the toolbar can never stay stretched over a page.
function report() {
  const h = open ? Math.ceil($('panel').getBoundingClientRect().height) + 1 : 0;
  window.cap.panel(h);
}
new ResizeObserver(report).observe($('panel'));

function setPanel(v) {
  open = !!v;
  $('panel').classList.toggle('open', open);
  if (open) drawPanel();
  else {
    stopPicking();
    $('panel').querySelectorAll('video').forEach((v2) => { v2.pause(); v2.removeAttribute('src'); v2.load(); });
    $('panel').innerHTML = '';
  }
  if (typeof markOpen === 'function') markOpen();
  report();
}

async function download(id, btn) {
  try {
    await window.cap.download(id);
    if (btn) {
      btn.textContent = 'Added ✓';
      btn.classList.add('done');
    }
    return true;
  } catch (e) {
    toast(clean(e), true);
    return false;
  }
}

// Plays the video inside its card, through Reframe so the site's cookies and
// referrer are sent along.
function playInline(f, box) {
  box.innerHTML = '';
  const v = document.createElement('video');
  v.controls = true;
  v.autoplay = true;
  box.append(v);
  if (f.kind === 'HLS' && window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({ enableWorker: false, xhrSetup: (xhr, url) => xhr.open('GET', proxyUrl(url), true) });
    hls.loadSource(f.url);
    hls.attachMedia(v);
    hls.on(window.Hls.Events.ERROR, (_e, d) => { if (d.fatal) box.textContent = 'Preview not available — it can still be downloaded.'; });
  } else if (f.kind === 'Player') {
    box.textContent = 'Embedded player — the downloader opens it and saves the video.';
  } else if (f.kind === 'DASH') {
    box.textContent = 'DASH streams can’t be previewed here, but they download fine.';
  } else {
    v.src = proxyUrl(f.url);
    v.onerror = () => { box.textContent = 'This format can’t play here, but it can be downloaded.'; };
  }
}

function card(f) {
  const row = document.createElement('div');
  row.className = 'item';
  const pv = document.createElement('div');
  pv.className = 'pv';
  pv.title = 'Click to play a preview';
  pv.innerHTML = '<span>Loading preview…</span><span class="play"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z" fill="currentColor"/></svg></span>';
  pv.onclick = () => playInline(f, pv);
  const meta = document.createElement('div');
  meta.className = 'meta';
  const t = document.createElement('div');
  t.className = 't';
  t.textContent = f.title || 'Video';
  const u = document.createElement('div');
  u.className = 'u';
  u.textContent = f.url;
  u.title = f.url;
  const facts = document.createElement('div');
  facts.className = 'facts';
  const fact = (txt) => {
    const s = document.createElement('span');
    s.className = 'fact';
    s.textContent = txt;
    facts.append(s);
  };
  fact(f.kind === 'File' ? (f.url.split('?')[0].split('.').pop() || 'file').toUpperCase().slice(0, 4) : f.kind);
  if (f.size) fact(fmtSize(f.size));
  if (f.how) fact(`found in ${f.how}`);
  meta.append(t, u, facts);
  const side = document.createElement('div');
  side.className = 'side';
  const b = document.createElement('button');
  b.className = 'dl';
  b.textContent = 'Download';
  b.onclick = () => download(f.id, b);
  side.append(b);
  row.append(pv, meta, side);

  const apply = (p) => {
    if (!p) return;
    // A short clip from another site that played first is an ad: hide it.
    if (p.likelyAd) {
      row.remove();
      return;
    }
    const placeholder = pv.querySelector('span');
    if (p.thumb) {
      const img = document.createElement('img');
      img.src = p.thumb;
      pv.prepend(img);
      if (placeholder && !placeholder.classList.contains('play')) placeholder.remove();
    } else if (placeholder && !placeholder.classList.contains('play')) placeholder.textContent = 'Click to preview';
    if (p.duration) {
      const d = document.createElement('span');
      d.className = 'dur';
      d.textContent = fmtDur(p.duration);
      pv.append(d);
      fact(fmtDur(p.duration));
    }
    if (p.height) fact(p.height >= 2000 ? `4K · ${p.width}×${p.height}` : `${p.height}p · ${p.width}×${p.height}`);
  };
  if (previews.has(f.id)) apply(previews.get(f.id));
  else window.cap.preview(f.id).then((p) => { previews.set(f.id, p); apply(p); }).catch(() => apply({}));
  return row;
}

// Progress for "Collect every page" goes to whichever button is showing now
// (listening once, so redrawing the panel doesn't pile up listeners).
let pagedButton = null;
window.cap.onPagedProgress((n) => {
  if (pagedButton && pagedButton.isConnected && !pagedButton.classList.contains('done')) pagedButton.textContent = `Collecting… page ${n}`;
});

// ---------- Pictures: first ask how the reader turns pages ----------
let picking = false;
function stopPicking() {
  if (picking) window.cap.cancelPick();
  picking = false;
}
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
const button = (label, cls, onclick) => {
  const b = el('button', `dl ${cls || ''}`, label);
  b.onclick = onclick;
  return b;
};

function drawPictures() {
  stopPicking();
  const p = $('panel');
  p.innerHTML = '';
  const head = el('div', 'hint');
  head.innerHTML = '<b>How does this reader show its pages?</b><br>Pick one and Reframe takes it from there. Every page is saved in order, as a folder or one <b>.cbz</b> comic.';
  const acts = el('div', 'pactions choose');
  acts.append(
    button('⇅  It scrolls (down or sideways)', 'primary2', () => scanPictures()),
    button('⇆  I click Next / arrow buttons', 'primary2', () => drawClickMode()),
    button('Not sure: work it out for me', '', () => scanPictures()),
  );
  p.append(head, acts);
}

// "I click Next": the person points at the Next and Previous buttons, then
// Reframe clicks through the pages itself.
let clickStatus = null;
window.cap.onClickProgress((pr) => {
  if (!clickStatus || !clickStatus.isConnected) return;
  clickStatus.textContent = pr.phase === 'rewind' ? `Going back to the first page… (${pr.n})` : `Turning pages… ${pr.n} saved so far`;
});

async function drawClickMode(controls) {
  stopPicking();
  const p = $('panel');
  p.innerHTML = '';
  if (!controls) {
    const last = await window.cap.lastControls();
    const head = el('div', 'hint');
    head.innerHTML = '<b>Show Reframe the buttons.</b> On the page below, click the reader’s <b>Next</b> button, then its <b>Previous</b> (back) button. The page won’t react to those two clicks. Press <b>Esc</b> to cancel.';
    const acts = el('div', 'pactions');
    acts.append(button('Cancel', '', () => drawPictures()));
    if (last) acts.append(button('Use the same buttons as last time', 'primary2', () => drawClickMode(last)));
    p.append(head, acts);
    picking = true;
    controls = await window.cap.pickControls();
    if (!picking) return; // cancelled from the panel
    picking = false;
    if (!controls) return drawPictures();
    if (!open || mode !== 'pictures') return;
    p.innerHTML = '';
  }
  const head = el('div', 'hint');
  head.innerHTML = '<b>Buttons set ✓</b> Reframe will press <b>Next</b> on the page below and save every new picture until the pages stop changing. You can watch it happen, and stop it any time.';
  const opts = el('label', 'popt');
  const fromStart = el('input');
  fromStart.type = 'checkbox';
  opts.append(fromStart, document.createTextNode(' Start from the first page (presses Back until it can’t go further)'));
  const acts = el('div', 'pactions');
  const run = (cbz) => async () => {
    p.innerHTML = '';
    clickStatus = el('div', 'hint', 'Turning pages…');
    const stop = button('Stop and save what’s collected', '', () => { window.cap.stopClicking(); stop.textContent = 'Stopping…'; stop.disabled = true; });
    const row = el('div', 'pactions');
    row.append(stop);
    p.append(clickStatus, row);
    try {
      const n = await window.cap.clickThrough({ controls, fromStart: fromStart.checked, cbz });
      clickStatus.textContent = n === 1
        ? 'Only 1 page was found: the picture didn’t change when Reframe pressed Next. Press “Pick different buttons” and click right on the reader’s arrows, or try “It scrolls”.'
        : `Saving ${n} pages ✓ Follow it in Reframe’s Activity.`;
      stop.remove();
      toast(`Saving ${n} pages${cbz ? ' as one comic' : ''}. Follow it in Reframe’s Activity.`);
    } catch (e) {
      clickStatus.textContent = clean(e);
      stop.remove();
    }
    row.append(button('Do another chapter', '', () => drawClickMode(controls)), button('Pick different buttons', '', () => drawClickMode()));
  };
  acts.append(
    button('Click through & save as comic (.cbz)', 'primary2', run(true)),
    button('Click through & save as folder', '', run(false)),
    button('Pick the buttons again', '', () => drawClickMode()),
  );
  p.append(head, opts, acts);
}

async function scanPictures() {
  const p = $('panel');
  p.innerHTML = '<div class="hint"><b>Looking through the page…</b> Reframe scrolls through it (and any reader box inside it) so every picture loads, then puts them in reading order.</div>';
  try {
    pics = await window.cap.pictures();
  } catch (e) {
    p.innerHTML = '<div class="hint"></div>';
    p.firstChild.textContent = `Couldn’t read this page: ${clean(e)}`;
    return;
  }
  if (!open || mode !== 'pictures') return;
  p.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'hint';
  if (!pics.count) {
    head.innerHTML = '<b>No large pictures on this page.</b><br>Open a chapter or gallery page (not the list of chapters) and try again. Some official readers draw pages in a protected viewer — those can’t be saved.';
    p.append(head);
    return;
  }
  head.innerHTML = `<b>${pics.count} picture${pics.count === 1 ? '' : 's'}</b> found${pics.sizes ? ` (first one ${pics.sizes})` : ''}. Saved in reading order as 001, 002… — as a folder, or packed into one <b>.cbz</b> comic that comic readers open.`;
  const grid = document.createElement('div');
  grid.className = 'pgrid';
  for (const u of pics.sample) {
    const img = document.createElement('img');
    img.src = proxyUrl(u);
    img.loading = 'lazy';
    grid.append(img);
  }
  const acts = document.createElement('div');
  acts.className = 'pactions';
  const mk = (label, cbz, cls) => {
    const b = document.createElement('button');
    b.className = `dl ${cls || ''}`;
    b.textContent = label;
    b.onclick = async () => {
      try {
        await window.cap.savePictures(cbz);
        b.textContent = 'Saving ✓';
        b.classList.add('done');
        toast('Saving pictures — follow it in Reframe’s Activity.');
      } catch (e) {
        toast(clean(e), true);
      }
    };
    return b;
  };
  acts.append(mk('Save as comic (.cbz)', true, 'primary2'), mk('Save as folder', false));
  // Readers that show one page at a time: follow "Next", or turn the pages
  // (arrow buttons, arrow keys, clicking the page) to get the whole chapter.
  if (pics.paged) {
    const b = document.createElement('button');
    b.className = 'dl primary2';
    b.textContent = 'Collect every page (one-at-a-time reader)';
    b.title = 'This reader shows one page at a time. Reframe turns the pages for you (Next links, arrow buttons, arrow keys or clicking the page, sideways readers included) and gathers the whole chapter';
    b.onclick = async () => {
      b.textContent = 'Collecting… page 1';
      try {
        const n = await window.cap.paged(true);
        b.textContent = `Saving ${n} pages ✓`;
        b.classList.add('done');
        toast(`Saving ${n} pages as one comic — follow it in Reframe’s Activity.`);
      } catch (e) {
        b.textContent = 'Collect every page (one-at-a-time reader)';
        toast(clean(e), true);
      }
    };
    pagedButton = b;
    acts.prepend(b);
  }
  p.append(head, grid, acts);
}

function wakeButton() {
  const b = document.createElement('button');
  b.className = 'dl';
  b.textContent = 'Wake the page';
  b.title = 'Presses play on every video so lazy players start loading — then they show up here';
  b.onclick = () => { window.cap.wake(); b.textContent = 'Looking…'; setTimeout(() => { b.textContent = 'Wake the page'; }, 3000); };
  return b;
}

function drawPanel() {
  const p = $('panel');
  if (mode === 'pictures') return drawPictures();
  stopPicking();
  p.innerHTML = '';
  if (!found.length) {
    p.innerHTML = '<div class="hint"><b>No video spotted yet.</b><br>Press play on the video — Reframe watches what the page loads and lists every video here with a preview (ads are left out). Or press <b>Download this page</b>: the downloader knows 1,700+ sites and can also read the page for videos.</div>';
    p.append(wakeButton());
    return;
  }
  const head = document.createElement('div');
  head.className = 'panel-head';
  head.innerHTML = '<div class="hint">Click a picture to watch it before you download. Ads are left out. <b>HLS/DASH</b> are streams (best quality is picked); the others are plain files.</div>';
  head.append(wakeButton());
  if (found.length > 1) {
    const all = document.createElement('button');
    all.className = 'dl';
    all.textContent = `Download all ${found.length}`;
    all.onclick = async () => {
      let n = 0;
      for (const f of found) if (await download(f.id)) n++;
      all.textContent = `Added ${n} ✓`;
      all.classList.add('done');
      if (n) toast(`Downloading ${n} videos — follow them in Reframe’s Activity.`);
    };
    head.append(all);
  }
  p.append(head);
  found.forEach((f) => p.append(card(f)));
}

function openMode(m) {
  const same = mode === m;
  mode = m;
  setPanel(same ? !open : true);
  markOpen();
}

// Pictures / Found light up while their panel is open.
function markOpen() {
  $('pics').classList.toggle('on', open && mode === 'pictures');
  $('found').classList.toggle('on', open && mode === 'videos');
}

// Same theme and accent colour as the main Reframe window (see appearance.js).
function applyLook(a) {
  if (!a) return;
  const root = document.documentElement.style;
  const theme = THEMES[a.theme] ? a.theme : 'graphite';
  let g;
  let accent;
  if (a.accent === 'custom' && /^#[0-9a-f]{6}$/i.test(a.custom || '')) {
    accent = a.custom;
    g = [shade(accent, 0.35), accent, shade(accent, -0.35)];
  } else {
    const p = ACCENTS[a.accent] || ACCENTS.ember;
    g = p.g;
    accent = p.a;
  }
  const light = theme === 'light';
  if (light && luminance(accent) > 0.6) {
    accent = shade(accent, -0.55);
    g = g.map((c) => shade(c, -0.5));
  }
  const t = THEMES[theme];
  root.setProperty('--g1', g[0]);
  root.setProperty('--g2', g[1]);
  root.setProperty('--g3', g[2]);
  root.setProperty('--accent', accent);
  root.setProperty('--on-accent', luminance(g[1]) > 0.55 ? '#111' : '#fff');
  root.setProperty('--bg', light ? '#f4f5f8' : t.bg === '#000000' ? '#08080b' : shade(t.bg, 0.03));
  root.setProperty('--panel', light ? '#ffffff' : t.panel);
  root.setProperty('--field', light ? '#e9ecf2' : t.bg);
  root.setProperty('--toast', light ? '#ffffff' : shade(t.panel, 0.06));
  root.setProperty('--fg-rgb', light ? '20,24,32' : '255,255,255');
  root.setProperty('--text', light ? '#161a22' : '#eef0f5');
  root.setProperty('--text-2', light ? '#4a5164' : t.text);
  root.setProperty('--text-3', light ? '#7a8194' : '#6d7384');
}
window.cap.onLook(applyLook);

$('back').onclick = () => window.cap.nav('back');
$('fwd').onclick = () => window.cap.nav('forward');
$('reload').onclick = () => window.cap.nav('reload');
$('url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    window.cap.go($('url').value);
    $('url').blur();
  }
});
$('url').addEventListener('focus', () => $('url').select());
$('found').onclick = () => openMode('videos');
$('pics').onclick = () => openMode('pictures');
$('page').onclick = async () => {
  try {
    await window.cap.download('page');
    toast('Downloading this page — follow it in Reframe’s Activity.');
  } catch (e) {
    toast(clean(e), true);
  }
};
$('star').onclick = async () => {
  const r = await window.cap.bookmark();
  $('star').classList.add('on');
  toast(r === 'already' ? 'Already in Your own sites.' : 'Saved to Your own sites (Bookmarks.txt).');
};
$('shield').onclick = () => window.cap.toggle('adblock');
$('allow').onclick = () => {
  $('redirect').classList.remove('show');
  window.cap.allowRedirect();
};
$('dismiss').onclick = () => $('redirect').classList.remove('show');
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open) setPanel(false);
});
document.addEventListener('mousedown', (e) => {
  if (open && !e.target.closest('#panel') && !e.target.closest('#found') && !e.target.closest('#pics')) setPanel(false);
});

window.cap.onState((s) => {
  if (document.activeElement !== $('url')) $('url').value = s.url || '';
  $('bar').classList.toggle('loading', !!s.loading);
  $('back').disabled = !s.canBack;
  $('fwd').disabled = !s.canForward;
  $('star').classList.remove('on');
  if (s.loading) $('failed').classList.remove('show');
});
window.cap.onFound((list) => {
  const more = list.length > found.length;
  if (!list.length) previews.clear();
  found = list;
  $('count').textContent = list.length;
  $('found').classList.toggle('has', list.length > 0);
  if (more) {
    $('found').classList.remove('pulse');
    void $('found').offsetWidth;
    $('found').classList.add('pulse');
  }
  if (open && mode === 'videos') drawPanel();
});
window.cap.onStats((s) => {
  const total = s.ads + s.popups + s.redirects;
  $('blocked').textContent = !s.adReady ? (s.adError ? 'off' : '…') : s.checking ? 'paused' : s.adblock ? total.toLocaleString() : 'off';
  $('shield').classList.toggle('off', !s.adblock || s.checking);
  $('shield').title = s.adError ? `Ad blocker couldn’t start: ${s.adError}`
    : s.checking ? 'Paused while you complete the “are you human” check, so nothing gets in its way.'
      : s.allowedHere ? `Ad blocker is off for ${s.site}. Click to turn it back on for this site.`
        : s.adblock ? `Blocked ${s.ads} ads, ${s.popups} pop-ups and ${s.redirects} redirects (uBlock Origin ad lists). If ${s.site || 'a site'} breaks, click to turn it off for that site only.`
          : 'Ad blocker is off. Click to turn it on.';
});
window.cap.onRedirect((u) => {
  let host = u;
  try {
    host = new URL(u).hostname;
  } catch { /* keep the url */ }
  $('redirectText').textContent = `This page wants to send you to ${host}. Go there?`;
  $('redirect').classList.add('show');
});
window.cap.onFile((name) => toast(`Saving “${name}” — follow it in Reframe’s Activity.`));
window.cap.onFailed((f) => {
  $('failedText').textContent = f.byAdblock
    ? 'The ad blocker stopped this whole site from loading.'
    : `This page didn’t load (${f.desc || f.code}).`;
  $('retryNoAds').style.display = f.byAdblock || f.code < 0 ? '' : 'none';
  $('failed').classList.add('show');
});
window.cap.onClosePanel(() => { if (open) setPanel(false); });
window.cap.onOpenPanel((m) => { mode = m; setPanel(true); });
$('retry').onclick = () => { $('failed').classList.remove('show'); window.cap.retry(false); };
$('retryNoAds').onclick = () => { $('failed').classList.remove('show'); window.cap.retry(true); };
$('failedX').onclick = () => $('failed').classList.remove('show');
window.cap.onNote((m) => toast(m));
window.cap.hello();
