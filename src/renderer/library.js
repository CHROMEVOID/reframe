'use strict';
// Media library: categories (nested, like folders) and the videos in them.

const VID_MIME = 'application/x-reframe-videos';
const CAT_MIME = 'application/x-reframe-category';
const PAGE_SIZE = 120;
const PLAYABLE = /\.(mp4|m4v|webm|mkv|mov|ogv)$/i;
const RECENT_MS = 7 * 24 * 3600 * 1000;
const SPECIAL = ['all', 'fav', 'recent', 'uncat'];

// What the library shows right now: no PC-scan
// results while those are switched off (they're kept, just not shown).
function visibleLibrary() {
  const { categories, videos } = S.library;
  if (S.settings.showScanned !== false) return S.library;
  const hiddenCats = new Set(categories.filter((c) => c.origin === 'scan').map((c) => c.id));
  return {
    categories: categories.filter((c) => !hiddenCats.has(c.id)),
    videos: videos.filter((v) => v.origin !== 'scan'),
  };
}

function libIndex() {
  const { categories, videos } = visibleLibrary();
  const byId = new Map(categories.map((c) => [c.id, c]));
  const children = new Map();
  for (const c of categories) {
    const key = c.parentId && byId.has(c.parentId) ? c.parentId : null;
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(c);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  const parentOf = (id) => {
    const c = byId.get(id);
    return c && c.parentId && byId.has(c.parentId) ? c.parentId : null;
  };
  // Each video counts once towards every category above it.
  const totals = new Map();
  for (const v of videos) {
    const seen = new Set();
    for (const cid of v.categoryIds) {
      for (let c = byId.has(cid) ? cid : null; c && !seen.has(c); c = parentOf(c)) seen.add(c);
    }
    for (const c of seen) totals.set(c, (totals.get(c) || 0) + 1);
  }
  const descendants = (id) => {
    const out = [id];
    for (let i = 0; i < out.length; i++) for (const c of children.get(out[i]) || []) out.push(c.id);
    return out;
  };
  const trail = (id) => {
    const out = [];
    for (let c = byId.get(id); c; c = c.parentId ? byId.get(c.parentId) : null) out.unshift(c);
    return out;
  };
  return { byId, children, descendants, totalFor: (id) => totals.get(id) || 0, trail, videos, categories };
}

function videoTitle(v) {
  return v.title || v.name.replace(/\.[^.]+$/, '');
}

function visibleVideos(idx) {
  const L = S.lib;
  const q = L.search.trim().toLowerCase();
  const videos = idx.videos;
  let list;
  if (L.cat === 'all') list = videos;
  else if (L.cat === 'fav') list = videos.filter((v) => v.favourite);
  else if (L.cat === 'recent') list = videos.filter((v) => Date.now() - v.addedAt < RECENT_MS);
  else if (L.cat === 'uncat') list = videos.filter((v) => !v.categoryIds.some((c) => idx.byId.has(c)));
  else if (q) {
    const ids = new Set(idx.descendants(L.cat));
    list = videos.filter((v) => v.categoryIds.some((c) => ids.has(c)));
  } else list = videos.filter((v) => v.categoryIds.includes(L.cat));
  if (q) list = list.filter((v) => videoTitle(v).toLowerCase().includes(q) || v.path.toLowerCase().includes(q));
  if (L.filter !== 'any') {
    const ok = {
      '4k': (v) => v.height >= 2000,
      hd: (v) => v.height >= 700 && v.height < 2000,
      sd: (v) => v.height > 0 && v.height < 700,
    }[L.filter];
    if (ok) list = list.filter(ok);
  }
  const sorters = {
    added: (a, b) => b.addedAt - a.addedAt,
    name: (a, b) => videoTitle(a).localeCompare(videoTitle(b), undefined, { numeric: true, sensitivity: 'base' }),
    size: (a, b) => b.size - a.size,
    length: (a, b) => (b.duration || 0) - (a.duration || 0),
  };
  return [...list].sort(sorters[L.sort] || sorters.added);
}

function renderLibrary() {
  const page = $('#page-library');
  const scrollEl = page.querySelector('.lib-main');
  const keepScroll = scrollEl ? scrollEl.scrollTop : 0;
  const sideEl = page.querySelector('.lib-side-scroll');
  const keepSide = sideEl ? sideEl.scrollTop : 0;
  page.innerHTML = '';
  const idx = libIndex();
  const L = S.lib;
  if (!SPECIAL.includes(L.cat) && !idx.byId.has(L.cat)) L.cat = 'all';

  // ---------- side tree ----------
  const side = h('aside', { class: 'lib-side' });
  side.append(h('div', { class: 'lib-side-head' },
    h('h2', null, 'Media library'),
    btn('', { kind: 'ghost sm', icon: 'import', title: 'Add a folder of videos', onClick: importFolderFlow })));

  const scroll = h('div', { class: 'lib-side-scroll' });
  const all = idx.videos;
  const uncategorized = all.filter((v) => !v.categoryIds.some((c) => idx.byId.has(c))).length;
  scroll.append(sideItem({ id: 'all', label: 'All videos', iconName: 'film', count: all.length }));
  scroll.append(sideItem({ id: 'fav', label: 'Favourites', iconName: 'star', count: all.filter((v) => v.favourite).length }));
  scroll.append(sideItem({ id: 'recent', label: 'Recently added', iconName: 'clock', count: all.filter((v) => Date.now() - v.addedAt < RECENT_MS).length }));
  scroll.append(sideItem({ id: 'uncat', label: 'Not in a category', iconName: 'tag', count: uncategorized }));

  const catHead = h('div', { class: 'lib-side-section' }, h('span', null, 'Categories'),
    btn('', { kind: 'ghost sm', icon: 'plus', title: 'New category', onClick: () => newCategory(null) }));
  catHead.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes(CAT_MIME)) {
      e.preventDefault();
      catHead.classList.add('drop');
    }
  });
  catHead.addEventListener('dragleave', () => catHead.classList.remove('drop'));
  catHead.addEventListener('drop', (e) => {
    catHead.classList.remove('drop');
    const id = e.dataTransfer.getData(CAT_MIME);
    if (id) api.library.updateCategory(id, { parentId: null });
  });
  scroll.append(catHead);

  const roots = idx.children.get(null) || [];
  if (!roots.length) scroll.append(h('div', { class: 'lib-side-empty' }, 'Make categories to sort your videos, or convert a folder and they are made for you.'));
  const drawCats = (list, depth) => {
    for (const c of list) {
      const kids = idx.children.get(c.id) || [];
      const open = L.open.has(c.id);
      scroll.append(sideItem({ id: c.id, label: c.name, color: c.color, count: idx.totalFor(c.id), depth, hasKids: !!kids.length, open, cat: c }));
      if (kids.length && open) drawCats(kids, depth + 1);
    }
  };
  drawCats(roots, 0);
  side.append(scroll);
  side.append(h('div', { class: 'lib-side-foot' },
    btn('New category', { kind: 'ghost', icon: 'plus', onClick: () => newCategory(null) }),
    btn('Scan my PC', { kind: 'ghost', icon: 'scan', onClick: () => askScan(false) })));

  // ---------- main ----------
  const main = h('div', { class: 'lib-main' });
  const videos = visibleVideos(idx);
  const isCat = !SPECIAL.includes(L.cat);
  const cat = isCat ? idx.byId.get(L.cat) : null;

  const crumbs = h('div', { class: 'crumbs' });
  if (isCat) {
    const t = idx.trail(L.cat);
    crumbs.append(h('button', { class: 'crumb', onclick: () => selectCat('all') }, 'Library'));
    t.forEach((c, i) => {
      crumbs.append(ic('chevronRight', 13));
      crumbs.append(h('button', { class: `crumb ${i === t.length - 1 ? 'here' : ''}`, onclick: () => selectCat(c.id) }, c.name));
    });
  }

  const title = { all: 'All videos', fav: 'Favourites', recent: 'Recently added', uncat: 'Not in a category' }[L.cat] || cat.name;
  const searchInput = h('input', { class: 'input', placeholder: isCat ? `Search in ${cat.name}` : 'Search videos', value: L.search, spellcheck: 'false' });
  searchInput.addEventListener('input', () => {
    L.search = searchInput.value;
    clearTimeout(L.searchTimer);
    L.searchTimer = setTimeout(() => {
      L.shown = PAGE_SIZE;
      renderLibrary();
      const again = $('#page-library .lib-search input');
      if (again) {
        again.focus();
        again.setSelectionRange(again.value.length, again.value.length);
      }
    }, 140);
  });

  const sortSel = h('select', { class: 'select', title: 'Sort videos' },
    [['added', 'Recently added'], ['name', 'Name'], ['size', 'Size'], ['length', 'Length']].map(([v, l]) => {
      const o = h('option', { value: v }, l);
      if (L.sort === v) o.selected = true;
      return o;
    }));
  sortSel.addEventListener('change', () => {
    L.sort = sortSel.value;
    api.setSettings({ librarySort: L.sort });
    renderLibrary();
  });

  const sizeSlider = h('input', { type: 'range', class: 'range', min: '170', max: '360', step: '10', value: String(S.settings.appearance.cardSize || 230), title: 'Card size' });
  sizeSlider.addEventListener('input', () => {
    document.documentElement.style.setProperty('--card-min', `${sizeSlider.value}px`);
  });
  sizeSlider.addEventListener('change', () => setAppearance({ cardSize: +sizeSlider.value }, { rerender: false }));

  main.append(h('div', { class: 'lib-head' },
    h('div', { class: 'lib-title' },
      crumbs,
      h('div', { class: 'lib-title-row' },
        cat ? h('i', { class: 'cat-dot big', style: { background: cat.color } }) : null,
        h('h1', null, title),
        h('span', { class: 'lib-count' }, plural(videos.length, 'video')),
        cat ? btn('', { kind: 'ghost sm', icon: 'more', title: 'Category options', onClick: (e) => categoryMenu(cat, { anchor: e.currentTarget, align: 'start' }) }) : null)),
    h('div', { class: 'lib-tools' },
      h('label', { class: 'lib-search' }, ic('search', 16), searchInput),
      sortSel,
      L.view === 'grid' ? h('label', { class: 'size-ctl', title: 'Card size' }, ic('grid', 14), sizeSlider) : null,
      h('div', { class: 'seg icons' },
        h('button', { class: L.view === 'grid' ? 'on' : '', title: 'Grid', onclick: () => setView('grid') }, ic('grid', 16)),
        h('button', { class: L.view === 'list' ? 'on' : '', title: 'List', onclick: () => setView('list') }, ic('list', 16))))));

  // Stats strip on the home view.
  if (L.cat === 'all' && !L.search && all.length) {
    const totalSize = all.reduce((n, v) => n + (v.size || 0), 0);
    const totalLen = all.reduce((n, v) => n + (v.duration || 0), 0);
    const strip = h('div', { class: 'lib-stats' });
    const mk = (iconName, label, value, fmt) => {
      const val = h('div', { class: 'ls-value' });
      strip.append(h('div', { class: 'ls spot' }, h('span', { class: 'ls-icon' }, ic(iconName, 18)), h('div', null, val, h('div', { class: 'ls-label' }, label))));
      countUp(val, value, { format: fmt });
    };
    mk('film', 'videos', all.length, (n) => Math.round(n).toLocaleString());
    mk('drive', 'on disk', totalSize, (n) => fmtBytes(n));
    mk('clock', 'to watch', totalLen, (n) => (n > 3600 ? `${(n / 3600).toFixed(1)} h` : `${Math.round(n / 60)} min`));
    mk('layers', 'categories', idx.categories.length, (n) => Math.round(n).toLocaleString());
    main.append(strip);
  }

  // Quick filters.
  if (all.length) {
    main.append(h('div', { class: 'filter-chips' }, [['any', 'Everything'], ['4k', '4K'], ['hd', 'HD'], ['sd', 'SD']].map(([f, l]) => h('button', {
      class: `chip-btn ${L.filter === f ? 'on' : ''}`,
      onclick: () => { L.filter = f; L.shown = PAGE_SIZE; renderLibrary(); },
    }, l))));
  }

  // Selection bar
  const sel = [...L.selected].filter((id) => all.some((v) => v.id === id));
  L.selected = new Set(sel);
  if (sel.length) {
    main.append(h('div', { class: 'selbar' },
      h('span', { class: 'selbar-count' }, `${sel.length} selected`),
      btn('Favourite', { kind: 'ghost', icon: 'star', onClick: () => api.library.favourite(sel, true) }),
      btn('Add to category', { kind: 'ghost', icon: 'tag', onClick: (e) => pickCategoryMenu(e.currentTarget, sel, false) }),
      btn('Move', { kind: 'ghost', icon: 'move', onClick: (e) => pickCategoryMenu(e.currentTarget, sel, true) }),
      btn('Convert', { kind: 'ghost', icon: 'convert', onClick: () => convertVideos(sel) }),
      isCat ? btn(`Take out of ${cat.name}`, { kind: 'ghost', icon: 'minus', onClick: () => api.library.unassign(sel, cat.id) }) : null,
      btn('Remove', { kind: 'ghost danger-text', icon: 'trash', onClick: () => removeFromLibrary(sel) }),
      h('div', { class: 'grow' }),
      btn('Select all', { kind: 'ghost', onClick: () => { L.selected = new Set(videos.map((v) => v.id)); renderLibrary(); } }),
      btn('', { kind: 'ghost', icon: 'x', title: 'Clear selection', onClick: () => { L.selected.clear(); renderLibrary(); } })));
  }

  // Sub-category tiles (like folders in Explorer)
  const subs = L.search || !isCat ? (L.cat === 'all' && !L.search ? (idx.children.get(null) || []) : []) : (idx.children.get(L.cat) || []);
  if (subs.length) {
    main.append(h('div', { class: 'section-label' }, L.cat === 'all' ? 'Categories' : 'Folders'));
    const tiles = h('div', { class: 'folder-tiles' }, subs.map((c) => folderTile(c, idx)));
    main.append(tiles);
    stagger(tiles);
  }

  if (!all.length) {
    main.append(emptyState({
      iconName: 'library',
      title: 'Your library is empty',
      text: 'Videos you convert or download are added here automatically and sorted into categories that match their folders. Reframe can also find the videos already on your PC.',
      actions: [
        btn('Find videos on my PC', { kind: 'primary', icon: 'scan', onClick: () => askScan(false) }),
        btn('Add a folder', { kind: 'ghost', icon: 'import', onClick: importFolderFlow }),
      ],
    }));
  } else if (!videos.length) {
    if (!subs.length) {
      main.append(emptyState({
        iconName: L.search ? 'search' : L.cat === 'fav' ? 'star' : 'tag',
        title: L.search ? 'No videos match' : L.cat === 'fav' ? 'No favourites yet' : 'Nothing here yet',
        text: L.search ? 'Try a different word.' : L.cat === 'fav' ? 'Hover over a video and press the star to keep it here.' : 'Drag videos onto this category in the side bar, or right-click a video and choose “Add to category”.',
      }));
    }
  } else {
    if (subs.length) main.append(h('div', { class: 'section-label' }, 'Videos'));
    const box = h('div', { class: L.view === 'grid' ? 'vgrid' : 'vlist' });
    const shown = videos.slice(0, L.shown);
    for (const v of shown) box.append(L.view === 'grid' ? videoCard(v, idx, videos) : videoRow(v, idx, videos));
    main.append(box);
    if (L.firstPaint) stagger(box);
    if (videos.length > L.shown) {
      // Loads the next batch when you scroll near the end.
      const more = h('div', { class: 'load-more' }, h('div', { class: 'spinner small' }), `Showing ${L.shown.toLocaleString()} of ${videos.length.toLocaleString()}`);
      main.append(more);
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          L.shown += PAGE_SIZE * 2;
          renderLibrary();
        }
      }, { root: main, rootMargin: '600px' });
      io.observe(more);
    }
  }
  L.firstPaint = false;

  main.addEventListener('mousedown', (e) => {
    if (e.target === main || e.target.classList.contains('vgrid') || e.target.classList.contains('vlist')) {
      if (L.selected.size) {
        L.selected.clear();
        renderLibrary();
      }
    }
  });

  page.append(side, main);
  main.scrollTop = keepScroll;
  scroll.scrollTop = keepSide;
  queueThumbs();
}

function setView(v) {
  S.lib.view = v;
  api.setSettings({ libraryView: v });
  S.lib.firstPaint = true;
  renderLibrary();
}

function selectCat(id) {
  const L = S.lib;
  if (L.cat !== id) {
    L.selected.clear();
    L.search = '';
    L.shown = PAGE_SIZE;
    L.firstPaint = true;
  }
  L.cat = id;
  if (!SPECIAL.includes(id)) {
    const idx = libIndex();
    idx.trail(id).forEach((c) => { if (c.id !== id) L.open.add(c.id); });
    if ((idx.children.get(id) || []).length) L.open.add(id);
  }
  renderLibrary();
  const m = $('#page-library .lib-main');
  if (m) m.scrollTop = 0;
}

function sideItem({ id, label, iconName, color, count, depth = 0, hasKids, open, cat }) {
  const L = S.lib;
  const el = h('div', {
    class: `side-item ${L.cat === id ? 'active' : ''}`,
    style: { '--depth': depth },
    tabindex: '0',
    onclick: () => selectCat(id),
    onkeydown: (e) => {
      if (e.key === 'Enter') selectCat(id);
    },
  },
  cat ? h('button', {
    class: `twisty ${hasKids ? '' : 'none'} ${open ? 'open' : ''}`,
    tabindex: '-1',
    onclick: (e) => {
      e.stopPropagation();
      if (!hasKids) return;
      if (open) L.open.delete(id);
      else L.open.add(id);
      renderLibrary();
    },
  }, ic('chevronRight', 13)) : null,
  color ? h('i', { class: 'cat-dot', style: { background: color } }) : h('span', { class: 'side-icon' }, ic(iconName, 17)),
  h('span', { class: 'side-label' }, label),
  h('span', { class: 'side-count' }, count ? count.toLocaleString() : ''));

  if (cat) {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData(CAT_MIME, cat.id);
      e.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      categoryMenu(cat, { x: e.clientX, y: e.clientY });
    });
  }
  if (cat || id === 'uncat' || id === 'fav') {
    el.addEventListener('dragover', (e) => {
      const t = e.dataTransfer.types;
      if (t.includes(VID_MIME) || (cat && t.includes(CAT_MIME))) {
        e.preventDefault();
        el.classList.add('drop');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drop');
      const vids = e.dataTransfer.getData(VID_MIME);
      if (vids) {
        const ids = JSON.parse(vids);
        if (id === 'fav') {
          api.library.favourite(ids, true);
          toast(`Added ${plural(ids.length, 'video')} to favourites`, { kind: 'ok', timeout: 2500 });
        } else if (cat) {
          api.library.assign(ids, cat.id, false);
          toast(`Added ${plural(ids.length, 'video')} to ${cat.name}`, { kind: 'ok', timeout: 2500 });
        } else {
          api.library.assign(ids, null, true);
        }
        return;
      }
      const cid = e.dataTransfer.getData(CAT_MIME);
      if (cid && cat && cid !== cat.id) api.library.updateCategory(cid, { parentId: cat.id });
    });
  }
  return el;
}

function folderTile(c, idx) {
  const kids = (idx.children.get(c.id) || []).length;
  const total = idx.totalFor(c.id);
  const ids = new Set(idx.descendants(c.id));
  const previews = [];
  for (const v of idx.videos) {
    if (v.thumb && v.thumb !== 'none' && v.categoryIds.some((x) => ids.has(x))) previews.push(v);
    if (previews.length === 4) break;
  }
  const tile = h('button', {
    class: 'folder-tile spot',
    style: { '--c': c.color },
    onclick: () => selectCat(c.id),
    oncontextmenu: (e) => {
      e.preventDefault();
      categoryMenu(c, { x: e.clientX, y: e.clientY });
    },
  },
  h('div', { class: `ft-art n${previews.length}` }, previews.length ? previews.map((p) => h('img', { src: thumbUrl(p), alt: '', loading: 'lazy' })) : ic('folder', 26)),
  h('div', { class: 'ft-text' },
    h('div', { class: 'ft-name' }, c.name),
    h('div', { class: 'ft-meta' }, [plural(total, 'video'), kids ? plural(kids, 'folder') : null].filter(Boolean).join(' · '))));
  tile.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes(VID_MIME)) {
      e.preventDefault();
      tile.classList.add('drop');
    }
  });
  tile.addEventListener('dragleave', () => tile.classList.remove('drop'));
  tile.addEventListener('drop', (e) => {
    tile.classList.remove('drop');
    const vids = e.dataTransfer.getData(VID_MIME);
    if (vids) {
      api.library.assign(JSON.parse(vids), c.id, false);
      toast(`Added to ${c.name}`, { kind: 'ok', timeout: 2500 });
    }
  });
  return tile;
}

function handleSelectClick(e, v, list) {
  const L = S.lib;
  if (e.shiftKey && L.anchor) {
    const a = list.findIndex((x) => x.id === L.anchor);
    const b = list.findIndex((x) => x.id === v.id);
    if (a >= 0 && b >= 0) {
      if (!e.ctrlKey) L.selected.clear();
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) L.selected.add(list[i].id);
    }
  } else if (e.ctrlKey || e.metaKey || L.selected.size) {
    if (L.selected.has(v.id)) L.selected.delete(v.id);
    else L.selected.add(v.id);
    L.anchor = v.id;
  } else {
    L.anchor = v.id;
    playVideo(v);
    return;
  }
  renderLibrary();
}

function videoChips(v, idx) {
  return v.categoryIds.map((id) => idx.byId.get(id)).filter(Boolean).filter((c) => c.id !== S.lib.cat).slice(0, 3)
    .map((c) => h('span', { class: 'chip', style: { '--c': c.color }, title: idx.trail(c.id).map((x) => x.name).join(' › ') }, c.name));
}

function wireVideoEl(el, v) {
  const L = S.lib;
  el.draggable = true;
  el.addEventListener('dragstart', (e) => {
    stopPreview();
    const ids = L.selected.has(v.id) ? [...L.selected] : [v.id];
    e.dataTransfer.setData(VID_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = 'copyMove';
    const ghost = h('div', { class: 'drag-ghost' }, ic('film', 15), ids.length > 1 ? `${ids.length} videos` : videoTitle(v));
    document.body.append(ghost);
    e.dataTransfer.setDragImage(ghost, 14, 14);
    setTimeout(() => ghost.remove());
  });
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!L.selected.has(v.id)) {
      L.selected = new Set([v.id]);
      L.anchor = v.id;
      renderLibrary();
    }
    videoMenu(v, { x: e.clientX, y: e.clientY });
  });
}

function thumbEl(v) {
  return v.thumb && v.thumb !== 'none'
    ? h('img', { class: 'vimg', src: thumbUrl(v), alt: '', loading: 'lazy', draggable: 'false' })
    : h('div', { class: 'vthumb-ph' }, ic('film', 26));
}

function videoCard(v, idx, list) {
  const L = S.lib;
  const missing = S.missing.has(v.id);
  const res = v.height ? (v.height >= 2000 ? '4K' : `${v.height}p`) : '';
  const thumb = h('div', { class: 'vthumb' },
    thumbEl(v),
    h('span', { class: 'vext' }, (v.name.split('.').pop() || '').toUpperCase()),
    v.duration ? h('span', { class: 'vdur' }, fmtDuration(v.duration)) : null,
    missing ? h('span', { class: 'vmissing' }, ic('alert', 14), 'File moved or deleted') : h('span', { class: 'vplay' }, ic('play', 22, 'fill')),
    h('button', {
      class: `vfav ${v.favourite ? 'on' : ''}`,
      title: v.favourite ? 'Remove from favourites' : 'Add to favourites',
      onclick: (e) => {
        e.stopPropagation();
        api.library.favourite([v.id], !v.favourite);
      },
    }, ic('star', 15, v.favourite ? 'fill' : '')),
    h('button', {
      class: `vcheck ${L.selected.has(v.id) ? 'on' : ''}`,
      title: 'Select',
      onclick: (e) => {
        e.stopPropagation();
        if (L.selected.has(v.id)) L.selected.delete(v.id);
        else L.selected.add(v.id);
        L.anchor = v.id;
        renderLibrary();
      },
    }, ic('check', 14)));
  const card = h('div', { class: `vcard ${L.selected.has(v.id) ? 'selected' : ''} ${missing ? 'missing' : ''}`, dataset: { id: v.id }, tabindex: '0' },
    thumb,
    h('div', { class: 'vinfo' },
      h('div', { class: 'vtitle', title: v.path }, videoTitle(v)),
      h('div', { class: 'vmeta' }, [res, fmtBytes(v.size)].filter(Boolean).join(' · ')),
      h('div', { class: 'chips' }, videoChips(v, idx))));
  card.addEventListener('click', (e) => handleSelectClick(e, v, list));
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') playVideo(v);
    if (e.key === 'Delete') removeFromLibrary(L.selected.size ? [...L.selected] : [v.id]);
  });
  if (!missing) {
    card.addEventListener('mouseenter', () => schedulePreview(v, thumb));
    card.addEventListener('mouseleave', stopPreview);
  }
  wireVideoEl(card, v);
  return card;
}

// Hovering a card plays a silent preview inside it.
let previewTimer = null;
let previewEl = null;
function schedulePreview(v, thumb) {
  stopPreview();
  if (!motionOn() || !PLAYABLE.test(v.path) || v.thumb === 'none') return;
  previewTimer = setTimeout(() => {
    const vid = h('video', { class: 'vpreview', muted: true, autoplay: true, loop: true, playsinline: true });
    vid.muted = true;
    vid.src = `${mediaUrl(v.path)}#t=${v.duration ? Math.min(v.duration * 0.2, 45).toFixed(1) : 0}`;
    vid.addEventListener('playing', () => vid.classList.add('on'));
    vid.addEventListener('error', () => vid.remove());
    thumb.append(vid);
    previewEl = vid;
  }, 450);
}
function stopPreview() {
  clearTimeout(previewTimer);
  if (previewEl) {
    previewEl.pause();
    previewEl.removeAttribute('src');
    previewEl.load();
    previewEl.remove();
    previewEl = null;
  }
}

function videoRow(v, idx) {
  const L = S.lib;
  const missing = S.missing.has(v.id);
  const row = h('div', { class: `vrow ${L.selected.has(v.id) ? 'selected' : ''} ${missing ? 'missing' : ''}`, dataset: { id: v.id }, tabindex: '0' },
    h('div', { class: 'vrow-thumb' }, v.thumb && v.thumb !== 'none' ? h('img', { class: 'vimg', src: thumbUrl(v), alt: '', loading: 'lazy', draggable: 'false' }) : ic('film', 18)),
    h('div', { class: 'vrow-main' }, h('div', { class: 'vtitle' }, v.favourite ? ic('star', 13, 'fill star-mini') : null, videoTitle(v)), h('div', { class: 'vrow-path', title: v.path }, missing ? 'File moved or deleted' : splitPath(v.path)[0])),
    h('div', { class: 'chips' }, videoChips(v, idx)),
    h('span', { class: 'vrow-cell' }, v.duration ? fmtDuration(v.duration) : '—'),
    h('span', { class: 'vrow-cell' }, v.height ? `${v.height}p` : '—'),
    h('span', { class: 'vrow-cell' }, fmtBytes(v.size)),
    btn('', { kind: 'ghost sm', icon: 'more', title: 'More', onClick: (e) => { e.stopPropagation(); videoMenu(v, { anchor: e.currentTarget, align: 'end' }); } }));
  row.addEventListener('click', (e) => handleSelectClick(e, v, visibleVideos(libIndex())));
  wireVideoEl(row, v);
  return row;
}

function categoryTargets(idx, depth = 0, parent = null, out = []) {
  for (const c of idx.children.get(parent) || []) {
    out.push({ c, depth });
    categoryTargets(idx, depth + 1, c.id, out);
  }
  return out;
}

function pickCategoryMenu(anchorOrPos, ids, move) {
  const idx = libIndex();
  const targets = categoryTargets(idx).slice(0, 200);
  const items = [{ header: move ? 'Move to' : 'Add to' }];
  for (const { c, depth } of targets) {
    items.push({ label: `${' '.repeat(depth)}${c.name}`, swatch: c.color, run: () => {
      api.library.assign(ids, c.id, move);
      toast(`${move ? 'Moved' : 'Added'} ${plural(ids.length, 'video')} to ${c.name}`, { kind: 'ok', timeout: 2500 });
    } });
  }
  if (targets.length) items.push('-');
  items.push({ label: 'New category…', icon: 'plus', run: async () => {
    const cat = await newCategory(null, true);
    if (cat) api.library.assign(ids, cat.id, move);
  } });
  showMenu(items, anchorOrPos instanceof Element ? { anchor: anchorOrPos } : anchorOrPos);
}

function videoMenu(v, pos) {
  const L = S.lib;
  const ids = L.selected.has(v.id) ? [...L.selected] : [v.id];
  const many = ids.length > 1;
  const cat = !SPECIAL.includes(L.cat) ? libIndex().byId.get(L.cat) : null;
  showMenu([
    !many ? { label: 'Play', icon: 'play', run: () => playVideo(v) } : null,
    !many ? { label: 'Show in folder', icon: 'folderOpen', run: () => api.reveal(v.path) } : null,
    !many ? { label: 'Open with default player', icon: 'external', run: () => api.open(v.path) } : null,
    !many && v.source ? { label: 'Show original', icon: 'film', run: () => api.reveal(v.source) } : null,
    { label: v.favourite && !many ? 'Remove from favourites' : 'Add to favourites', icon: 'star', run: () => api.library.favourite(ids, !(v.favourite && !many)) },
    '-',
    { label: many ? `Convert ${ids.length} videos…` : 'Convert…', icon: 'convert', run: () => convertVideos(ids) },
    { label: many ? `Add ${ids.length} to category…` : 'Add to category…', icon: 'tag', run: () => pickCategoryMenu(pos, ids, false) },
    { label: 'Move to category…', icon: 'move', run: () => pickCategoryMenu(pos, ids, true) },
    cat ? { label: `Take out of ${cat.name}`, icon: 'minus', run: () => api.library.unassign(ids, cat.id) } : null,
    !many ? { label: 'Rename', icon: 'rename', run: () => renameVideo(v) } : null,
    !many ? { label: 'Properties', icon: 'info', run: () => videoProperties(v) } : null,
    '-',
    { label: many ? `Remove ${ids.length} from library` : 'Remove from library', icon: 'trash', danger: true, run: () => removeFromLibrary(ids) },
  ], pos);
}

function convertVideos(ids) {
  const vids = S.library.videos.filter((v) => ids.includes(v.id));
  const sel = h('select', { class: 'select wide' }, presetOptions(S.presets.selected));
  modal({
    title: vids.length === 1 ? `Convert “${videoTitle(vids[0])}”` : `Convert ${vids.length} videos`,
    body: h('div', { class: 'form' },
      h('p', { class: 'modal-text' }, 'The converted copy is saved in a “Converted” folder next to each video. The original stays as it is.'),
      h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Preset'), sel)),
    actions: [
      { label: 'Cancel', kind: 'ghost', value: null },
      { label: 'Convert', kind: 'primary', icon: 'convert', run: async (close) => {
        try {
          await api.startJob({ files: vids.map((v) => v.path), presetName: sel.value, options: { copyOthers: false, skipExisting: false, keepDates: true, addToLibrary: true, autoCategorize: false } });
          close();
          toast('Converting — follow it in Activity.', { kind: 'ok', action: { label: 'Activity', run: () => go('activity') } });
        } catch (e) {
          toast(cleanError(e), { kind: 'error' });
        }
      } },
    ],
  });
}

function videoProperties(v) {
  const idx = libIndex();
  const row = (k, val) => (val ? h('div', { class: 'prop' }, h('span', null, k), h('b', null, val)) : null);
  modal({
    title: videoTitle(v),
    body: h('div', { class: 'props' },
      v.thumb && v.thumb !== 'none' ? h('img', { class: 'prop-thumb', src: thumbUrl(v), alt: '' }) : null,
      row('File', v.name),
      row('Folder', splitPath(v.path)[0]),
      row('Size', fmtBytes(v.size)),
      row('Length', fmtDuration(v.duration)),
      row('Resolution', v.width ? `${v.width} × ${v.height}` : ''),
      row('Added', fmtWhen(v.addedAt)),
      row('Came from', { convert: 'Converted with Reframe', download: 'Downloaded', scan: 'Found by PC scan', import: 'Added from a folder' }[v.origin] || ''),
      row('Original', v.source || ''),
      row('Categories', v.categoryIds.map((id) => idx.byId.get(id)).filter(Boolean).map((c) => idx.trail(c.id).map((x) => x.name).join(' › ')).join(', '))),
    actions: [
      { label: 'Show in folder', kind: 'ghost', icon: 'folderOpen', run: () => api.reveal(v.path) },
      { label: 'Close', kind: 'primary', value: true },
    ],
  });
}

function categoryMenu(c, pos) {
  showMenu([
    { label: 'Open', icon: 'folderOpen', run: () => selectCat(c.id) },
    { label: 'New category inside', icon: 'plus', run: () => newCategory(c.id) },
    { label: 'Rename', icon: 'rename', run: async () => {
      const name = await promptBox({ title: 'Rename category', label: 'Name', value: c.name });
      if (name) api.library.updateCategory(c.id, { name });
    } },
    { label: 'Colour', icon: 'palette', run: () => colourMenu(c, pos) },
    c.parentId ? { label: 'Move to top level', icon: 'arrowLeft', run: () => api.library.updateCategory(c.id, { parentId: null }) } : null,
    '-',
    { label: 'Delete category', icon: 'trash', danger: true, run: async () => {
      const idx = libIndex();
      const kids = idx.descendants(c.id).length - 1;
      const ok = await confirmBox({
        title: `Delete “${c.name}”?`,
        message: `${kids ? `Its ${plural(kids, 'category', 'categories')} inside are deleted too. ` : ''}The videos stay in your library and on your PC — only the category is removed.`,
        confirm: 'Delete',
        danger: true,
      });
      if (ok) {
        if (S.lib.cat === c.id || idx.descendants(c.id).includes(S.lib.cat)) S.lib.cat = c.parentId || 'all';
        api.library.deleteCategory(c.id);
      }
    } },
  ], pos);
}

function colourMenu(c, pos) {
  showMenu([{ header: 'Colour' }, ...S.info.colors.map((col) => ({ label: '', swatch: col, checked: c.color === col, run: () => api.library.updateCategory(c.id, { color: col }) }))], pos);
}

async function newCategory(parentId, returnIt = false) {
  const idx = libIndex();
  const parent = parentId ? idx.byId.get(parentId) : null;
  const name = await promptBox({ title: parent ? `New category in ${parent.name}` : 'New category', label: 'Name', placeholder: 'e.g. Holidays', confirm: 'Create' });
  if (!name) return null;
  try {
    const cat = await api.library.createCategory({ name, parentId });
    if (parentId) S.lib.open.add(parentId);
    if (!returnIt) selectCat(cat.id);
    return cat;
  } catch (e) {
    toast(cleanError(e), { kind: 'error' });
    return null;
  }
}

async function renameVideo(v) {
  const name = await promptBox({ title: 'Rename in library', label: 'Name shown in the library (the file itself is not renamed)', value: videoTitle(v) });
  if (name) api.library.renameVideo(v.id, name);
}

async function removeFromLibrary(ids) {
  const ok = await confirmBox({
    title: ids.length > 1 ? `Remove ${ids.length} videos from the library?` : 'Remove this video from the library?',
    message: 'They are only removed from Reframe’s library. The video files stay on your PC.',
    confirm: 'Remove',
    danger: true,
  });
  if (!ok) return;
  ids.forEach((id) => S.lib.selected.delete(id));
  api.library.remove(ids);
}

async function importFolderFlow(root) {
  if (typeof root !== 'string') {
    root = await api.pickFolder({ title: 'Choose a folder of videos to add to the library' });
    if (!root) return;
  }
  const close = toast(`Looking for videos in “${baseName(root)}”…`, { timeout: 0 });
  try {
    const res = await api.library.importFolder(root, S.settings.autoCategorize);
    close();
    if (!res.found) {
      toast('No videos were found in that folder.', { kind: 'warn' });
      return;
    }
    toast(`${plural(res.found, 'video')} in the library${res.added < res.found ? ` (${res.found - res.added} were already there)` : ''}.`, { kind: 'ok' });
    go('library');
    if (res.categoryId) selectCat(res.categoryId);
  } catch (e) {
    close();
    toast(cleanError(e), { kind: 'error' });
  }
}

function openLibraryFor(job) {
  const idx = libIndex();
  const root = idx.categories.find((c) => c.name.toLowerCase() === job.name.toLowerCase());
  go('library');
  selectCat(root ? root.id : 'all');
}

// ---------- player ----------
function playVideo(v) {
  if (S.missing.has(v.id)) {
    toast('This video has been moved or deleted since it was added.', { kind: 'warn' });
    return;
  }
  playPath(v.path, videoTitle(v), v);
}

function playPath(p, title) {
  stopPreview();
  const video = h('video', { class: 'player-video', controls: true, autoplay: true, src: mediaUrl(p) });
  const fallback = h('div', { class: 'player-fallback', hidden: true },
    ic('film', 34),
    h('h3', null, 'This format can’t play inside Reframe'),
    h('p', null, 'Open it in your normal video player instead.'),
    btn('Open in default player', { kind: 'primary', icon: 'external', onClick: () => api.open(p) }));
  video.addEventListener('error', () => {
    video.hidden = true;
    fallback.hidden = false;
  });
  modal({
    title,
    className: 'player',
    wide: true,
    body: h('div', { class: 'player-body' }, video, fallback,
      h('div', { class: 'player-bar' },
        h('span', { class: 'player-path', title: p }, p),
        btn('Show in folder', { kind: 'ghost sm', icon: 'folderOpen', onClick: () => api.reveal(p) }),
        btn('Open externally', { kind: 'ghost sm', icon: 'external', onClick: () => api.open(p) }))),
    onClose: () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  });
}

// ---------- thumbnails ----------
// Made in the background by loading each video into a hidden player and
// grabbing a frame. Formats Chromium can't decode fall back to FFmpeg when
// it's installed, otherwise they get a placeholder.
const thumbQueue = [];
let thumbBusy = false;

function queueThumbs() {
  const queued = new Set(thumbQueue);
  for (const v of S.library.videos) {
    if (!v.thumb && !queued.has(v.id) && !S.missing.has(v.id)) thumbQueue.push(v.id);
  }
  runThumbs();
}

async function runThumbs() {
  if (thumbBusy) return;
  thumbBusy = true;
  while (thumbQueue.length) {
    const id = thumbQueue.shift();
    const v = S.library.videos.find((x) => x.id === id);
    if (!v || v.thumb) continue;
    const res = PLAYABLE.test(v.path) ? await grabFrame(v.path) : { dataUrl: null, meta: {} };
    if (!res.dataUrl && S.tools && S.tools.ffmpeg && S.tools.ffmpeg.installed) {
      if (await api.library.probe(v.id)) continue;
    }
    await api.library.saveThumb(v.id, res.dataUrl, res.meta);
  }
  thumbBusy = false;
}

// Main sends thumbnail updates as small patches; update the cards in place.
function onLibraryPatch(p) {
  const v = S.library.videos.find((x) => x.id === p.id);
  if (!v) return;
  Object.assign(v, p);
  if (S.page !== 'library') return;
  for (const el of document.querySelectorAll(`[data-id="${p.id}"]`)) {
    const box = el.querySelector('.vthumb, .vrow-thumb');
    if (!box) continue;
    const old = box.querySelector('.vimg, .vthumb-ph, :scope > svg');
    if (v.thumb && v.thumb !== 'none' && old) {
      old.replaceWith(h('img', { class: 'vimg', src: thumbUrl(v), alt: '', draggable: 'false' }));
    }
    if (v.duration && el.classList.contains('vcard') && !box.querySelector('.vdur')) box.append(h('span', { class: 'vdur' }, fmtDuration(v.duration)));
    const meta = el.querySelector('.vmeta');
    if (meta && v.height) meta.textContent = [v.height >= 2000 ? '4K' : `${v.height}p`, fmtBytes(v.size)].join(' · ');
  }
}

function grabFrame(p) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    let done = false;
    const finish = (dataUrl, meta = {}) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      resolve({ dataUrl, meta });
    };
    const timer = setTimeout(() => finish(null, { duration: isFinite(video.duration) ? video.duration : 0 }), 15000);
    video.addEventListener('error', () => finish(null));
    // Some files (often WebM) don't store their length. Seeking far past the
    // end makes the browser work it out, then we seek back to the frame.
    let probing = false;
    const seekToFrame = () => {
      const d = video.duration;
      video.currentTime = isFinite(d) && d > 0 ? Math.min(d * 0.2, 45) : 1;
    };
    video.addEventListener('loadedmetadata', () => {
      if (!isFinite(video.duration)) {
        probing = true;
        video.currentTime = 1e9;
      } else seekToFrame();
    });
    video.addEventListener('seeked', () => {
      if (done) return;
      if (probing) {
        probing = false;
        seekToFrame();
        return;
      }
      const w = video.videoWidth;
      const hgt = video.videoHeight;
      const meta = { duration: isFinite(video.duration) ? video.duration : 0, width: w, height: hgt };
      if (!w || !hgt) return finish(null, meta);
      const canvas = document.createElement('canvas');
      canvas.width = 480;
      canvas.height = 270;
      const ctx = canvas.getContext('2d');
      const scale = Math.max(480 / w, 270 / hgt);
      const dw = w * scale;
      const dh = hgt * scale;
      ctx.drawImage(video, (480 - dw) / 2, (270 - dh) / 2, dw, dh);
      try {
        finish(canvas.toDataURL('image/jpeg', 0.82), meta);
      } catch {
        finish(null, meta);
      }
    });
    video.src = mediaUrl(p);
  });
}

// ---------- PC scan ----------
async function askScan(firstRun) {
  const roots = await api.pcscan.roots();
  return new Promise((resolve) => {
    modal({
      title: firstRun ? 'Welcome to Reframe' : 'Find the videos on your PC',
      className: 'scan-ask',
      body: h('div', { class: 'scan-ask-body' },
        h('div', { class: 'scan-ask-art' }, h('img', { src: 'assets/logo.svg', width: 64, height: 64, alt: '' })),
        firstRun ? h('div', { class: 'eyebrow center' }, 'You reframe a picture. ', h('b', null, 'We reframe a video.')) : null,
        h('h3', null, 'Would you like me to scan your computer for video files and sort them into categories for you?'),
        h('p', { class: 'modal-text' }, 'Reframe looks in these places and skips Windows, programs and games. Nothing is moved, changed or uploaded — it only makes your library.'),
        h('div', { class: 'scan-places' }, roots.map((r) => h('span', { class: 'chip-static' }, ic(/^[A-Z]:\\$/.test(r.path) ? 'drive' : 'folder', 14), r.label))),
        h('p', { class: 'fine' }, 'You can hide or remove what it finds any time in Settings.')),
      actions: [
        { label: firstRun ? 'No thanks' : 'Cancel', kind: 'ghost', value: false },
        { label: 'Yes, scan my PC', kind: 'primary', icon: 'scan', value: true, autofocus: true },
      ],
      onClose: (yes) => {
        if (firstRun) api.setSettings({ firstRunDone: true });
        if (yes) startScan();
        resolve(!!yes);
      },
    });
  });
}

function startScan() {
  if (S.settings.showScanned === false) {
    S.settings.showScanned = true;
    api.setSettings({ showScanned: true });
  }
  api.pcscan.start();
}

function onScanProgress(p) {
  const pill = $('#scanPill');
  S.scan = p;
  if (p.running) {
    pill.hidden = false;
    pill.innerHTML = '';
    append(pill, [
      h('div', { class: 'spinner small' }),
      h('div', { class: 'sp-text' },
        h('div', { class: 'sp-title' }, 'Scanning your PC'),
        h('div', { class: 'sp-sub' }, `${(p.folders || 0).toLocaleString()} folders · ${`${(p.found || 0).toLocaleString()} videos found`}`)),
      btn('Stop', { kind: 'ghost sm', onClick: () => api.pcscan.stop() }),
    ]);
    return;
  }
  pill.hidden = true;
  if (p.error) toast(`The scan stopped: ${p.error}`, { kind: 'error' });
  else if (p.done) {
    toast(p.found ? `Found ${plural(p.found, 'video')} on your PC${p.added < p.found ? ` (${p.added} new)` : ''}.` : 'No videos were found on your PC.', {
      kind: p.found ? 'ok' : 'info',
      timeout: 8000,
      action: p.found ? { label: 'Show me', run: () => { go('library'); selectCat(p.categoryId); } } : null,
    });
    if (p.found) confetti();
  }
}
