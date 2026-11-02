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
    $('panel').querySelectorAll('video').forEach((v2) => { v2.pause(); v2.removeAttribute('src'); v2.load(); });
    $('panel').innerHTML = '';
  }
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

async function drawPictures() {
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
  // Readers that show one page at a time: follow "Next" to get the whole chapter.
  if (pics.paged) {
    const b = document.createElement('button');
    b.className = 'dl primary2';
    b.textContent = 'Collect every page (one-at-a-time reader)';
    b.title = 'This reader shows one page at a time: Reframe follows its Next links and gathers the whole chapter';
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
    window.cap.onPagedProgress((n) => { if (!b.classList.contains('done')) b.textContent = `Collecting… page ${n}`; });
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
}

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
