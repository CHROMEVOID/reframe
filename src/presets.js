'use strict';
// Reads the presets the user already has in the HandBrake app, so the presets
// (including their own custom ones) match what they see in HandBrake itself.
const fs = require('fs');
const path = require('path');

const EXT_FOR_FORMAT = { av_mp4: '.mp4', av_mkv: '.mkv', av_webm: '.webm' };

function handbrakeAppData() {
  return path.join(process.env.APPDATA || '', 'HandBrake');
}

function defaultPresetsFile() {
  return path.join(handbrakeAppData(), 'presets.json');
}

// Used only when HandBrake's presets.json cannot be found. These are all
// built into HandBrakeCLI, so they always work.
const FALLBACK = [
  {
    name: 'General',
    presets: [
      ['Very Fast 1080p30', 'Small H.264 files, quick to encode.'],
      ['Fast 1080p30', 'H.264 video and AAC stereo audio in MP4. Good default.'],
      ['HQ 1080p30 Surround', 'High quality H.264 with surround audio.'],
      ['Super HQ 1080p30 Surround', 'Very high quality, slower encode.'],
      ['Fast 720p30', 'H.264 at 720p, smaller files.'],
      ['Fast 480p30', 'H.264 at 480p, smallest files.'],
      ['Fast 2160p60 4K HEVC', 'H.265 4K video.'],
    ].map(([name, description]) => ({ name, description, ext: '.mp4' })),
  },
  {
    name: 'Matroska',
    presets: [
      ['H.265 MKV 1080p30', 'H.265 video in an MKV container.'],
      ['H.264 MKV 1080p30', 'H.264 video in an MKV container.'],
    ].map(([name, description]) => ({ name, description, ext: '.mkv' })),
  },
];

function loadPresets({ file, writeCustomTo } = {}) {
  const source = file || defaultPresetsFile();
  let data = null;
  try {
    data = JSON.parse(fs.readFileSync(source, 'utf8'));
  } catch {
    data = null;
  }

  const groups = new Map();
  const customRaw = [];
  let defaultName = null;

  const addTo = (groupName, item) => {
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(item);
  };

  const walk = (list, groupName) => {
    for (const p of list || []) {
      if (!p || typeof p !== 'object') continue;
      if (p.Folder) {
        walk(p.ChildrenArray, p.PresetName);
        continue;
      }
      const custom = p.Type === 1;
      const item = {
        name: p.PresetName,
        description: p.PresetDescription || '',
        ext: EXT_FOR_FORMAT[p.FileFormat] || '.mp4',
        custom,
        width: p.PictureWidth || 0,
        height: p.PictureHeight || 0,
        encoder: p.VideoEncoder || '',
      };
      addTo(groupName || (custom ? 'My presets' : 'Presets'), item);
      if (p.Default) defaultName = item.name;
      if (custom) customRaw.push(p);
    }
  };

  if (data && Array.isArray(data.PresetList)) walk(data.PresetList, null);

  let result = [...groups.entries()].map(([name, presets]) => ({
    name,
    custom: presets.some((x) => x.custom),
    presets,
  }));
  if (!result.length) {
    result = FALLBACK.map((g) => ({ ...g, custom: false, presets: g.presets.map((p) => ({ ...p, custom: false })) }));
  }
  // The user's own presets go first: they are the ones they actually use.
  result.sort((a, b) => Number(b.custom) - Number(a.custom));

  // HandBrakeCLI only knows the built-in presets, so the custom ones are
  // written to a small import file that is passed with --preset-import-file.
  let customFile = null;
  if (customRaw.length && writeCustomTo) {
    try {
      fs.mkdirSync(path.dirname(writeCustomTo), { recursive: true });
      fs.writeFileSync(
        writeCustomTo,
        JSON.stringify({
          PresetList: customRaw,
          VersionMajor: data.VersionMajor,
          VersionMinor: data.VersionMinor,
          VersionMicro: data.VersionMicro,
        }, null, 2),
      );
      customFile = writeCustomTo;
    } catch {
      customFile = null;
    }
  }

  return {
    source: data ? source : null,
    groups: result,
    defaultName: defaultName || 'Fast 1080p30',
    customFile,
  };
}

function findPreset(presets, name) {
  for (const g of presets.groups) {
    const hit = g.presets.find((p) => p.name === name);
    if (hit) return hit;
  }
  return null;
}

module.exports = { loadPresets, findPreset, defaultPresetsFile };
