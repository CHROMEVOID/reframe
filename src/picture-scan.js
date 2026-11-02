'use strict';
// Runs inside a web page (via executeJavaScript) to find every real picture
// on it — comic pages, gallery photos — in true reading order.
//
// How it digs:
//  1. Scrolls the page AND any inner scrolling box (many readers scroll
//     inside a <div>), so lazy-loaded pictures load.
//  2. Waits for pictures to finish loading.
//  3. Gathers candidates from <img> (largest srcset entry, lazy data-*
//     attributes), links that point straight at full-size images (gallery
//     thumbnails), and large CSS background images.
//  4. Drops icons/logos/avatars and anything small, keeps one copy of each.
//  5. Orders them by where they appear on screen (top to bottom, then left
//     to right); if the file names are numbered (page_001, 002...) and
//     agree, uses that numbering.
// Pictures drawn onto <canvas> by protected readers are not touched.

async function pageScan(opts) {
  const { scroll = true, minSide = 250 } = opts || {};
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const IMG = /\.(jpe?g|png|webp|gif|avif|bmp|jfif)(\?|#|$)/i;
  const JUNK = /(logo|icon|favicon|avatar|sprite|emoji|badge|banner|button|spinner|loading|placeholder|blank|pixel|tracking|\bads?\b|advert)/i;
  const abs = (u) => {
    try {
      const a = new URL(u, location.href);
      return /^https?:$/.test(a.protocol) ? a.href : null;
    } catch {
      return null;
    }
  };

  // Two addresses are the same picture if they differ only in size settings
  // (?w=300 vs ?w=1200). Anything else after the "?" can be the page itself
  // (image.php?file=page12.jpg), so it counts.
  const SIZE_PARAMS = /^(w|h|width|height|size|s|q|quality|fit|resize|scale|dpr|format|fm|auto|crop|v|ver|version|t|ts|cache|cb)$/i;
  const keyOf = (u) => {
    try {
      const a = new URL(u);
      const kept = [...a.searchParams].filter(([k]) => !SIZE_PARAMS.test(k)).sort(([x], [y]) => (x < y ? -1 : 1));
      return a.origin + a.pathname + (kept.length ? `?${new URLSearchParams(kept)}` : '');
    } catch {
      return u.replace(/#.*$/, '');
    }
  };

  // Pages seen while scrolling, in the order they went past. Many readers
  // (webtoons, archive viewers) remove pages once you've scrolled by them,
  // so what's left at the end isn't the whole chapter.
  const passing = new Map();
  // Where a picture sits inside the reader, so pages caught on the way down
  // and on the way back up still end up in reading order.
  let along = null;
  const placeOf = (r) => {
    if (!along) return { y: r.top + window.scrollY, x: r.left + window.scrollX };
    const b = along.getBoundingClientRect();
    return { y: r.top - b.top + along.scrollTop, x: r.left - b.left + along.scrollLeft };
  };
  const note = () => {
    for (const img of document.images) {
      const r = img.getBoundingClientRect();
      if (r.width < minSide * 0.8 || r.height < minSide * 0.8) continue;
      if (r.bottom < -400 || r.top > innerHeight + 400 || r.right < -400 || r.left > innerWidth + 400) continue;
      const u = img.currentSrc || img.src;
      if (!/^https?:/i.test(u) || JUNK.test(u)) continue;
      const k = keyOf(u);
      const w = img.naturalWidth || Math.round(r.width);
      const h = img.naturalHeight || Math.round(r.height);
      const prev = passing.get(k);
      // Readers often show a blurry placeholder first: keep the biggest version.
      if (!prev) passing.set(k, { url: u, w, h, at: placeOf(r), seq: passing.size });
      else if (w * h > prev.w * prev.h) Object.assign(prev, { url: u, w, h });
    }
  };
  // After each scroll step, give the pictures now on screen a moment to
  // appear and load: readers add the next page's picture a moment AFTER the
  // scroll, and fixed short pauses outran them (catching only placeholders).
  const settle = async () => {
    const t0 = Date.now();
    await sleep(400);
    let count = document.images.length;
    while (Date.now() - t0 < 2000) {
      // Still loading: not finished, or still a placeholder (no real web
      // address yet, or a tiny stand-in stretched over the page's space).
      const loading = Array.from(document.images).some((img) => {
        const r = img.getBoundingClientRect();
        if (!(r.width > 100 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth)) return false;
        const src = img.currentSrc || img.src || '';
        return !img.complete || !img.naturalWidth || !/^https?:/i.test(src) || img.naturalWidth < r.width * 0.25;
      });
      await sleep(150);
      const now = document.images.length;
      if (!loading && now === count) break;
      count = now;
    }
  };

  // Some readers don't even create a page's picture until scrolling has
  // paused for a moment: if a step shows no page picture yet, wait a bit more.
  const pageInView = () => Array.from(document.images).some((img) => {
    const r = img.getBoundingClientRect();
    return r.width >= minSide * 0.8 && r.height >= minSide * 0.8 && r.bottom > 0 && r.top < innerHeight && /^https?:/i.test(img.currentSrc || img.src || '');
  });
  const look = async () => {
    const before = passing.size;
    await settle();
    note();
    if (passing.size === before && !pageInView()) {
      await sleep(900);
      await settle();
      note();
    }
  };

  if (scroll) {
    note();
    const boxes = [document.scrollingElement || document.documentElement];
    // Readers often scroll inside their own custom elements (<br-mode-1up>,
    // <manga-reader>...), so every element is checked, not just <div>s.
    for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 8000)) {
      if (boxes.length > 4) break;
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 300 && el.clientHeight > innerHeight * 0.4) boxes.push(el);
    }
    for (const box of boxes) {
      along = box === boxes[0] ? null : box;
      let last = -1;
      let stuck = 0;
      // Half a screen at a time: readers that only load the pages right next
      // to the screen need it.
      const step = Math.max(300, box.clientHeight * 0.5);
      for (let i = 0; i < 400 && stuck < 4; i++) {
        box.scrollTop += step;
        if (box === boxes[0]) window.scrollBy(0, 0);
        await look();
        if (box.scrollTop === last) stuck++;
        else stuck = 0;
        last = box.scrollTop;
      }
      // A reader that recycles pages (pictures went past that are no longer
      // on the page) gets a second sweep back up to catch any it skipped.
      const onPage = Array.from(document.images).filter((im) => im.getBoundingClientRect().width >= minSide * 0.8).length;
      if (passing.size >= 6 && passing.size > onPage) {
        for (let i = 0; i < 400 && box.scrollTop > 0; i++) {
          box.scrollTop -= step;
          await look();
        }
      }
    }
    along = null;
    // Side-scrolling readers (manga often scrolls right-to-left): scroll
    // sideways in whichever direction the box goes.
    const across = [document.scrollingElement || document.documentElement];
    for (const el of Array.from(document.querySelectorAll('body *')).slice(0, 8000)) {
      if (across.length > 4) break;
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 300) across.push(el);
    }
    for (const box of across) {
      if (box.scrollWidth <= box.clientWidth + 50) continue;
      const rtl = getComputedStyle(box).direction === 'rtl';
      let last = null;
      let stuck = 0;
      for (let i = 0; i < 400 && stuck < 4; i++) {
        box.scrollLeft += (rtl ? -1 : 1) * Math.max(300, box.clientWidth * 0.5);
        await settle();
        note();
        if (box.scrollLeft === last) stuck++;
        else stuck = 0;
        last = box.scrollLeft;
      }
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && Array.from(document.images).some((i) => i.loading !== 'lazy' && !i.complete)) await sleep(200);
    await sleep(400);
    note();
  }

  const largestFromSrcset = (s) => {
    if (!s) return null;
    let best = null;
    let bestN = -1;
    for (const part of s.split(/,\s+(?=\S)/)) {
      const [u, d] = part.trim().split(/\s+/);
      const n = d ? parseFloat(d) * (d.endsWith('x') ? 1000 : 1) : 1;
      if (u && n > bestN) {
        best = u;
        bestN = n;
      }
    }
    return best;
  };

  const found = new Map();
  let order = 0;
  const add = (url, el, w, h, how) => {
    const u = abs(url);
    if (!u) return;
    const r = el ? el.getBoundingClientRect() : { top: 0, left: 0, width: 0, height: 0 };
    const top = r.top + window.scrollY;
    let shown = Math.max(r.width, w || 0) >= minSide && Math.max(r.height, h || 0) >= minSide;
    // A picture that's on the page must also LOOK big: a large file drawn
    // small is a logo or a "related items" thumbnail, not a page.
    if (how === 'image' && r.width > 0 && r.height > 0 && Math.min(r.width, r.height) < 150) shown = false;
    // A link to a full-size picture counts however small its thumbnail is.
    const linked = how === 'full-size link' || how === 'image link';
    const known = !linked && ((w && h) || (r.width && r.height));
    if (known && !shown) return;
    if (!known && JUNK.test(u)) return;
    if (JUNK.test(u) && (w || r.width) < 500) return;
    const key = keyOf(u);
    const prev = found.get(key);
    const area = (w || r.width) * (h || r.height);
    if (prev && prev.area >= area) return;
    found.set(key, { url: u, w: w || Math.round(r.width), h: h || Math.round(r.height), area, top, left: r.left, doc: prev ? prev.doc : order++, how, visible: r.width > 0 && r.height > 0 });
  };

  for (const img of document.querySelectorAll('img')) {
    const link = img.closest('a[href]');
    // A thumbnail that links straight to its full-size picture: take the big one.
    if (link && IMG.test(link.href) && link.href !== img.currentSrc) {
      add(link.href, img, 0, 0, 'full-size link');
      continue;
    }
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || img.getAttribute('data-url') || img.getAttribute('data-lazy') || img.getAttribute('data-full') || img.getAttribute('data-large') || '';
    const set = largestFromSrcset(img.getAttribute('srcset') || img.getAttribute('data-srcset'));
    const pic = img.parentElement && img.parentElement.tagName === 'PICTURE'
      ? largestFromSrcset(Array.from(img.parentElement.querySelectorAll('source')).map((s) => s.getAttribute('srcset')).filter(Boolean).join(', ')) : null;
    const src = [img.getAttribute('data-full'), img.getAttribute('data-large'), pic, set, img.currentSrc, img.src, lazy].find((x) => x && !/^data:/.test(x) && abs(x));
    if (src) add(src, img, img.naturalWidth, img.naturalHeight, 'image');
  }
  // Gallery links to images that aren't wrapped around an <img>.
  for (const a of document.querySelectorAll('a[href]')) {
    if (IMG.test(a.href) && !a.querySelector('img')) add(a.href, a, 0, 0, 'image link');
  }
  // Big background pictures.
  let n = 0;
  for (const el of document.querySelectorAll('div, section, figure, span, a, li')) {
    if (++n > 6000) break;
    const bg = getComputedStyle(el).backgroundImage;
    if (!bg || bg === 'none') continue;
    const m = /url\(["']?([^"')]+)["']?\)/.exec(bg);
    if (m) add(m[1], el, 0, 0, 'background');
  }

  let list = Array.from(found.values());
  // Reading order. Pages stacked top-to-bottom read downwards; pages laid out
  // side by side read left-to-right, or right-to-left for manga readers
  // (detected from the reader's direction or a reversed row).
  const vis = list.filter((x) => x.visible);
  const tops = vis.map((x) => x.top);
  const avgH = vis.reduce((n, x) => n + (x.h || 0), 0) / (vis.length || 1);
  const sideBySide = vis.length > 2 && Math.max(...tops) - Math.min(...tops) < avgH * 0.6;
  let rtl = document.documentElement.dir === 'rtl';
  if (sideBySide) {
    const anyImg = document.querySelector('img');
    for (let el = anyImg && anyImg.parentElement; el && el !== document.body; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.direction === 'rtl' || /row-reverse/.test(cs.flexDirection)) {
        rtl = true;
        break;
      }
    }
    // A reversed layout puts page 1 on the right: DOM order is the truth there.
    const domFirstIsRight = vis.length > 1 && vis.slice().sort((a, b) => a.doc - b.doc)[0].left > vis.slice().sort((a, b) => a.doc - b.doc)[1].left;
    if (domFirstIsRight) rtl = true;
  }
  list.sort((a, b) => {
    if (!(a.visible && b.visible)) return a.doc - b.doc;
    if (sideBySide) return rtl ? b.left - a.left : a.left - b.left;
    return Math.abs(a.top - b.top) > 8 ? a.top - b.top : (rtl ? b.left - a.left : a.left - b.left);
  });
  // Numbered file names (001.jpg, page_2.webp...) beat layout when they agree.
  const num = (u) => {
    const m = /(\d+)(?=\.[a-z0-9]{2,5}(?:[?#]|$))/i.exec(u.replace(/[?#].*$/, ''));
    return m ? Number(m[1]) : null;
  };
  const prefix = (u) => u.replace(/[?#].*$/, '').replace(/\d+(?=\.[a-z0-9]{2,5}$)/i, '#');
  const nums = list.map((x) => num(x.url));
  const samePrefix = list.length > 2 && list.every((x) => prefix(x.url) === prefix(list[0].url));
  if (samePrefix && nums.every((v) => v !== null) && new Set(nums).size === nums.length) {
    list = list.map((x, i) => ({ ...x, n: nums[i] })).sort((a, b) => a.n - b.n);
  }
  // The reader removed pages as they scrolled by: the order they went past
  // is the reading order, plus anything still here that wasn't seen.
  const leftAtEnd = list.length;
  if (passing.size >= 4 && passing.size > list.length * 1.3) {
    const ordered = [...passing.values()].sort((a, b) => (Math.abs(a.at.y - b.at.y) > 8 ? a.at.y - b.at.y : rtl ? b.at.x - a.at.x : a.at.x - b.at.x));
    // Only the reader's own pages: download links and pictures elsewhere on
    // the page aren't part of the comic.
    list = ordered.map(({ url, w, h }) => ({ url, w, h, how: 'scrolled past' }));
  }

  // The "next page" link, for readers that show one page at a time.
  let next = null;
  const nextLink = document.querySelector('a[rel~="next" i], link[rel~="next" i]')
    || Array.from(document.querySelectorAll('a[href]')).find((a) => {
      const label = `${a.textContent} ${a.getAttribute('aria-label') || ''} ${a.getAttribute('title') || ''} ${a.className}`.trim();
      return /(^|\b)(next( page)?|nxt)(\b|$)|[›»→>]\s*$|下一|다음|siguiente|suivant/i.test(label) && !/chapter|episode|prev/i.test(label);
    });
  if (nextLink) {
    const href = abs(nextLink.getAttribute('href'));
    if (href && href !== location.href && !/#$/.test(href) && new URL(href).host === location.host) next = href;
  }
  window.scrollTo(0, 0);
  return {
    title: document.title,
    url: location.href,
    next,
    rtl,
    sideBySide,
    // How many pictures scrolled past vs. were still on the page at the end.
    counts: { passed: passing.size, leftAtEnd },
    images: list.map(({ url, w, h, how }) => ({ url, w, h, how })),
  };
}

module.exports = { pageScan };
