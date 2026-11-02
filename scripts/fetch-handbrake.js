'use strict';
// Downloads the official HandBrakeCLI build into vendor/handbrake (it is not kept in git).
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');

const VERSION = '1.11.2';
const URL = `https://github.com/HandBrake/HandBrake/releases/download/${VERSION}/HandBrakeCLI-${VERSION}-win-x86_64.zip`;
const dest = path.join(__dirname, '..', 'vendor', 'handbrake');

if (fs.existsSync(path.join(dest, 'HandBrakeCLI.exe'))) {
  console.log('HandBrakeCLI is already in vendor/handbrake.');
  process.exit(0);
}

function get(url, file, hops = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'reframe-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 5) {
        res.resume();
        return resolve(get(res.headers.location, file, hops + 1));
      }
      if (res.statusCode !== 200) return reject(new Error(`Download failed: HTTP ${res.statusCode}`));
      const out = fs.createWriteStream(file);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  });
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hb-'));
  const zip = path.join(tmp, 'hb.zip');
  console.log(`Downloading ${URL}`);
  await get(URL, zip);
  fs.mkdirSync(dest, { recursive: true });
  // Windows' own tar reads zips; a Git Bash tar on PATH would not.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', zip, '-C', dest]);
  fs.rmSync(tmp, { recursive: true, force: true });
  if (!fs.existsSync(path.join(dest, 'HandBrakeCLI.exe'))) throw new Error('HandBrakeCLI.exe was not in the download.');
  console.log('HandBrakeCLI is ready in vendor/handbrake.');
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
