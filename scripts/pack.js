'use strict';
// Builds dist/Reframe-win32-x64 with HandBrakeCLI bundled next to the app.
const { packager } = require('@electron/packager');
const path = require('path');

const root = path.join(__dirname, '..');

packager({
  dir: root,
  out: path.join(root, 'dist'),
  name: 'Reframe',
  executableName: 'Reframe',
  platform: 'win32',
  arch: 'x64',
  icon: path.join(root, 'assets', 'icon.ico'),
  asar: true,
  overwrite: true,
  prune: true,
  extraResource: [path.join(root, 'vendor', 'handbrake')],
  ignore: [/^\/release-extras($|\/)/, /^\/release($|\/)/, /^\/scripts($|\/)/, /^\/vendor($|\/)/, /^\/dist($|\/)/, /^\/\.claude($|\/)/, /\.md$/],
  win32metadata: {
    CompanyName: 'chr0m3void',
    FileDescription: 'Reframe',
    ProductName: 'Reframe',
    InternalName: 'Reframe',
  },
  appCopyright: 'Reframe. HandBrake is GPL v2 software by the HandBrake Team.',
}).then((paths) => {
  // Ship the 18+ switch file (and anything else in release-extras) next to Reframe.exe.
  const fs = require('fs');
  const extras = path.join(root, 'release-extras');
  for (const out of paths) {
    if (fs.existsSync(extras)) for (const f of fs.readdirSync(extras)) fs.copyFileSync(path.join(extras, f), path.join(out, f));
  }
  console.log(`packed: ${paths.join(', ')}`);
}, (e) => {
  console.error(e);
  process.exit(1);
});
