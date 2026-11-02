'use strict';
// Dev helper: builds a sample folder tree of short test videos.
// Usage: electron scripts/make-test-videos.js <target folder>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const target = path.resolve(process.argv[process.argv.length - 1]);

const recorder = (hue, label, seconds) => `
new Promise((resolve) => {
  const c = document.createElement('canvas'); c.width = 640; c.height = 360;
  const x = c.getContext('2d');
  const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 2500000 });
  const parts = []; rec.ondataavailable = (e) => parts.push(e.data);
  rec.onstop = async () => { const b = new Blob(parts); const buf = new Uint8Array(await b.arrayBuffer()); let s=''; for (let i=0;i<buf.length;i+=32768) s += String.fromCharCode.apply(null, buf.subarray(i,i+32768)); resolve(btoa(s)); };
  const t0 = performance.now();
  const draw = () => {
    const t = (performance.now() - t0) / 1000;
    const g = x.createLinearGradient(0, 0, 640, 360);
    g.addColorStop(0, 'hsl(${hue},70%,45%)'); g.addColorStop(1, 'hsl(${hue + 60},70%,25%)');
    x.fillStyle = g; x.fillRect(0, 0, 640, 360);
    x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(320 + Math.sin(t*2)*200, 180 + Math.cos(t*3)*90, 40, 0, 7); x.fill();
    x.font = 'bold 44px Segoe UI'; x.fillStyle = '#fff'; x.fillText(${JSON.stringify(label)}, 30, 70);
    x.font = '28px Segoe UI'; x.fillText(t.toFixed(1) + 's', 30, 330);
    if (t < ${seconds}) requestAnimationFrame(draw); else rec.stop();
  };
  rec.start(250); draw();
});`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL('data:text/html,<body></body>');
  const clips = [];
  for (const [hue, label] of [[20, 'Sunset'], [200, 'Ocean'], [120, 'Forest']]) {
    clips.push(Buffer.from(await win.webContents.executeJavaScript(recorder(hue, label, 3)), 'base64'));
  }
  const tree = {
    '': ['Intro.webm', 'clip.webm', 'clip.mkv'],
    Beach: ['Waves.webm', 'Sand castle.webm', 'Swim.mkv', 'Sunset walk.webm'],
    Hotel: ['Room tour.webm', 'Pool.webm', 'Breakfast.mkv', 'Lobby.webm'],
    'Day trips': ['Boat.webm', 'Market.webm', 'Old town.webm', 'Caves.webm'],
    'Day trips\\Mountain': ['Summit.webm', 'Cable car.webm', 'Lake.webm', 'Snow.webm'],
  };
  let n = 0;
  for (const [dir, files] of Object.entries(tree)) {
    fs.mkdirSync(path.join(target, dir), { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(target, dir, f), clips[n++ % clips.length]);
  }
  fs.mkdirSync(path.join(target, 'Empty folder'), { recursive: true });
  fs.writeFileSync(path.join(target, 'Beach', 'notes.txt'), 'Holiday notes');
  fs.writeFileSync(path.join(target, 'Hotel', 'broken.mp4'), 'this is not really a video');
  console.log(`made ${n} videos in ${target}`);
  app.quit();
});
