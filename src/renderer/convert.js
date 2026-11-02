'use strict';
// Convert page: choose a folder, preview the mirrored output, pick a preset, start.

async function chooseSource(root) {
  if (!root) {
    root = await api.pickFolder({ title: 'Choose the folder of videos to convert' });
    if (!root) return;
  }
  const info = await api.inspect(root);
  if (!info.exists || !info.isDir) {
    toast('That is a file, not a folder. Drop or choose a folder of videos.', { kind: 'warn' });
    return;
  }
  const C = S.convert;
  C.source = root;
  C.scan = null;
  C.destCustom = false;
  C.dest = await api.defaultDest(root);
  C.scanning = true;
  C.expanded = new Set(['']);
  C.showFiles = true;
  go('convert');
  renderConvert();
  await rescan();
}

async function rescan() {
  const C = S.convert;
  const source = C.source;
  C.scanning = true;
  renderConvert();
  try {
    const scan = await api.scan(source, [C.dest]);
    if (C.source !== source) return;
    C.scan = scan;
    // Open the first level of folders so the structure is visible at a glance.
    C.expanded = new Set(['', ...scan.tree.dirs.filter((d) => d.totalVideos <= 40).map((d) => d.rel)]);
    C.showFiles = scan.totals.videos <= 400;
    C.free = await api.freeSpace(C.dest);
  } catch (e) {
    toast(`Could not read that folder: ${e.message}`, { kind: 'error' });
    C.source = null;
  }
  C.scanning = false;
  renderConvert();
}

function currentPreset() {
  const name = S.convert.preset || (S.presets && S.presets.selected);
  for (const g of (S.presets ? S.presets.groups : [])) {
    const p = g.presets.find((x) => x.name === name);
    if (p) return p;
  }
  return null;
}

function presetTags(p) {
  const tags = [];
  if (p.height) tags.push(p.height >= 2000 ? '4K' : `${p.height}p`);
  tags.push(p.ext.slice(1).toUpperCase());
  const enc = (p.encoder || '').toLowerCase();
  if (enc.includes('nvenc')) tags.push('NVIDIA');
  else if (enc.includes('qsv')) tags.push('Intel QSV');
  else if (enc.includes('vce') || enc.includes('vcn')) tags.push('AMD GPU');
  else if (enc.includes('265') || enc.includes('hevc')) tags.push('H.265');
  else if (enc.includes('264')) tags.push('H.264');
  else if (enc.includes('av1')) tags.push('AV1');
  else if (enc.includes('vp9')) tags.push('VP9');
  return tags;
}

function openPresetPicker(anchor) {
  const search = h('input', { class: 'input search-input', placeholder: 'Search presets', spellcheck: 'false' });
  const list = h('div', { class: 'preset-list' });
  const selected = currentPreset();
  let close;
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = '';
    let count = 0;
    for (const g of S.presets.groups) {
      const items = g.presets.filter((p) => !q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || g.name.toLowerCase().includes(q));
      if (!items.length) continue;
      list.append(h('div', { class: 'preset-group' }, g.name, g.custom ? h('span', { class: 'mini-pill accent' }, 'Yours') : null));
      for (const p of items) {
        count++;
        list.append(h('button', {
          class: `preset-row ${selected && p.name === selected.name ? 'active' : ''}`,
          onclick: () => {
            S.convert.preset = p.name;
            api.setSettings({ presetName: p.name });
            S.presets.selected = p.name;
            close();
            renderConvert();
          },
        },
        h('div', { class: 'preset-row-main' },
          h('div', { class: 'preset-row-name' }, p.name, p.custom ? h('span', { class: 'mini-pill accent' }, 'Custom') : null),
          p.description ? h('div', { class: 'preset-row-desc' }, p.description) : null),
        h('div', { class: 'preset-row-tags' }, presetTags(p).map((t) => h('span', { class: 'tag' }, t))),
        selected && p.name === selected.name ? ic('check', 16, 'preset-check') : null));
      }
    }
    if (!count) list.append(h('div', { class: 'preset-none' }, 'No presets match.'));
  };
  search.addEventListener('input', draw);
  draw();
  close = popover(h('div', { class: 'preset-pop' }, h('div', { class: 'preset-search' }, ic('search', 16), search), list), anchor, { className: 'wide' });
  setTimeout(() => {
    search.focus();
    const act = list.querySelector('.active');
    if (act) act.scrollIntoView({ block: 'center' });
  }, 20);
}

function treeView(scan, dest, ext) {
  const C = S.convert;
  const rootLabel = baseName(dest);
  const wrap = h('div', { class: 'tree' });

  const outName = (name, taken) => {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const old = dot > 0 ? name.slice(dot + 1) : 'video';
    let out = stem + ext;
    if (taken.has(out.toLowerCase())) {
      out = `${stem} (${old})${ext}`;
      for (let n = 2; taken.has(out.toLowerCase()); n++) out = `${stem} (${old} ${n})${ext}`;
    }
    taken.add(out.toLowerCase());
    return out;
  };

  const renderNode = (node, depth) => {
    const isRoot = depth === 0;
    const open = C.expanded.has(node.rel);
    const hasKids = node.dirs.length || node.videos.length || node.others.length;
    const row = h('div', {
      class: `tree-row dir ${isRoot ? 'root' : ''} ${open ? 'open' : ''}`,
      style: { '--depth': depth },
      onclick: () => {
        if (!hasKids) return;
        if (open) C.expanded.delete(node.rel);
        else C.expanded.add(node.rel);
        renderConvert();
      },
    },
    h('span', { class: `twisty ${hasKids ? '' : 'none'}` }, ic('chevronRight', 14)),
    h('span', { class: 'tree-icon folder' }, ic(open ? 'folderOpen' : 'folder', 17)),
    h('span', { class: 'tree-name' }, isRoot ? rootLabel : node.name),
    h('span', { class: 'tree-meta' }, node.totalVideos ? plural(node.totalVideos, 'video') : 'no videos'));
    wrap.append(row);
    if (!open) return;
    for (const d of node.dirs) renderNode(d, depth + 1);
    if (C.showFiles) {
      // Mirror the same naming rules as the converter, keeping files whose
      // extension already matches first.
      const taken = new Set(node.others.map((o) => o.name.toLowerCase()));
      const ordered = [...node.videos].sort((a, b) => (a.name.toLowerCase().endsWith(ext) ? 0 : 1) - (b.name.toLowerCase().endsWith(ext) ? 0 : 1));
      const names = new Map(ordered.map((v) => [v.rel, outName(v.name, taken)]));
      for (const v of node.videos) {
        const out = names.get(v.rel);
        wrap.append(h('div', { class: 'tree-row file', style: { '--depth': depth + 1 } },
          h('span', { class: 'twisty none' }),
          h('span', { class: 'tree-icon video' }, ic('film', 16)),
          h('span', { class: 'tree-name' }, v.name),
          out !== v.name ? h('span', { class: 'tree-arrow' }, ic('arrowRight', 13), h('span', null, out)) : h('span', { class: 'tree-arrow same' }, 're-encoded'),
          h('span', { class: 'tree-meta' }, fmtBytes(v.size))));
      }
      if (node.others.length) {
        wrap.append(h('div', { class: `tree-row other ${S.settings.copyOthers ? '' : 'excluded'}`, style: { '--depth': depth + 1 } },
          h('span', { class: 'twisty none' }),
          h('span', { class: 'tree-icon' }, ic('copy', 15)),
          h('span', { class: 'tree-name' }, `${plural(node.others.length, 'other file')}`),
          h('span', { class: 'tree-arrow same' }, S.settings.copyOthers ? 'copied as-is' : 'not copied'),
          h('span', { class: 'tree-meta' }, fmtBytes(node.others.reduce((n, o) => n + o.size, 0)))));
      }
    }
  };
  renderNode(scan.tree, 0);
  return wrap;
}

function renderConvert() {
  const page = $('#page-convert');
  const C = S.convert;
  page.innerHTML = '';

  if (!C.source) {
    page.append(h('div', { class: 'convert-empty' },
      h('div', {
        class: 'dropzone tilt spot',
        tabindex: '0',
        onclick: () => chooseSource(),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') chooseSource();
        },
      },
      h('div', { class: 'dz-art' },
        h('div', { class: 'dz-folder back' }), h('div', { class: 'dz-folder mid' }),
        h('div', { class: 'dz-folder front' }, ic('film', 30))),
      h('div', { class: 'eyebrow' }, 'You reframe a picture. ', h('b', null, 'We reframe a video.')),
      h('h1', null, 'Convert a whole folder'),
      h('p', null, 'Drop a folder here, or choose one. Every video inside it, and inside every folder within it, is converted with HandBrake into a new copy of the folder. Everything stays exactly where it was.'),
      h('div', { class: 'dz-actions' },
        btn('Choose folder', { kind: 'primary', size: 'lg', icon: 'folderOpen', onClick: (e) => { e.stopPropagation(); chooseSource(); } }),
        btn('Convert from your media library', { kind: 'ghost', size: 'lg', icon: 'library', onClick: (e) => { e.stopPropagation(); pickFromLibrary(); } })),
      h('div', { class: 'dz-hint' }, 'or drag a folder anywhere onto this window')),
      h('div', { class: 'explainer' },
        h('div', { class: 'ex-col' },
          h('div', { class: 'ex-label' }, 'You send'),
          miniTree('Holiday', ['Beach', 'Hotel', 'Day trips'], 'IMG_2041.MOV', false)),
        h('div', { class: 'ex-arrow' }, ic('arrowRight', 22)),
        h('div', { class: 'ex-col' },
          h('div', { class: 'ex-label' }, 'You get'),
          miniTree('Holiday converted', ['Beach', 'Hotel', 'Day trips'], 'IMG_2041.mp4', true))),
      h('div', { class: 'promises' },
        promise('shield', 'Originals untouched', 'Your videos are only read, never changed, moved or deleted.'),
        promise('layers', 'Same layout', 'Every folder and file lands in the same place in the copy.'),
        promise('sparkles', 'Auto-sorted library', 'Converted videos appear in your media library, sorted by folder.'))));
    stagger(page.firstChild);
    return;
  }

  const scan = C.scan;
  const preset = currentPreset();
  const ext = preset ? preset.ext : '.mp4';

  const header = h('div', { class: 'page-head' },
    h('button', { class: 'btn ghost icon-only back', title: 'Choose a different folder', 'aria-label': 'Choose a different folder', onclick: () => { C.source = null; C.scan = null; renderConvert(); } }, ic('arrowLeft', 18)),
    h('div', { class: 'head-icon' }, ic('folder', 22)),
    h('div', { class: 'head-text' },
      h('h1', null, baseName(C.source)),
      h('div', { class: 'head-path', title: C.source }, C.source)),
    h('div', { class: 'head-actions' },
      btn('Rescan', { kind: 'ghost', icon: 'retry', onClick: rescan, disabled: C.scanning }),
      btn('Other folder', { kind: 'ghost', icon: 'folderOpen', onClick: () => chooseSource() })));
  page.append(header);

  if (C.scanning || !scan) {
    page.append(h('div', { class: 'scanning' }, h('div', { class: 'spinner' }), h('div', null, 'Looking through every folder…')));
    return;
  }

  const t = scan.totals;
  page.append(h('div', { class: 'stats-row' },
    stat('film', plural(t.videos, 'video'), 'to convert'),
    stat('folder', plural(t.dirs, 'folder'), 'inside'),
    stat('drive', fmtBytes(t.videoBytes), 'of video'),
    stat('copy', plural(t.others, 'other file'), S.settings.copyOthers ? 'copied too' : 'left out')));

  if (scan.totals.errors.length) {
    page.append(h('div', { class: 'notice warn' }, ic('alert', 18), h('div', null, `${plural(scan.totals.errors.length, 'folder')} could not be opened and will be left out.`)));
  }

  if (!t.videos) {
    page.append(emptyState({
      iconName: 'film',
      title: 'No videos in this folder',
      text: 'Reframe looked through every folder inside it and did not find any video files.',
      actions: [btn('Choose another folder', { kind: 'primary', icon: 'folderOpen', onClick: () => chooseSource() })],
    }));
    return;
  }

  const left = h('div', { class: 'card tree-card' },
    h('div', { class: 'card-head' },
      h('div', null, h('h2', null, 'What you’ll get'), h('p', { class: 'card-sub' }, 'A new folder that looks exactly like the original, with converted videos.')),
      h('div', { class: 'seg' },
        h('button', { class: C.showFiles ? '' : 'on', onclick: () => { C.showFiles = false; renderConvert(); } }, 'Folders'),
        h('button', { class: C.showFiles ? 'on' : '', onclick: () => { C.showFiles = true; renderConvert(); } }, 'Folders & files'))),
    h('div', { class: 'tree-actions' },
      h('button', { class: 'link', onclick: () => { C.expanded = new Set(['', ...allDirs(scan.tree)]); renderConvert(); } }, 'Expand all'),
      h('button', { class: 'link', onclick: () => { C.expanded = new Set(['']); renderConvert(); } }, 'Collapse all')),
    treeView(scan, C.dest, ext));

  const freeLow = C.free !== null && C.free !== undefined && C.free < t.videoBytes * 0.6;
  const destCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Save the copy to')),
    h('div', { class: 'path-field' },
      h('span', { class: 'path-icon' }, ic('folder', 18)),
      h('div', { class: 'path-text' },
        h('div', { class: 'path-name' }, baseName(C.dest)),
        h('div', { class: 'path-dir', title: C.dest }, splitPath(C.dest)[0])),
      btn('Change', {
        kind: 'ghost',
        onClick: async () => {
          const p = await api.pickFolder({ title: 'Choose where the converted copy goes', defaultPath: splitPath(C.dest)[0] });
          if (!p) return;
          if (p.toLowerCase() === C.source.toLowerCase()) {
            toast('Choose a different folder — the copy cannot go into the original folder itself.', { kind: 'warn' });
            return;
          }
          // Picking a folder puts the copy inside it, named like the original.
          C.dest = `${p.replace(/[\\/]+$/, '')}\\${baseName(C.dest)}`;
          C.destCustom = true;
          C.free = await api.freeSpace(C.dest);
          renderConvert();
        },
      }),
      C.destCustom ? btn('', {
        kind: 'ghost',
        icon: 'retry',
        title: 'Back to the default location',
        onClick: async () => {
          C.dest = await api.defaultDest(C.source);
          C.destCustom = false;
          C.free = await api.freeSpace(C.dest);
          renderConvert();
        },
      }) : null),
    C.free !== null && C.free !== undefined ? h('div', { class: `free ${freeLow ? 'low' : ''}` }, ic(freeLow ? 'alert' : 'drive', 15),
      freeLow ? `Only ${fmtBytes(C.free)} free on this drive. Converted videos are usually smaller, but this may run out.` : `${fmtBytes(C.free)} free on this drive`) : null);

  const presetCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Preset'), S.presets && S.presets.source ? h('span', { class: 'card-note' }, 'From your HandBrake app') : null),
    h('button', { class: 'preset-button', onclick: (e) => openPresetPicker(e.currentTarget) },
      h('div', { class: 'preset-main' },
        h('div', { class: 'preset-name' }, preset ? preset.name : 'Choose a preset', preset && preset.custom ? h('span', { class: 'mini-pill accent' }, 'Custom') : null),
        preset && preset.description ? h('div', { class: 'preset-desc' }, preset.description) : null,
        preset ? h('div', { class: 'preset-tags' }, presetTags(preset).map((x) => h('span', { class: 'tag' }, x))) : null),
      ic('chevronDown', 18, 'preset-caret')));

  const set = (k) => (v) => {
    S.settings[k] = v;
    api.setSettings({ [k]: v });
    renderConvert();
  };
  const optionsCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', null, 'Options')),
    h('div', { class: 'options' },
      toggle({ iconName: 'copy', label: 'Copy the other files too', hint: 'Photos, subtitles and documents are copied as-is so the copy is complete.', checked: S.settings.copyOthers, onChange: set('copyOthers') }),
      toggle({ iconName: 'skip', label: 'Skip videos already converted', hint: 'Run the same folder again and only new videos are converted.', checked: S.settings.skipExisting, onChange: set('skipExisting') }),
      toggle({ iconName: 'calendar', label: 'Keep original dates', hint: 'Converted files keep the date the original was made.', checked: S.settings.keepDates, onChange: set('keepDates') }),
      toggle({ iconName: 'library', label: 'Add to media library', hint: 'Sorted into categories that match the folders.', checked: S.settings.addToLibrary, onChange: set('addToLibrary') })));

  const speedCard = speedPanel(preset);

  const start = h('button', {
    class: 'btn primary xl start shine',
    disabled: !preset,
    onclick: async (e) => {
      const b = e.currentTarget;
      b.disabled = true;
      try {
        await api.startJob({
          source: C.source,
          dest: C.dest,
          presetName: preset.name,
          options: {
            copyOthers: S.settings.copyOthers,
            skipExisting: S.settings.skipExisting,
            keepDates: S.settings.keepDates,
            addToLibrary: S.settings.addToLibrary,
            autoCategorize: S.settings.autoCategorize,
          },
        });
        toast(`Started converting “${baseName(C.source)}”`, { kind: 'ok' });
        C.source = null;
        C.scan = null;
        go('activity');
      } catch (err) {
        b.disabled = false;
        toast(cleanError(err), { kind: 'error', timeout: 7000 });
      }
    },
  }, h('span', null, `Convert ${plural(t.videos, 'video')}`), ic('arrowRight', 20));

  const right = h('div', { class: 'side-col' }, destCard, presetCard, speedCard, optionsCard,
    h('div', { class: 'start-wrap' }, start, h('div', { class: 'start-note' }, ic('shield', 14), 'Your original videos are never changed')));

  page.append(h('div', { class: 'convert-grid' }, left, right));
  stagger(right);
}

// How fast this will go: parallel videos (automatic) and the GPU Turbo switch.
function speedPanel(preset) {
  const card = h('div', { class: 'card speed-card' });
  const draw = (plan) => {
    card.innerHTML = '';
    const gpuName = (S.info.gpu && S.info.gpu.name) || 'your graphics card';
    card.append(h('div', { class: 'card-head' }, h('h2', null, 'Speed'),
      h('span', { class: 'speed-badge' }, ic('bolt', 14), plan ? `${plural(plan.parallel, 'video')} at once` : '…')));
    card.append(h('div', { class: 'options' },
      toggle({
        iconName: 'bolt',
        label: 'Turbo — use the graphics card',
        hint: plan && plan.canTurbo
          ? `Encodes on ${gpuName}. Faster — most of all on long or HD videos. Same size and settings as the preset; files can be a little bigger for the same quality.`
          : 'This preset can’t use the graphics card on this PC.',
        checked: !!S.settings.turbo && !!(plan && plan.canTurbo),
        disabled: !(plan && plan.canTurbo),
        onChange: async (v) => {
          S.settings = await api.setSettings({ turbo: v });
          draw(await api.speedPlan(preset.name));
        },
      })));
    card.append(h('p', { class: 'card-foot-note' }, S.settings.concurrency ? `Set to ${S.settings.concurrency} at a time in Settings.` : `Reframe picks how many videos to convert side by side for this preset and your ${S.info.cores}-thread processor — same quality, done sooner.`));
  };
  draw(null);
  if (preset) api.speedPlan(preset.name).then(draw);
  return card;
}

// Pick videos from the media library to convert (any category, searchable).
function pickFromLibrary() {
  const idx = libIndex();
  if (!idx.videos.length) {
    toast('Your library is empty — convert a folder, download something or scan your PC first.', { kind: 'info' });
    return;
  }
  const chosen = new Set();
  let q = '';
  let cat = 'all';
  const list = h('div', { class: 'pick-list' });
  const count = h('span', { class: 'card-sub' });
  const next = btn('Choose preset', { kind: 'primary', icon: 'arrowRight', disabled: true });
  const visible = () => idx.videos.filter((v) => (cat === 'all' || v.categoryIds.some((c) => idx.descendants(cat).includes(c)))
    && (!q || videoTitle(v).toLowerCase().includes(q) || v.path.toLowerCase().includes(q)));
  const draw = () => {
    const vids = visible().slice(0, 400);
    list.innerHTML = '';
    for (const v of vids) {
      const on = chosen.has(v.id);
      list.append(h('button', {
        class: `pick-row ${on ? 'on' : ''}`,
        onclick: () => { if (on) chosen.delete(v.id); else chosen.add(v.id); draw(); },
      },
      h('span', { class: `vcheck static ${on ? 'on' : ''}` }, ic('check', 13)),
      h('span', { class: 'vrow-thumb' }, v.thumb && v.thumb !== 'none' ? h('img', { class: 'vimg', src: thumbUrl(v), alt: '' }) : ic('film', 16)),
      h('span', { class: 'pick-text' }, h('span', { class: 'vtitle' }, videoTitle(v)), h('span', { class: 'card-sub' }, [v.height ? `${v.height}p` : '', fmtBytes(v.size), v.duration ? fmtDuration(v.duration) : ''].filter(Boolean).join(' · ')))));
    }
    if (!vids.length) list.append(h('div', { class: 'palette-none' }, 'No videos match.'));
    count.textContent = chosen.size ? `${plural(chosen.size, 'video')} chosen` : 'Tick the videos to convert';
    next.disabled = !chosen.size;
  };
  const search = h('input', { class: 'input', placeholder: 'Search your library', spellcheck: 'false' });
  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); draw(); });
  const catSel = h('select', { class: 'select' }, h('option', { value: 'all' }, 'All videos'),
    categoryTargets(idx).slice(0, 300).map(({ c, depth }) => h('option', { value: c.id }, `${'  '.repeat(depth)}${c.name}`)));
  catSel.addEventListener('change', () => { cat = catSel.value; draw(); });
  const close = modal({
    title: 'Convert from your media library',
    wide: true,
    body: h('div', { class: 'form' },
      h('p', { class: 'modal-text' }, 'Each converted copy is saved in a “Converted” folder next to its original. The originals stay as they are.'),
      h('div', { class: 'pick-tools' }, search, catSel,
        btn('Select all shown', { kind: 'ghost sm', onClick: () => { visible().forEach((v) => chosen.add(v.id)); draw(); } }),
        btn('Clear', { kind: 'ghost sm', onClick: () => { chosen.clear(); draw(); } })),
      list,
      h('div', { class: 'pick-foot' }, count, next)),
  });
  next.addEventListener('click', () => { close(); convertVideos([...chosen]); });
  draw();
  setTimeout(() => search.focus(), 40);
}

function allDirs(node, out = []) {
  for (const d of node.dirs) {
    out.push(d.rel);
    allDirs(d, out);
  }
  return out;
}

function stat(iconName, value, label) {
  return h('div', { class: 'stat spot' }, h('span', { class: 'stat-icon' }, ic(iconName, 18)), h('div', null, h('div', { class: 'stat-value' }, value), h('div', { class: 'stat-label' }, label)));
}

function promise(iconName, title, text) {
  return h('div', { class: 'promise spot tilt' }, h('span', { class: 'promise-icon' }, ic(iconName, 20)), h('div', null, h('h4', null, title), h('p', null, text)));
}

function miniTree(root, dirs, file, converted) {
  return h('div', { class: `mini-tree ${converted ? 'converted' : ''}` },
    h('div', { class: 'mt-row root' }, ic('folder', 15), root),
    dirs.map((d) => h('div', { class: 'mt-row' }, ic('folder', 14), d)),
    h('div', { class: 'mt-row' }, ic('film', 14), file));
}

function cleanError(err) {
  const msg = (err && err.message) || String(err);
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
