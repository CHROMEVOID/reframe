'use strict';
// Turns the pages of one-page-at-a-time readers that have no "Next" link to
// follow: readers that change page with the arrow keys, with an on-screen
// button (›, an arrow icon, "Next"), or by clicking the side of the picture.
// Each way is tried in turn; the first one that brings up a new picture is
// used for the rest of the chapter.


// Runs inside the page: where the clickable "turn the page" controls are,
// nearest to the main picture first. Coordinates are in the window.
function findTurnControls() {
  const NEXT = /(^|[\s_-])(next|nxt|forward|fwd)([\s_-]|$)|下一|다음|次へ|siguiente|suivant|weiter|pr[oó]xim|avanti|^\s*[›»→>]\s*$/i;
  const RIGHT = /(chevron|arrow|angle|caret|icon)[-_]?right|(^|[\s_-])right([\s_-]|$)/i;
  const LEFT = /(chevron|arrow|angle|caret|icon)[-_]?left|(^|[\s_-])left([\s_-]|$)|^\s*[‹«←<]\s*$/i;
  const PREV = /(^|[\s_-])(prev|previous|back)([\s_-]|$)|上一|이전|前へ|anterior|précédent|zur[uü]ck/i;
  // Never press anything that buys, downloads, posts or signs in.
  // Whole words only, so "display", "cartoon" or "design" don't count.
  const NOT = /(^|[^a-z])(chapters?|episodes?|ch|cap[ií]tulo|comments?|reply|share|close|menu|log-?in|log-?out|sign-?(in|up)|register|series|volumes?|scroll|download|save|buy|purchase|cart|checkout|pay|subscribe|unlock|coins?|premium|vote|like|follow|report|delete)([^a-z]|$)/i;

  const pics = [...document.querySelectorAll('img, canvas')]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter((p) => p.r.width > 150 && p.r.height > 150)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
  const main = pics[0];
  if (main) {
    main.el.scrollIntoView({ block: 'center', inline: 'center' });
    main.r = main.el.getBoundingClientRect();
  }
  const cx = main ? main.r.left + main.r.width / 2 : innerWidth / 2;
  const cy = main ? main.r.top + main.r.height / 2 : innerHeight / 2;

  const labelOf = (el) => {
    const bits = [el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('class'), el.id, el.getAttribute('data-action'), el.getAttribute('data-dir'), el.getAttribute('rel')];
    const text = (el.textContent || '').trim();
    if (text.length <= 24) bits.push(text);
    // An arrow icon inside the button often carries the only clue.
    for (const c of el.querySelectorAll('svg, i, span, use')) {
      bits.push(c.getAttribute('class'), c.getAttribute('aria-label'), c.getAttribute('href'), c.getAttribute('xlink:href'), c.getAttribute('data-icon'));
    }
    return bits.filter(Boolean).join(' ');
  };
  const clickable = (el) => {
    if (/^(BUTTON|A)$/.test(el.tagName) || el.getAttribute('role') === 'button' || el.onclick || el.hasAttribute('onclick')) return true;
    return getComputedStyle(el).cursor === 'pointer';
  };

  const groups = { next: [], right: [], left: [] };
  const seen = new Set();
  for (const el of document.querySelectorAll('button, a, [role="button"], [onclick], div, span, li, i, svg')) {
    if (seen.size > 3000) break;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8 || r.width > innerWidth * 0.6 || r.height > innerHeight * 0.9) continue;
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || !clickable(el)) continue;
    const a = el.closest('a[href]');
    // Real links to another page are followed by the "Next" link logic instead.
    if (a && !/^(#|javascript:)/i.test(a.getAttribute('href') || '#')) continue;
    const label = labelOf(el);
    if (!label || NOT.test(label) || PREV.test(label)) continue;
    const kind = NEXT.test(label) ? 'next' : RIGHT.test(label) ? 'right' : LEFT.test(label) ? 'left' : null;
    if (!kind) continue;
    const x = Math.round(r.left + r.width / 2);
    const y = Math.round(r.top + r.height / 2);
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups[kind].push({ x, y, d: Math.hypot(x - cx, y - cy) });
  }
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => a.d - b.d);

  // Many readers turn the page when you click the right or left part of it.
  const taps = main ? {
    tapRight: { x: Math.round(main.r.left + main.r.width * 0.85), y: Math.round(cy) },
    tapLeft: { x: Math.round(main.r.left + main.r.width * 0.15), y: Math.round(cy) },
  } : {};
  return {
    next: groups.next[0] || null,
    right: groups.right[0] || null,
    left: groups.left[0] || null,
    ...taps,
  };
}

// The picture(s) on screen right now: the biggest one, plus any about as big
// (two-page spreads), in reading order.
// Runs inside a page or embedded frame: the big pictures actually showing on
// screen right now, judged by how big they LOOK (a logo file can be huge but
// is drawn small). Pictures that only exist inside the page (blob: and data:
// addresses, or drawn on a <canvas>) are read out here and now, because
// readers throw them away as soon as the page turns.
async function grabVisible(opts) {
  const { topArea = 0, isTop = true } = opts || {};
  const vw = innerWidth;
  const vh = innerHeight;
  // An embedded frame has to be a real part of the screen (not an ad box).
  if (!isTop && vw * vh < topArea * 0.2) return [];
  const shownArea = (r) => Math.max(0, Math.min(r.right, vw) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, vh) - Math.max(r.top, 0));
  const hiddenEl = (el) => {
    const cs = getComputedStyle(el);
    return cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.1;
  };
  const cands = [];
  const consider = (el, kind, src) => {
    const r = el.getBoundingClientRect();
    if (Math.min(r.width, r.height) < 180) return;
    const a = shownArea(r);
    if (a < vw * vh * 0.06 || hiddenEl(el)) return;
    cands.push({ el, kind, src, r, a });
  };
  for (const img of document.images) consider(img, 'img', img.currentSrc || img.src);
  for (const c of document.querySelectorAll('canvas')) consider(c, 'canvas', null);
  let n = 0;
  for (const el of document.querySelectorAll('div, section, figure, a, span, li')) {
    if (++n > 4000) break;
    const bg = getComputedStyle(el).backgroundImage;
    const m = bg && bg !== 'none' && /url\(["']?([^"')]+)["']?\)/.exec(bg);
    if (m) consider(el, 'bg', new URL(m[1], location.href).href);
  }
  if (!cands.length) return [];
  cands.sort((a, b) => b.a - a.a);
  // The main picture, plus anything nearly as big beside it (two-page spreads).
  const keep = cands.filter((c) => c.a >= cands[0].a * 0.45).slice(0, 4);
  let rtl = document.documentElement.dir === 'rtl';
  for (let el = keep[0].el.parentElement; el && el !== document.body && !rtl; el = el.parentElement) {
    const cs = getComputedStyle(el);
    if (cs.direction === 'rtl' || /row-reverse/.test(cs.flexDirection)) rtl = true;
  }
  keep.sort((a, b) => (Math.abs(a.r.top - b.r.top) > 40 ? a.r.top - b.r.top : rtl ? b.r.left - a.r.left : a.r.left - b.r.left));

  const toB64 = (blob) => new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => res('');
    fr.readAsDataURL(blob);
  });
  // A fingerprint of the whole picture (every byte counts: two comic pages
  // can be almost identical).
  const hash = (s) => {
    let a = 2166136261;
    let b = 5381;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 16777619) >>> 0;
      b = ((b << 5) + b + c) >>> 0;
    }
    return `${a.toString(36)}${b.toString(36)}-${s.length}`;
  };
  const out = [];
  for (const c of keep) {
    const w = c.kind === 'img' ? c.el.naturalWidth || Math.round(c.r.width) : c.kind === 'canvas' ? c.el.width : Math.round(c.r.width);
    const h = c.kind === 'img' ? c.el.naturalHeight || Math.round(c.r.height) : c.kind === 'canvas' ? c.el.height : Math.round(c.r.height);
    if (c.kind === 'canvas') {
      try {
        const url = c.el.toDataURL('image/png');
        const b64 = url.split(',')[1];
        if (b64 && b64.length > 2000) out.push({ url: `inline:canvas-${hash(b64)}`, w, h, shown: c.a, b64, type: 'image/png' });
      } catch { /* drawn from another site's picture: the browser won't hand it over */ }
      continue;
    }
    const src = c.src || '';
    if (/^https?:/i.test(src)) {
      out.push({ url: src, w, h, shown: c.a });
    } else if (/^(blob|data):/i.test(src)) {
      // The browser's "current" address can still name the last page's file,
      // which the reader has already thrown away, so try both addresses...
      let got = null;
      for (const u of new Set([c.el.src, src].filter((x) => /^(blob|data):/i.test(x || '')))) {
        try {
          const blob = await (await fetch(u)).blob();
          const b64 = await toB64(blob);
          if (b64) {
            got = { b64, type: blob.type || 'image/jpeg' };
            break;
          }
        } catch { /* gone: try the next one */ }
      }
      // ...and if both are gone, copy the picture as it's drawn on screen.
      if (!got && c.kind === 'img' && c.el.naturalWidth) {
        try {
          const cv = document.createElement('canvas');
          cv.width = c.el.naturalWidth;
          cv.height = c.el.naturalHeight;
          cv.getContext('2d').drawImage(c.el, 0, 0);
          const b64 = cv.toDataURL('image/png').split(',')[1];
          if (b64) got = { b64, type: 'image/png' };
        } catch { /* the browser won't hand it over */ }
      }
      if (got) out.push({ url: `inline:${got.type.replace(/\W+/g, '-')}-${hash(got.b64)}`, w, h, shown: c.a, b64: got.b64, type: got.type });
    }
  }
  return out;
}

// The picture(s) on screen right now, from the page and any big embedded
// frame (some readers sit inside one). Inline pictures come back with their
// bytes in `data`.
async function onScreen(wc) {
  const frames = wc.mainFrame ? [wc.mainFrame, ...wc.mainFrame.framesInSubtree.filter((f) => f !== wc.mainFrame)] : [];
  if (!frames.length) return [];
  const top = await frames[0].executeJavaScript('innerWidth * innerHeight').catch(() => 0);
  let best = [];
  let bestArea = 0;
  for (const f of frames.slice(0, 12)) {
    const opts = JSON.stringify({ topArea: top, isTop: f === frames[0] });
    const list = await f.executeJavaScript(`(${grabVisible.toString()})(${opts})`, true).catch(() => null);
    if (!list || !list.length) continue;
    const area = list.reduce((n, p) => n + (p.shown || 0), 0);
    if (area > bestArea) {
      best = list;
      bestArea = area;
    }
  }
  return best.map(({ b64, type, shown, ...p }) => (b64 ? { ...p, data: Buffer.from(b64, 'base64'), type } : p));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs inside the page: lays a see-through sheet over it and asks the person
// to click the reader's Next button, then its Previous button. The sheet
// catches those clicks, so the site itself never sees them. Resolves with
// where each button is (and how to find it again), or null if cancelled.
function pickControls() {
  return new Promise((resolve) => {
    const old = document.getElementById('__reframe_pick');
    if (old) old.remove();
    const sheet = document.createElement('div');
    sheet.id = '__reframe_pick';
    sheet.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(12,14,22,.16)';
    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;left:50%;top:16px;transform:translateX(-50%);max-width:90vw;padding:11px 18px;border-radius:12px;background:#15171f;color:#fff;font:600 15px/1.35 "Segoe UI",sans-serif;box-shadow:0 12px 34px rgba(0,0,0,.55);pointer-events:none;text-align:center';
    sheet.append(tip);
    document.documentElement.append(sheet);

    const steps = [
      { key: 'next', text: 'Click the button that goes to the NEXT page', color: '#3ddc97' },
      { key: 'prev', text: 'Now click the button that goes BACK a page', color: '#ff9f43' },
    ];
    let step = 0;
    const out = {};
    const say = () => {
      tip.textContent = '';
      const n = document.createElement('div');
      n.textContent = `Step ${step + 1} of 2: ${steps[step].text}`;
      const s = document.createElement('div');
      s.style.cssText = 'font-weight:400;font-size:12.5px;opacity:.75;margin-top:3px';
      s.textContent = 'The page won’t react to this click. Press Esc to cancel.';
      tip.append(n, s);
    };
    // A way to find the same button again after the page changes.
    const selectorOf = (el) => {
      if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
      const parts = [];
      for (let e = el; e && e !== document.body && parts.length < 6; e = e.parentElement) {
        let part = e.tagName.toLowerCase();
        if (e.id && document.querySelectorAll(`#${CSS.escape(e.id)}`).length === 1) {
          parts.unshift(`#${CSS.escape(e.id)}`);
          break;
        }
        const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(e) + 1})`;
        parts.unshift(part);
      }
      return parts.join(' > ');
    };
    // What the button says and looks like, so the right one is pressed even
    // when the page around it changes (e.g. page 1 has no Back button).
    const sigOf = (el) => {
      const text = (el.textContent || '').trim().replace(/s+/g, ' ');
      return {
        tag: el.tagName.toLowerCase(),
        text: text.length <= 40 ? text : '',
        aria: el.getAttribute('aria-label') || '',
        title: el.getAttribute('title') || '',
        cls: (el.getAttribute('class') || '').trim(),
        href: (el.getAttribute('href') || '').replace(/d+/g, '#'),
      };
    };
    const mark = (x, y, label, color) => {
      const m = document.createElement('div');
      m.style.cssText = `position:fixed;left:${x - 18}px;top:${y - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid ${color};box-shadow:0 0 0 4px rgba(0,0,0,.35);pointer-events:none`;
      const t = document.createElement('div');
      t.textContent = label;
      t.style.cssText = `position:fixed;left:${x + 22}px;top:${y - 11}px;padding:3px 8px;border-radius:8px;background:${color};color:#101218;font:700 12px "Segoe UI",sans-serif;pointer-events:none`;
      sheet.append(m, t);
    };
    const swallow = (e) => {
      if (!sheet.contains(e.target) && e.target !== sheet) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onDown = (e) => {
      swallow(e);
      if (e.button !== 0) return;
      sheet.style.pointerEvents = 'none';
      const under = document.elementFromPoint(e.clientX, e.clientY);
      sheet.style.pointerEvents = 'auto';
      // A button inside an embedded frame can't be looked up from out here:
      // remember the exact spot instead.
      const found = under && (under.closest('button, a, [role="button"], [onclick]') || under);
      const el = found && found.tagName !== 'IFRAME' && found.tagName !== 'FRAME' ? found : null;
      const s = steps[step];
      out[s.key] = { x: Math.round(e.clientX), y: Math.round(e.clientY), sel: el ? selectorOf(el) : null, sig: el ? sigOf(el) : null, vw: innerWidth, vh: innerHeight };
      mark(e.clientX, e.clientY, s.key === 'next' ? 'Next' : 'Back', s.color);
      step++;
      if (step >= steps.length) done(out);
      else say();
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      done(null);
    };
    const EVENTS = ['pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'touchstart', 'touchend'];
    function done(v) {
      window.removeEventListener('pointerdown', onDown, true);
      for (const ev of EVENTS) window.removeEventListener(ev, swallow, true);
      window.removeEventListener('keydown', onKey, true);
      delete window.__reframeCancelPick;
      if (v) {
        tip.textContent = 'Got it ✓';
        setTimeout(() => sheet.remove(), 700);
      } else sheet.remove();
      resolve(v);
    }
    window.addEventListener('pointerdown', onDown, true);
    for (const ev of EVENTS) window.addEventListener(ev, swallow, true);
    window.addEventListener('keydown', onKey, true);
    window.__reframeCancelPick = () => done(null);
    say();
  });
}

// Runs inside the page: where a button picked with pickControls() is now.
// It has to say and look the same as the one that was picked (its text,
// label or style name); among those, the one nearest the picked spot wins.
// Returns null when the button isn't on this page (e.g. no Back on page 1),
// so nothing else gets pressed by mistake.
function locateControl(spot) {
  const sig = spot.sig || {};
  const named = !!(sig.text || sig.aria || sig.title);
  const styled = !!sig.cls;
  const same = (el) => {
    if (named) {
      const text = (el.textContent || '').trim().replace(/s+/g, ' ');
      return (sig.text && text === sig.text) || (sig.aria && el.getAttribute('aria-label') === sig.aria) || (sig.title && el.getAttribute('title') === sig.title);
    }
    if (styled) {
      // Every lasting style word must still be there; state words like
      // "active" or "disabled" come and go.
      const STATE = /^(is-|has-)|^(active|current|selected|disabled|hover|focus|focused|show|shown|hidden|visible|open|loaded|loading)$/i;
      const have = new Set((el.getAttribute('class') || '').split(/s+/));
      const want = sig.cls.split(/s+/).filter((c) => c && !STATE.test(c));
      return want.length > 0 && want.every((c) => have.has(c));
    }
    return true;
  };
  let best = null;
  {
    let list = [];
    try {
      if (spot.sel) list = [...document.querySelectorAll(spot.sel)];
    } catch { /* not a valid selector here */ }
    if (sig.tag && (named || styled)) list = list.concat([...document.querySelectorAll(sig.tag)].slice(0, 4000));
    for (const el of new Set(list)) {
      if (!same(el)) continue;
      if (el.getAttribute('aria-disabled') === 'true' || el.disabled) continue;
      let r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) {
        el.scrollIntoView({ block: 'center', inline: 'center' });
        r = el.getBoundingClientRect();
      }
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const d = Math.hypot(x - spot.x, y - spot.y);
      if (!best || d < best.d) best = { x: Math.round(x), y: Math.round(y), d };
    }
  }
  if (best) return { x: best.x, y: best.y };
  // A button we know by its text or style that isn't here: don't guess.
  if (named || styled) return null;
  // Nothing to recognise it by: use the spot that was clicked (scaled if the
  // window has been resized since).
  return { x: Math.round(spot.x * (innerWidth / (spot.vw || innerWidth))), y: Math.round(spot.y * (innerHeight / (spot.vh || innerHeight))) };
}

// Presses a picked button. Returns false when it isn't on the page.
async function clickControl(wc, spot) {
  const at = await wc.executeJavaScript(`(${locateControl.toString()})(${JSON.stringify(spot)})`, true).catch(() => undefined);
  if (at === null) return false;
  await click(wc, at || spot);
  return true;
}

// Waits up to a few seconds for a picture we haven't saved yet to appear.
async function waitForNew(wc, seen, tries = 10) {
  for (let t = 0; t < tries; t++) {
    await sleep(t ? 400 : 600);
    const fresh = (await onScreen(wc)).filter((i) => !seen.has(i.url));
    if (fresh.length) return fresh;
  }
  return [];
}

// Clicks and key presses go through Chromium's own input channel (the one
// automated browsers use), so they reach the page even when Windows says the
// window is covered or the screen is asleep. If that channel is busy (e.g.
// DevTools is open on the page), fall back to ordinary simulated input.
async function viaDevtools(wc, events) {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
    for (const [method, params] of events) await wc.debugger.sendCommand(method, params);
    return true;
  } catch {
    return false;
  }
}

const KEYS = {
  Right: { key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Left: { key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  PageDown: { key: 'PageDown', code: 'PageDown', windowsVirtualKeyCode: 34 },
  Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' },
};

async function press(wc, key) {
  const k = KEYS[key];
  if (k && await viaDevtools(wc, [['Input.dispatchKeyEvent', { type: 'keyDown', ...k }], ['Input.dispatchKeyEvent', { type: 'keyUp', ...k, text: undefined }]])) return;
  wc.focus();
  wc.sendInputEvent({ type: 'keyDown', keyCode: key });
  wc.sendInputEvent({ type: 'keyUp', keyCode: key });
}

async function click(wc, { x, y }) {
  const m = { x, y, button: 'left', clickCount: 1 };
  if (await viaDevtools(wc, [
    ['Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }],
    ['Input.dispatchMouseEvent', { type: 'mousePressed', ...m }],
    ['Input.dispatchMouseEvent', { type: 'mouseReleased', ...m }],
  ])) return;
  wc.focus();
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

// One way of turning the page, done once.
async function turn(wc, how) {
  if (how.key) {
    await press(wc, how.key);
    return true;
  }
  const spot = (await wc.executeJavaScript(`(${findTurnControls.toString()})()`, true).catch(() => ({})))[how.control];
  if (!spot) return false;
  await click(wc, spot);
  return true;
}

const WAYS = [
  { control: 'next' }, { control: 'right' }, { key: 'Right' },
  // Manga readers often go forward to the left.
  { control: 'left' }, { key: 'Left' },
  { key: 'PageDown' }, { key: 'Space' },
  { control: 'tapRight' }, { control: 'tapLeft' },
];

// Adds every following page to `images` (skipping ones in `seen`).
// Returns how the pages were turned, or null if nothing worked.
async function turnPages(w, images, seen, onProgress, { max = 500, sameSite = () => true } = {}) {
  const wc = w.webContents;
  const stillOnSite = () => sameSite(wc.getURL());
  const keep = (pics) => {
    for (const p of pics) {
      seen.add(p.url);
      images.push(p);
    }
    if (onProgress) onProgress(images.length);
  };

  let found = null;
  const startUrl = wc.getURL();
  for (const how of WAYS) {
    if (!(await turn(wc, how))) continue;
    const fresh = await waitForNew(wc, seen);
    if (fresh.length && stillOnSite()) {
      found = how;
      keep(fresh);
      break;
    }
    // A wrong guess that left the reader: go back to where we were.
    if (wc.getURL() !== startUrl) {
      await wc.loadURL(startUrl).catch(() => {});
      await sleep(1500);
    }
  }
  if (!found) return null;

  for (let stuck = 0; images.length < max && stuck < 2;) {
    if (!(await turn(wc, found))) break;
    const fresh = await waitForNew(wc, seen);
    if (fresh.length && stillOnSite()) {
      keep(fresh);
      stuck = 0;
    } else stuck++;
  }
  return found.key ? `the ${found.key} key` : found.control.startsWith('tap') ? 'clicking the page' : 'the page’s arrow button';
}

module.exports = { turnPages, onScreen, grabVisible, findTurnControls, pickControls, clickControl, waitForNew, click };
