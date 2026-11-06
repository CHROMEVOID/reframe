'use strict';
// Online video downloader page.

const BROWSERS = [['', 'Off'], ['chrome', 'Chrome'], ['edge', 'Edge'], ['firefox', 'Firefox'], ['brave', 'Brave'], ['opera', 'Opera']];

async function refreshTools() {
  S.tools = await api.tools.status();
  if (S.page === 'download') renderDownload();
}

async function installTool(name) {
  S.toolProgress[name] = { done: 0, total: 0 };
  RENDER[S.page]();
  try {
    S.tools = await api.tools.install(name);
    toast(name === 'ytdlp' ? 'The video downloader is ready.' : 'FFmpeg is installed — downloads now come in the best quality.', { kind: 'ok' });
  } catch (e) {
    toast(`Couldn’t download it: ${cleanError(e)}`, { kind: 'error', timeout: 7000 });
  }
  delete S.toolProgress[name];
  RENDER[S.page]();
}

function toolProgressBar(name) {
  const p = S.toolProgress[name];
  if (!p) return null;
  const pct = p.total ? (p.done / p.total) * 100 : 0;
  return h('div', { class: 'tool-progress', dataset: { tool: name } },
    h('div', { class: 'bar' }, h('i', { style: { width: `${pct}%` } })),
    h('span', null, p.total ? `${fmtBytes(p.done)} of ${fmtBytes(p.total)}` : 'Starting…'));
}

async function fetchLink(url) {
  const D = S.dl;
  url = (url || '').trim();
  if (!url) return;
  // Several links pasted at once go straight into the queue.
  const many = url.split(/\s+/).filter((u) => /^https?:\/\//i.test(u));
  if (many.length > 1) {
    await api.dl.start({ urls: [...new Set(many)] });
    toast(`Queued ${many.length} links — follow them in Activity.`, { kind: 'ok', action: { label: 'Activity', run: () => go('activity') } });
    D.url = '';
    D.info = null;
    renderDownload();
    return;
  }
  D.url = url;
  D.loading = true;
  D.info = null;
  D.error = '';
  renderDownload();
  try {
    D.info = await api.dl.inspect(url, D.cookies);
    const hs = D.info.heights || [];
    if (D.quality !== 'audio' && D.quality !== 'best' && hs.length && !hs.some((x) => x >= +D.quality)) D.quality = 'best';
  } catch (e) {
    D.error = cleanError(e);
  }
  D.loading = false;
  renderDownload();
}

async function startDownload() {
  const D = S.dl;
  try {
    await api.dl.start({ url: D.url, info: D.info, quality: D.quality, playlist: D.playlist, cookiesBrowser: D.cookies });
    toast(S.hidden ? 'Download started.' : `Downloading “${D.info ? D.info.title : D.url}”`, { kind: 'ok' });
    D.url = '';
    D.info = null;
    renderDownload();
  } catch (e) {
    toast(cleanError(e), { kind: 'error' });
  }
}

function renderDownload() {
  const page = $('#page-download');
  const D = S.dl;
  const T = S.tools || { ytdlp: {}, ffmpeg: {} };
  page.innerHTML = '';

  const input = h('input', {
    class: 'url-input',
    placeholder: 'Paste a video link…',
    value: D.url || '',
    spellcheck: 'false',
    onkeydown: (e) => {
      if (e.key === 'Enter') fetchLink(input.value);
    },
    onpaste: () => setTimeout(() => fetchLink(input.value), 30),
  });

  page.append(h('div', { class: 'dl-hero' },
    h('div', { class: 'dl-hero-art' }, ic('download', 30)),
    h('h1', null, 'Download any video'),
    h('p', null, 'Paste a link from YouTube, TikTok, Instagram, X, Facebook, Vimeo, Reddit, Twitch, Dailymotion and over a thousand other sites — or any direct video link.'),
    h('div', { class: 'url-bar spot' },
      ic('link', 20),
      input,
      btn('Paste', {
        kind: 'ghost',
        icon: 'clipboard',
        onClick: async () => {
          const t = (await api.readClipboard()).trim();
          if (!t) {
            toast('Your clipboard is empty.', { kind: 'warn' });
            return;
          }
          input.value = t;
          fetchLink(t);
        },
      }),
      btn(D.loading ? 'Looking…' : 'Get video', { kind: 'primary', icon: D.loading ? null : 'arrowRight', disabled: D.loading, onClick: () => fetchLink(input.value) })),
    h('div', { class: 'dl-sub-actions' },
      h('button', { class: 'chip-btn', onclick: () => api.capture(null) }, ic('globe', 14), ' Open the Capture browser'),
      D.clip && D.clip !== D.url ? h('button', { class: 'chip-btn clip', onclick: () => { input.value = D.clip; fetchLink(D.clip); } }, ic('clipboard', 14), ` Use copied link: ${D.clip.replace(/^https?:\/\/(www\.)?/, '').slice(0, 42)}`) : null)));
  // Offer a link that's sitting on the clipboard.
  api.readClipboard().then((t) => {
    const u = (t || '').trim();
    if (/^https?:\/\/\S+$/i.test(u) && u !== D.clip && u !== D.url) {
      D.clip = u;
      renderDownload();
    }
  });

  if (!T.ytdlp.installed) {
    page.append(h('div', { class: 'card setup-card tilt' },
      h('div', { class: 'setup-icon' }, ic('wand', 26)),
      h('div', { class: 'setup-text' },
        h('h3', null, 'One quick setup'),
        h('p', null, 'To download from websites, Reframe needs its video engine (yt-dlp, 23 MB, free and open source). It’s fetched once from its official page. Direct video links already work without it.'),
        toolProgressBar('ytdlp')),
      btn(S.toolProgress.ytdlp ? 'Downloading…' : 'Set it up', { kind: 'primary', icon: 'download', disabled: !!S.toolProgress.ytdlp, onClick: () => installTool('ytdlp') })));
  } else if (!T.ffmpeg.installed) {
    page.append(h('div', { class: 'card setup-card slim' },
      h('div', { class: 'setup-icon small' }, ic('sparkles', 20)),
      h('div', { class: 'setup-text' },
        h('h3', null, 'Get full HD and 4K'),
        h('p', null, 'Most sites keep HD video and sound separately. FFmpeg (91 MB) joins them, so downloads come in the best quality. Without it, downloads are often limited to 720p.'),
        toolProgressBar('ffmpeg')),
      btn(S.toolProgress.ffmpeg ? 'Downloading…' : 'Install FFmpeg', { kind: 'ghost', icon: 'download', disabled: !!S.toolProgress.ffmpeg, onClick: () => installTool('ffmpeg') })));
  }

  if (D.loading) {
    page.append(h('div', { class: 'card dl-preview loading' }, h('div', { class: 'skel thumb' }), h('div', { class: 'skel-lines' }, h('div', { class: 'skel' }), h('div', { class: 'skel short' }))));
  } else if (D.error) {
    page.append(h('div', { class: 'notice error dl-error' }, ic('alert', 18), h('div', { class: 'grow' }, D.error),
      /^https?:/i.test(D.url) ? btn('Try the Capture browser', { kind: 'ghost sm', icon: 'globe', onClick: () => api.capture(D.url) }) : null));
  } else if (D.info) {
    page.append(previewCard(D.info));
  }

  // Quick settings
  const ds = S.settings.downloads;
  const setDs = (k) => async (v) => {
    S.settings.downloads[k] = v;
    await api.setSettings({ downloads: { [k]: v } });
    renderDownload();
  };
  const presetSel = h('select', { class: 'select', disabled: !ds.convertAfter }, presetOptions(ds.convertPreset || (S.presets && S.presets.selected)));
  presetSel.addEventListener('change', () => setDs('convertPreset')(presetSel.value));
  page.append(h('div', { class: 'dl-settings' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Downloads go to')),
      h('div', { class: 'path-field' },
        h('span', { class: 'path-icon' }, ic('folder', 18)),
        h('div', { class: 'path-text' }, h('div', { class: 'path-name' }, baseName(ds.dir)), h('div', { class: 'path-dir', title: ds.dir }, splitPath(ds.dir)[0])),
        btn('Open', { kind: 'ghost', onClick: () => api.open(ds.dir) }),
        btn('Change', {
          kind: 'ghost',
          onClick: async () => {
            const p = await api.pickFolder({ title: 'Where should downloads go?', defaultPath: ds.dir });
            if (p) setDs('dir')(p);
          },
        }))),
    h('div', { class: 'card' },
      h('div', { class: 'options' },
        toggle({ iconName: 'library', label: 'Add to media library', hint: 'Sorted under Downloads › site name.', checked: ds.addToLibrary, onChange: setDs('addToLibrary') }),
        toggle({ iconName: 'convert', label: 'Convert after downloading', hint: 'Runs the download through HandBrake with the preset below.', checked: ds.convertAfter, onChange: setDs('convertAfter') }),
        toggle({ iconName: 'list', label: 'Subtitles', hint: 'Grab English subtitles when the site has them.', checked: !!ds.subtitles, onChange: setDs('subtitles') })),
      h('div', { class: 'inline-field' }, h('span', null, 'Preset'), presetSel))));

  page.append(sitesPanel());
  page.append(otherSitesPanel());

  // Recent downloads (hidden in hidden mode)
  const jobs = S.hidden ? [] : [...S.jobs.values()].filter((j) => j.kind === 'download').sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  if (jobs.length) {
    page.append(h('div', { class: 'section-label' }, 'Recent downloads'));
    const list = h('div', { class: 'jobs compact' });
    jobs.forEach((j) => list.append(downloadCard(j)));
    page.append(list);
  }
  page.append(h('p', { class: 'fine-print' }, ic('shield', 13), 'Only download videos you made, own, or have permission to save. DRM-protected streams (Netflix, Disney+ …) can’t be downloaded.'));
  stagger(page);
}

function previewCard(info) {
  const D = S.dl;
  const hs = info.heights || [];
  const qualities = [['best', 'Best'], ['2160', '4K'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['audio', 'Audio']]
    .filter(([q]) => q === 'best' || q === 'audio' || !hs.length || hs.some((x) => x >= +q) || info.via === 'direct')
    .filter(([q]) => info.via !== 'direct' || q === 'best');
  const cookieSel = h('select', { class: 'select', title: 'Use the sign-in from your browser for private or age-restricted videos' },
    BROWSERS.map(([v, l]) => {
      const o = h('option', { value: v }, l);
      if (D.cookies === v) o.selected = true;
      return o;
    }));
  cookieSel.addEventListener('change', () => { D.cookies = cookieSel.value; });

  return h('div', { class: 'card dl-preview tilt spot' },
    h('div', { class: 'dl-thumb' },
      info.thumbnail ? h('img', { src: info.thumbnail, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }) : null,
      h('div', { class: 'dl-thumb-ph' }, ic('film', 34)),
      info.duration ? h('span', { class: 'vdur' }, fmtDuration(info.duration)) : null,
      info.playlist ? h('span', { class: 'vext' }, `${info.playlist} videos`) : null),
    h('div', { class: 'dl-body' },
      h('div', { class: 'dl-site' }, ic('globe', 14), info.site, info.uploader ? h('span', null, ` · ${info.uploader}`) : null),
      h('h2', { class: 'dl-title' }, info.title),
      h('div', { class: `dl-how ${info.via}` }, ic(info.via === 'scrape' ? 'search' : info.via === 'direct' ? 'film' : 'bolt', 14),
        info.via === 'ytdlp' ? `Supported site — downloaded by yt-dlp${hs.length ? `, up to ${hs[0] >= 2000 ? '4K' : `${hs[0]}p`}` : ''}.`
          : info.via === 'direct' ? `Direct file link${info.size ? ` · ${fmtBytes(info.size)}` : ''} — downloaded as-is.`
            : `Not a known site, but Reframe found ${plural((info.found || []).length, 'video')} in the page (${[...new Set((info.found || []).map((f) => f.split(' · ')[1]))].join(', ')}). The best one is downloaded.`),
      info.via === 'ytdlp' ? h('div', { class: 'dl-row' },
        h('span', { class: 'dl-label' }, 'Quality'),
        h('div', { class: 'seg' }, qualities.map(([q, l]) => h('button', { class: D.quality === q ? 'on' : '', onclick: () => { D.quality = q; renderDownload(); } }, l)))) : null,
      info.playlist ? h('div', { class: 'dl-row' }, toggle({ iconName: 'list', label: `Download the whole playlist (${info.playlist})`, checked: D.playlist, onChange: (v) => { D.playlist = v; } })) : null,
      info.via === 'ytdlp' ? h('div', { class: 'dl-row' }, h('span', { class: 'dl-label' }, 'Browser sign-in'), cookieSel,
        h('span', { class: 'dl-hint' }, 'Only for private or age-restricted videos')) : null,
      h('div', { class: 'dl-actions' },
        btn('Download', { kind: 'primary', size: 'lg', icon: 'download', onClick: startDownload }),
        btn('Cancel', { kind: 'ghost', onClick: () => { D.info = null; D.url = ''; renderDownload(); } }))));
}

// "Other sites": links read from .txt files in Documents\Reframe Other Sites.
async function loadOther(fn) {
  try {
    S.dl.other = await (fn || api.other.list)();
  } catch (e) {
    toast(cleanError(e), { kind: 'error' });
  }
  if (S.page === 'download') renderDownload();
}

function presetOptions(selected) {
  const out = [];
  for (const g of (S.presets ? S.presets.groups : [])) {
    const og = h('optgroup', { label: g.name });
    for (const p of g.presets) {
      const o = h('option', { value: p.name }, p.name);
      if (p.name === selected) o.selected = true;
      og.append(o);
    }
    out.push(og);
  }
  return out;
}
