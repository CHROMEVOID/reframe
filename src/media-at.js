'use strict';
// Runs inside a page: everything media-like under the mouse at (x, y), even
// beneath invisible overlays sites put over pictures and videos. For each
// picture it finds the biggest version (srcset, <picture>, a full-size link).

function mediaAt(x, y) {
  const IMG = /\.(jpe?g|png|webp|gif|avif|bmp|jfif)(\?|#|$)/i;
  const abs = (u) => {
    try {
      const a = new URL(u, location.href);
      return /^(https?|blob):$/.test(a.protocol) ? a.href : null;
    } catch {
      return null;
    }
  };
  const biggest = (set) => {
    let best = null;
    let n = -1;
    for (const part of String(set || '').split(/,\s+(?=\S)/)) {
      const [u, d] = part.trim().split(/\s+/);
      const v = d ? parseFloat(d) * (d.endsWith('x') ? 1000 : 1) : 1;
      if (u && v > n) {
        best = u;
        n = v;
      }
    }
    return best;
  };
  const out = [];
  const seen = new Set();
  const push = (m) => {
    if (!m.url || seen.has(m.url)) return;
    seen.add(m.url);
    out.push(m);
  };
  for (const el of document.elementsFromPoint(x, y).slice(0, 25)) {
    const tag = el.tagName;
    if (tag === 'IMG') {
      const link = el.closest('a[href]');
      if (link && IMG.test(link.href)) push({ type: 'image', url: abs(link.href), how: 'full-size link' });
      const pic = el.parentElement && el.parentElement.tagName === 'PICTURE'
        ? biggest(Array.from(el.parentElement.querySelectorAll('source')).map((s) => s.getAttribute('srcset')).join(', ')) : null;
      const best = abs(el.getAttribute('data-full') || el.getAttribute('data-large') || pic || biggest(el.getAttribute('srcset')) || el.currentSrc || el.src);
      push({ type: 'image', url: best, w: el.naturalWidth, h: el.naturalHeight, how: 'picture' });
    } else if (tag === 'VIDEO' || tag === 'AUDIO') {
      const src = el.currentSrc || el.src || (el.querySelector('source') && el.querySelector('source').src) || '';
      push({ type: tag === 'VIDEO' ? 'video' : 'audio', url: abs(src) || 'blob:', stream: !/^https?:/i.test(src), w: el.videoWidth, h: el.videoHeight, duration: el.duration || 0 });
      if (el.poster) push({ type: 'image', url: abs(el.poster), how: 'video cover' });
    } else if (tag === 'CANVAS') {
      out.push({ type: 'canvas' });
    } else {
      const bg = getComputedStyle(el).backgroundImage;
      const m = bg && bg !== 'none' && /url\(["']?([^"')]+)["']?\)/.exec(bg);
      if (m) {
        const r = el.getBoundingClientRect();
        if (r.width > 80 && r.height > 80) push({ type: 'image', url: abs(m[1]), w: Math.round(r.width), h: Math.round(r.height), how: 'background' });
      }
    }
    if (tag === 'IFRAME') out.push({ type: 'frame', url: abs(el.src) });
  }
  return out.slice(0, 8);
}

module.exports = { mediaAt };
