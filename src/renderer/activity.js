'use strict';
// Activity page: live progress of every conversion job.

const ACTIVE = ['queued', 'preparing', 'running'];
const STATUS_LABEL = {
  queued: 'Waiting', preparing: 'Preparing', running: 'Converting', done: 'Finished',
  partial: 'Finished with problems', failed: 'Failed', cancelled: 'Cancelled',
};
const ITEM_LABEL = { queued: 'Waiting', running: 'Converting', done: 'Done', skipped: 'Already converted', failed: 'Failed', cancelled: 'Skipped' };
const ITEM_ICON = { queued: 'clock', running: 'convert', done: 'check', skipped: 'check', failed: 'alert', cancelled: 'minus' };

function jobNumbers(job) {
  const n = { done: 0, skipped: 0, failed: 0, cancelled: 0, running: 0, queued: 0 };
  let doneBytes = 0;
  let inBytes = 0;
  let outBytes = 0;
  for (const i of job.items) {
    n[i.status] = (n[i.status] || 0) + 1;
    if (['done', 'skipped', 'failed', 'cancelled'].includes(i.status)) doneBytes += i.size;
    else if (i.status === 'running') doneBytes += i.size * i.progress;
    if (i.status === 'done' || i.status === 'skipped') {
      inBytes += i.size;
      outBytes += i.outSize;
    }
  }
  const fraction = job.totalBytes ? doneBytes / job.totalBytes : 0;
  // Remaining time from the real throughput of this job so far.
  let eta = 0;
  if (job.status === 'running') {
    const busy = job.items.filter((i) => i.status === 'running');
    const encodedSince = job.items.filter((i) => i.status === 'done').reduce((s, i) => s + i.size, 0) + busy.reduce((s, i) => s + i.size * i.progress, 0);
    const elapsed = (Date.now() - job.startedAt) / 1000;
    if (encodedSince > 0 && elapsed > 5) {
      eta = (job.totalBytes - doneBytes) / (encodedSince / elapsed);
    } else if (busy.length && busy[0].eta) {
      eta = busy[0].eta;
    }
  }
  return { ...n, finished: n.done + n.skipped + n.failed + n.cancelled, fraction, eta, inBytes, outBytes };
}

function renderActivity() {
  const page = $('#page-activity');
  page.innerHTML = '';
  const jobs = [...S.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
  const finished = jobs.filter((j) => !ACTIVE.includes(j.status));

  page.append(h('div', { class: 'page-head' },
    h('div', { class: 'head-text' }, h('h1', null, 'Activity'), h('div', { class: 'head-sub' }, jobs.some((j) => ACTIVE.includes(j.status)) ? 'Conversions run one folder at a time, in order.' : 'Folders you convert show up here.')),
    h('div', { class: 'head-actions' },
      finished.length ? btn('Clear finished', {
        kind: 'ghost',
        icon: 'trash',
        onClick: async () => {
          const list = await api.clearJobs();
          S.jobs = new Map(list.map((j) => [j.id, j]));
          renderActivity();
          updateChrome();
        },
      }) : null,
      btn('Convert a folder', { kind: 'primary', icon: 'plus', onClick: () => chooseSource() }))));

  if (!jobs.length) {
    page.append(emptyState({
      iconName: 'activity',
      title: 'Nothing converting right now',
      text: 'Choose a folder of videos and its converted copy will be built here, folder by folder.',
      actions: [btn('Choose folder', { kind: 'primary', icon: 'folderOpen', onClick: () => chooseSource() })],
    }));
    return;
  }

  const list = h('div', { class: 'jobs' });
  for (const job of jobs) list.append(job.kind === 'download' ? downloadCard(job) : jobCard(job));
  page.append(list);
  stagger(list);
}

// ---------- download cards ----------
function downloadCard(job) {
  const card = h('article', { class: 'job dl-job spot', dataset: { id: job.id } });
  card.innerHTML = `
    <div class="job-head">
      <div class="job-icon dl-icon"></div>
      <div class="job-title"><h3></h3><div class="job-route"><span class="r-site"></span></div></div>
      <span class="pill"></span>
      <div class="job-actions"></div>
    </div>
    <div class="job-progress"><div class="bar"><i></i></div><div class="job-stats"></div></div>
    <div class="job-error notice error" hidden></div>`;
  const iconBox = $('.dl-icon', card);
  if (job.thumbnail) iconBox.append(h('img', { src: job.thumbnail, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.remove() }));
  else iconBox.innerHTML = icon(job.type === 'server' ? 'server' : 'download', 22);
  $('h3', card).textContent = job.title;
  $('.r-site', card).textContent = `${job.site || 'Web'} → ${job.outDir}`;
  updateDownloadCard(card, job);
  return card;
}

function updateDownloadCard(card, job) {
  if (!card || !job) return;
  const active = ACTIVE.includes(job.status);
  card.className = `job dl-job spot s-${job.status === 'running' ? 'running' : job.status}`;
  const pill = $('.pill', card);
  pill.className = `pill s-${job.status}`;
  pill.textContent = { queued: 'Waiting', running: 'Downloading', done: 'Downloaded', partial: 'Partly downloaded', failed: 'Failed', cancelled: 'Cancelled' }[job.status] || job.status;

  const actions = $('.job-actions', card);
  if (actions.dataset.status !== job.status) {
    actions.dataset.status = job.status;
    actions.innerHTML = '';
    actions.append(btn('Open folder', { kind: 'ghost', icon: 'external', onClick: () => api.open(job.outDir) }));
    if (job.files && job.files.length === 1 && !active) actions.append(btn('Play', { kind: 'ghost', icon: 'play', onClick: () => playPath(job.files[0], job.title) }));
    if (active) actions.append(btn('Stop', { kind: 'ghost danger-text', icon: 'x', onClick: () => api.cancelJob(job.id) }));
    if (job.status === 'failed' || job.status === 'partial' || job.status === 'cancelled') {
      actions.append(btn('Try again', { kind: 'ghost', icon: 'retry', onClick: () => api.retryJob(job.id) }));
      actions.append(btn('Details', { kind: 'ghost', onClick: () => showDownloadLog(job) }));
    }
  }
  const fill = $('.bar i', card);
  fill.style.width = `${(job.status === 'done' ? 1 : job.progress) * 100}%`;
  $('.bar', card).classList.toggle('indeterminate', job.status === 'queued' || (job.status === 'running' && !job.progress));
  const stats = [];
  if (job.status === 'running') {
    stats.push(h('span', { class: 'strong' }, `${Math.floor(job.progress * 100)}%`));
    if (job.phase) stats.push(h('span', null, job.phase));
    if (job.speed) stats.push(h('span', null, job.speed));
    if (job.eta) stats.push(h('span', null, `${job.eta} left`));
  } else if (job.status === 'queued') stats.push(h('span', null, 'Starts after the download before it'));
  if (job.items) {
    const n = job.items.filter((i) => i.status === 'done' || i.status === 'skipped').length;
    stats.push(h('span', { class: 'strong' }, `${n} of ${plural(job.items.length, 'file')}`));
    if (job.totalBytes) stats.push(h('span', null, fmtBytes(job.totalBytes)));
  } else if (job.files && job.files.length && !active) stats.push(h('span', { class: 'strong' }, plural(job.files.length, 'file')));
  if (!active && job.finishedAt) stats.push(h('span', { class: 'dim' }, fmtWhen(job.finishedAt)));
  const s = $('.job-stats', card);
  s.innerHTML = '';
  append(s, stats);
  const err = $('.job-error', card);
  err.hidden = !job.error;
  if (job.error) err.textContent = job.error;
}

async function showDownloadLog(job) {
  const log = await api.itemLog(job.id, null);
  modal({
    title: job.title,
    wide: true,
    body: h('div', null,
      job.error ? h('div', { class: 'notice error' }, ic('alert', 18), h('div', null, job.error)) : null,
      job.items ? h('div', { class: 'mini-files' }, job.items.filter((i) => i.status === 'failed').map((i) => h('div', null, `${i.rel} — ${i.error}`))) : null,
      h('div', { class: 'field-label', style: { marginTop: '16px' } }, 'Log'),
      h('pre', { class: 'log' }, log || 'Nothing was logged.')),
    actions: [{ label: 'Close', kind: 'primary', value: true }],
  });
}

function jobCard(job) {
  const card = h('article', { class: 'job', dataset: { id: job.id } });
  card.innerHTML = `
    <div class="job-head">
      <div class="job-icon">${icon('folder', 22)}</div>
      <div class="job-title">
        <h3></h3>
        <div class="job-route"><span class="r-from"></span>${icon('arrowRight', 13)}<span class="r-to"></span></div>
      </div>
      <span class="pill"></span>
      <div class="job-actions"></div>
    </div>
    <div class="job-progress">
      <div class="bar"><i></i></div>
      <div class="job-stats"></div>
    </div>
    <div class="job-now"></div>
    <div class="job-error notice error" hidden></div>
    <button class="disclosure"><span class="disc-icon">${icon('chevronRight', 14)}</span><span class="disc-label"></span></button>
    <div class="files" hidden></div>`;
  $('h3', card).textContent = job.name;
  $('.r-from', card).textContent = job.source;
  $('.r-to', card).textContent = job.dest;
  $('.r-from', card).title = job.source;
  $('.r-to', card).title = job.dest;
  $('.disclosure', card).addEventListener('click', () => {
    if (S.expandedJobs.has(job.id)) S.expandedJobs.delete(job.id);
    else S.expandedJobs.add(job.id);
    updateJobCard(card, S.jobs.get(job.id));
  });
  card.rows = new Map();
  updateJobCard(card, job);
  return card;
}

function updateJobCard(card, job) {
  if (!card || !job) return;
  const nums = jobNumbers(job);
  const active = ACTIVE.includes(job.status);
  card.className = `job spot s-${job.status}`;

  const pill = $('.pill', card);
  pill.className = `pill s-${job.status}`;
  pill.textContent = STATUS_LABEL[job.status] || job.status;

  // Actions only rebuild when the status changes so clicks are never lost.
  const actions = $('.job-actions', card);
  if (actions.dataset.status !== job.status) {
    actions.dataset.status = job.status;
    actions.innerHTML = '';
    if (!['queued'].includes(job.status)) actions.append(btn('Open folder', { kind: 'ghost', icon: 'external', onClick: () => api.open(job.dest) }));
    if (active) {
      actions.append(btn('Stop', {
        kind: 'ghost danger-text',
        icon: 'x',
        onClick: async () => {
          const ok = await confirmBox({
            title: `Stop converting “${job.name}”?`,
            message: 'The video being converted right now is stopped and its unfinished copy is removed. Videos that are already done stay in the copy. Your originals are not touched.',
            confirm: 'Stop',
            danger: true,
          });
          if (ok) api.cancelJob(job.id);
        },
      }));
    } else if (nums.failed || nums.cancelled) {
      actions.append(btn(nums.failed ? 'Retry failed' : 'Finish the rest', { kind: 'ghost', icon: 'retry', onClick: () => api.retryJob(job.id) }));
    }
    if (!active && (nums.done || nums.skipped) && job.options.addToLibrary) {
      actions.append(btn('View in library', { kind: 'ghost', icon: 'library', onClick: () => openLibraryFor(job) }));
    }
  }

  const fill = $('.bar i', card);
  fill.style.width = `${(job.status === 'done' ? 1 : nums.fraction) * 100}%`;
  $('.bar', card).classList.toggle('indeterminate', job.status === 'preparing' || job.status === 'queued');

  const stats = [];
  stats.push(h('span', { class: 'strong' }, `${nums.finished} of ${plural(job.items.length, 'video')}`));
  if (active && job.status === 'running') stats.push(h('span', null, `${Math.floor(nums.fraction * 100)}%`));
  if (job.status === 'preparing') stats.push(h('span', null, job.phase === 'Copying other files' ? `Copying other files · ${job.copied} of ${job.othersCount}` : 'Creating folders'));
  if (job.status === 'queued') stats.push(h('span', null, 'Starts when the folder before it is finished'));
  if (nums.eta && active) stats.push(h('span', null, fmtEta(nums.eta)));
  if (nums.failed) stats.push(h('span', { class: 'bad' }, `${nums.failed} failed`));
  if (nums.skipped) stats.push(h('span', null, `${nums.skipped} already converted`));
  if (nums.inBytes && nums.outBytes) {
    const diff = nums.inBytes - nums.outBytes;
    stats.push(h('span', { class: diff > 0 ? 'good' : '' }, diff > 0 ? `${fmtBytes(diff)} smaller (${Math.round((diff / nums.inBytes) * 100)}%)` : `${fmtBytes(-diff)} larger`));
  }
  if (!active && job.finishedAt && job.startedAt) stats.push(h('span', null, `Took ${fmtElapsed(job.finishedAt - job.startedAt)}`));
  if (!active && job.finishedAt) stats.push(h('span', { class: 'dim' }, fmtWhen(job.finishedAt)));
  stats.push(h('span', { class: 'dim' }, job.preset.name));
  const statsEl = $('.job-stats', card);
  statsEl.innerHTML = '';
  append(statsEl, stats);

  const now = $('.job-now', card);
  const running = job.items.filter((i) => i.status === 'running');
  now.hidden = !running.length;
  if (running.length) {
    const key = running.map((i) => i.id).join();
    if (now.dataset.key !== key) {
      now.dataset.key = key;
      now.innerHTML = '';
      for (const i of running) {
        const [dir, name] = splitPath(i.src);
        now.append(h('div', { class: 'now-row', dataset: { id: i.id } },
          h('div', { class: 'now-spin' }, ic('convert', 18)),
          h('div', { class: 'now-text' },
            h('div', { class: 'now-name' }, name),
            h('div', { class: 'now-dir' }, dir ? `in ${dir}` : 'in the main folder')),
          h('div', { class: 'now-pct' }),
          h('div', { class: 'now-fps' }),
          btn('', { kind: 'ghost', icon: 'skip', title: 'Skip this video', onClick: () => api.skipItem(job.id, i.id) })));
      }
    }
    for (const i of running) {
      const row = now.querySelector(`[data-id="${i.id}"]`);
      if (!row) continue;
      row.querySelector('.now-pct').textContent = `${(i.progress * 100).toFixed(1)}%`;
      row.querySelector('.now-fps').textContent = i.fps ? `${Math.round(i.fps)} fps` : 'starting…';
      row.style.setProperty('--p', i.progress);
    }
  } else {
    now.dataset.key = '';
  }

  const err = $('.job-error', card);
  err.hidden = !job.error;
  if (job.error) err.textContent = job.error;

  const open = S.expandedJobs.has(job.id);
  card.classList.toggle('expanded', open);
  $('.disc-label', card).textContent = open ? 'Hide files' : `Show all files (${job.items.length})`;
  const files = $('.files', card);
  files.hidden = !open;
  if (open) updateFileRows(card, files, job);
}

function updateFileRows(card, files, job) {
  for (const i of job.items) {
    let row = card.rows.get(i.id);
    if (!row) {
      const [dir, name] = splitPath(i.out);
      row = h('div', { class: 'file-row' },
        h('span', { class: 'f-status' }),
        h('div', { class: 'f-name' }, h('span', { class: 'f-dir' }, dir ? `${dir}\\` : ''), h('span', null, name)),
        h('span', { class: 'f-size' }),
        h('span', { class: 'f-state' }),
        h('div', { class: 'f-actions' }));
      row.mini = h('i', { class: 'f-mini' });
      row.append(row.mini);
      card.rows.set(i.id, row);
      files.append(row);
    }
    const sig = `${i.status}|${Math.floor(i.progress * 100)}|${i.outSize}`;
    if (row.sig === sig) continue;
    const statusChanged = !row.sig || row.sig.split('|')[0] !== i.status;
    row.sig = sig;
    row.className = `file-row s-${i.status}`;
    row.mini.style.width = i.status === 'running' ? `${i.progress * 100}%` : '0';
    if (statusChanged) {
      row.querySelector('.f-status').innerHTML = icon(ITEM_ICON[i.status] || 'clock', 15);
      const acts = row.querySelector('.f-actions');
      acts.innerHTML = '';
      if (i.status === 'done' || i.status === 'skipped') {
        acts.append(btn('', { kind: 'ghost sm', icon: 'play', title: 'Play', onClick: () => playPath(`${job.dest}\\${i.out}`, splitPath(i.out)[1]) }));
        acts.append(btn('', { kind: 'ghost sm', icon: 'folderOpen', title: 'Show in folder', onClick: () => api.reveal(`${job.dest}\\${i.out}`) }));
      }
      if (i.status === 'failed') acts.append(btn('Details', { kind: 'ghost sm', onClick: () => showItemLog(job, i) }));
      if (i.status === 'queued') acts.append(btn('', { kind: 'ghost sm', icon: 'skip', title: 'Skip this video', onClick: () => api.skipItem(job.id, i.id) }));
    }
    row.querySelector('.f-size').textContent = i.outSize ? `${fmtBytes(i.size)} → ${fmtBytes(i.outSize)}` : fmtBytes(i.size);
    const state = row.querySelector('.f-state');
    state.textContent = i.status === 'running' ? `${Math.floor(i.progress * 100)}%` : (i.status === 'failed' ? i.error : ITEM_LABEL[i.status]);
    state.title = i.status === 'failed' ? i.error : '';
  }
}

async function showItemLog(job, item) {
  const log = await api.itemLog(job.id, item.id);
  modal({
    title: splitPath(item.src)[1],
    wide: true,
    body: h('div', null,
      h('div', { class: 'notice error' }, ic('alert', 18), h('div', null, item.error || 'This video could not be converted.')),
      h('div', { class: 'field-label', style: { marginTop: '16px' } }, 'HandBrake log'),
      h('pre', { class: 'log' }, log || 'No log was recorded.')),
    actions: [
      { label: 'Show original', kind: 'ghost', icon: 'folderOpen', run: () => api.reveal(`${job.source}\\${item.src}`) },
      { label: 'Close', kind: 'primary', value: true },
    ],
  });
}

function onJobUpdate(job) {
  const had = S.jobs.get(job.id);
  S.jobs.set(job.id, job);
  for (const card of document.querySelectorAll(`.job[data-id="${job.id}"]`)) {
    if (job.kind === 'download') updateDownloadCard(card, job);
    else updateJobCard(card, job);
  }
  if (S.page === 'activity' && !document.querySelector(`#page-activity .job[data-id="${job.id}"]`)) renderActivity();
  if (S.page === 'download' && job.kind === 'download' && !had) renderDownload();
  if (job.kind === 'download') {
    if (had && ACTIVE.includes(had.status) && !ACTIVE.includes(job.status)) {
      if (job.status === 'done') toast(`Downloaded “${job.title}”`, { kind: 'ok', action: { label: 'Open', run: () => api.open(job.outDir) }, timeout: 7000 });
      else if (job.status === 'failed') toast(`Download failed: ${job.error || job.title}`, { kind: 'error', timeout: 8000 });
    }
    updateChrome();
    return;
  }
  if (had && ACTIVE.includes(had.status) && !ACTIVE.includes(job.status)) {
    if (job.status === 'done') confetti();
    const n = jobNumbers(job);
    if (job.status === 'done') toast(`“${job.name}” is converted — ${plural(n.done + n.skipped, 'video')} ready.`, { kind: 'ok', action: { label: 'Open', run: () => api.open(job.dest) }, timeout: 8000 });
    else if (job.status === 'partial' || job.status === 'failed') toast(`“${job.name}” finished, but ${plural(n.failed, 'video')} could not be converted.`, { kind: 'warn', action: { label: 'See why', run: () => { S.expandedJobs.add(job.id); go('activity'); } }, timeout: 9000 });
  }
  updateChrome();
}
