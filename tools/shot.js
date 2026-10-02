// ============================================================
// tools/shot.js — headless screenshot of the REAL game (verification only)
//
// Serves the repo over localhost, boots index.html in headless Chrome and
// drives it straight into a match (or a menu) through the game's own event
// bus, waits for the harness's ready stage, then grabs a frame over the
// Chrome DevTools Protocol and saves it as a PNG.
//
// Capture uses CDP + real time instead of --screenshot/--virtual-time-budget:
// with --headless=new the virtual clock can stall forever inside the game's
// rAF loop and Chrome never commits a frame, so no PNG was ever written.
//
//   node tools/shot.js                       match, day, procedural court
//   node tools/shot.js --court motherland    a painted court
//   node tools/shot.js --time night          night lighting
//   node tools/shot.js --state menu          main menu
//   node tools/shot.js --out before.png
//   node tools/shot.js --budget 60000        max wait for the ready stage
//   node tools/shot.js --settle 1200         extra real time before capture
//   node tools/shot.js --ray 757,500;772,300 dump what the scene raycast hits
//   node tools/shot.js --sweep                 grid-sweep the frame, printed
//   node tools/shot.js --tex                    dump ground/pitch textures
//   node tools/shot.js --noshadow                render with shadows disabled
//   node tools/shot.js --findz -2.14              list meshes crossing that z
//   node tools/shot.js --hide asphalt,slab         hide ground-plane layers
//   node tools/shot.js --view portrait
//   node tools/shot.js --rig               match with the skinned player rig on
//   node tools/shot.js --norig             same match with rig=0 (procedural body)
//   node tools/shot.js --rigtest           close side view of 4 pinned poses
//                                           (idle / run / run mirror / kick)
//   node tools/shot.js --rigprobe --settle 90000
//                                           sample live-match rig state while
//                                           the game runs (state/clip/bone readout)
//   node tools/shot.js --glb0              same match with the Phase-1 GLB
//                                           test player forced back to the
//                                           procedural body (A/B compare)
//   node tools/shot.js --rigprobe --closeup --settle 25000
//                                           live match filmed close on the
//                                           human (= the GLB test player)
//   node tools/shot.js --glbtest --glbpose idle
//   node tools/shot.js --glbtest --glbpose run:0.3
//   node tools/shot.js --glbtest --glbpose kick:1
//   node tools/shot.js --glbtest --glbpose scan
//           Phase 2: one imported GLB player, close 3/4 view pinned to a
//           RETARGETED clip (idle|jog|run|sprint|stop|kick, or a scan of
//           every clip) — logs box/grounding/limbs/clip table
//   node tools/shot.js --scale --settle 4000
//           Phase 3A: measure every player's real rendered size in a live
//           match (skinned box + head/shoulder/foot markers, draw calls)
//           and park the GLB player next to a procedural one for a
//           side-by-side capture
//   node tools/shot.js --scale --gscale 1.12 --out a.png
//           same, with a trial uniform size factor on the GLB body only
//   node tools/shot.js --scale --parts --out parts.png
//           dye each GLB material a flat colour: one shot names the meshes
//   node tools/shot.js --scale --bands --closeup --out bands.png
//           rainbow bands by bind-pose height: maps y-range -> body part
//   node tools/shot.js --scale --hidemat Begue --out under.png
//           hide one GLB material: shows what the layer underneath is
// ============================================================
var fs = require('fs');
var path = require('path');
var http = require('http');
var net = require('net');
var child = require('child_process');

var ROOT = path.join(__dirname, '..');

var args = process.argv.slice(2);
function arg(name, dflt) {
  var i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
}
var COURT = arg('court', '');
var TIME = arg('time', 'day');
var STATE = arg('state', 'match');
var OUT = arg('out', path.join(__dirname, 'shot.png'));
var BUDGET = Number(arg('budget', 45000));
var SETTLE = Number(arg('settle', 700));
var SIZE = arg('size', '1440,810').split(',');
var VIEW = arg('view', 'landscape');
var RAY = arg('ray', '');
var SWEEP = !!args.includes('--sweep');
var TEX = !!args.includes('--tex');
var NOSHADOW = !!args.includes('--noshadow');
var RIG = !!args.includes('--rig');
var NORIG = !!args.includes('--norig');
var RIGTEST = !!args.includes('--rigtest');
var RIGPROBE = !!args.includes('--rigprobe');
var GLBTEST = !!args.includes('--glbtest');
var GLBPOSE = arg('glbpose', 'idle');
var GLB0 = !!args.includes('--glb0');
var CLOSEUP = !!args.includes('--closeup');
var SCALE = !!args.includes('--scale');
var GSCALE = arg('gscale', '');
var GLBSCOPE = arg('glbscope', '');
var PAIRZ = arg('pairz', '');
var GKPAIR = !!args.includes('--gk');
var FACE = arg('face', '');
var GOAL = !!args.includes('--goal');
var CROWD = !!args.includes('--crowd');
var PARTS = !!args.includes('--parts');
var BANDS = !!args.includes('--bands');
var HIDEMAT = arg('hidemat', '');
var FINDZ = arg('findz', '');
var HIDE = arg('hide', '');

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

var server = http.createServer(function (req, res) {
  var u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') u = '/index.html';
  var file = path.join(ROOT, u);
  if (file.indexOf(ROOT) !== 0) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});

var CHROME = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(function (p) { return fs.existsSync(p); })[0];

if (!CHROME) { console.error('no chrome found'); process.exit(1); }

// ---------------- small async helpers ----------------
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function freePort() {
  return new Promise(function (resolve, reject) {
    var s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', function () {
      var p = s.address().port;
      s.close(function () { resolve(p); });
    });
  });
}

function get(url) {
  return new Promise(function (resolve) {
    var done = false;
    var req = http.get(url, function (res) {
      var b = '';
      res.on('data', function (d) { b += d; });
      res.on('end', function () { done = true; resolve({ ok: res.statusCode === 200, body: b }); });
    });
    req.on('error', function () { if (!done) resolve({ ok: false, body: '' }); });
    req.setTimeout(4000, function () { req.destroy(); if (!done) resolve({ ok: false, body: '' }); });
  });
}

function killTree(pid) {
  try {
    if (process.platform === 'win32') child.execSync('taskkill /PID ' + pid + ' /T /F', { stdio: 'ignore' });
    else process.kill(-pid);
  } catch (e) {
    try { process.kill(pid); } catch (e2) {}
  }
}

// ---------------- CDP client ----------------
function CDP(url) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket(url);
    var next = 1;
    var pending = {};
    var listeners = [];
    ws.onopen = function () { resolve(api); };
    ws.onerror = function (e) { reject(new Error('ws error')); };
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && pending[m.id]) {
        var p = pending[m.id]; delete pending[m.id];
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
        return;
      }
      for (var i = 0; i < listeners.length; i++) listeners[i](m);
    };
    var api = {
      on: function (fn) { listeners.push(fn); },
      send: function (method, params) {
        var id = next++;
        return new Promise(function (resolve2, reject2) {
          pending[id] = { resolve: resolve2, reject: reject2 };
          ws.send(JSON.stringify({ id: id, method: method, params: params || {} }));
        });
      },
      close: function () { try { ws.close(); } catch (e) {} },
    };
  });
}

function argValue(a) {
  if (!a) return '';
  if (a.type === 'string') return a.value;
  if (a.type === 'number' || a.type === 'boolean') return String(a.value);
  if (a.type === 'undefined') return 'undefined';
  if (a.type === 'function') return 'ƒ()';
  if (a.description) return a.description;
  if (a.value !== undefined) return String(a.value);
  return a.type || '';
}

// ---------------- one attempt ----------------
async function attempt(n, maxTries, url) {
  var profile = path.join(require('os').tmpdir(), 'blockout-shot-' + Date.now() + '-' + n);
  var port = await freePort();
  var cmd = [
    '--headless=new',
    '--disable-gpu',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-sync',
    '--no-default-browser-check',
    '--user-data-dir=' + profile,
    '--window-size=' + SIZE[0] + ',' + SIZE[1],
    '--remote-debugging-port=' + port,
    url,
  ];

  console.log('[shot] try ' + n + '/' + maxTries + ' ' + url);
  var logFile = OUT + '.log';
  var logStream = fs.createWriteStream(logFile);
  function log(line) { try { logStream.write(line + '\n'); } catch (e) {} }
  log('[shot] ' + url);

  var proc = child.spawn(CHROME, cmd, { stdio: ['ignore', 'ignore', 'pipe'] });
  var stderrBuf = '';
  proc.stderr.on('data', function (d) { stderrBuf += d; });

  var done = false;
  var killTimer = setTimeout(function () {
    if (!done) { log('[shot] hard timeout'); try { proc.kill(); } catch (e) {} }
  }, BUDGET + SETTLE + 45000);

  function cleanup() {
    clearTimeout(killTimer);
    try { logStream.end(); } catch (e) {}
    killTree(proc.pid);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }

  try {
    // 1. wait for the DevTools endpoint
    var list = null;
    for (var i = 0; i < 80 && !list; i++) {
      await sleep(300);
      var r = await get('http://127.0.0.1:' + port + '/json/list');
      if (r.ok) { try { list = JSON.parse(r.body); } catch (e) {} }
    }
    if (!list) throw new Error('devtools endpoint never came up');
    var target = list.filter(function (t) { return t.type === 'page' && /shot\.html/.test(t.url); })[0]
      || list.filter(function (t) { return t.type === 'page'; })[0];
    if (!target) throw new Error('no page target');

    // 2. attach
    var cdp = await CDP(target.webSocketDebuggerUrl);
    var stages = [];
    var cdpErr = [];
    cdp.on(function (m) {
      if (m.method === 'Runtime.consoleAPICalled') {
        var txt = (m.params.args || []).map(argValue).join(' ');
        log('[console] ' + txt);
        if (/^STAGE:/.test(txt) || /^STEP/.test(txt) || /^\[?(GLB|RIG)|^\[START\]|^\[CROWD\]|^MATCHDIAG|^GOALFORCE|^GOALSNAP|^CROWDEVT|^CROWD|^RIGTEST|^RIGPROBE|^SCALE|^PARTS|^BANDS|^HIDEMAT/.test(txt) || /^SCENE|^RAY|^SWEEP|^TEX|^FIND|^HIDE|^CAM|^HITS/.test(txt)) {
          console.log(txt);
          var st = /^STAGE:(.*)$/.exec(txt);
          if (st) stages.push(st[1]);
        }
      } else if (m.method === 'Runtime.exceptionThrown') {
        var d = m.params.exceptionDetails;
        var msg = (d && d.exception && (d.exception.description || d.exception.value)) || (d && d.text) || 'exception';
        cdpErr.push(String(msg));
        log('[exception] ' + msg);
      } else if (m.method === 'Log.entryAdded') {
        var e = m.params.entry;
        if (e && (e.level === 'error' || e.level === 'warning')) {
          log('[log:' + e.level + '] ' + e.text);
          if (e.level === 'error' && /Uncaught|ReferenceError|TypeError|SyntaxError/.test(e.text)) cdpErr.push(e.text);
        }
      }
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');

    // 3. poll the harness stage in real time
    async function stageNow() {
      var res = await cdp.send('Runtime.evaluate', {
        expression: '(function(){try{return String(window.__shotStage||"")}catch(e){return "ERR:"+e.message}})()',
        returnByValue: true,
      });
      return res && res.result ? res.result.value : '';
    }

    var READY = STATE === 'menu' ? 'menu' : 'done';
    var t0 = Date.now();
    var last = '', lastChange = Date.now(), matchedAt = 0;
    while (true) {
      if (Date.now() - t0 > BUDGET) break;
      var s = '';
      try { s = await stageNow(); } catch (e) { s = ''; }
      if (s && s !== last) {
        last = s; lastChange = Date.now();
        console.log('[shot] stage: ' + s);
        log('[shot] stage: ' + s);
      }
      if (s === READY) { matchedAt = Date.now(); break; }
      // 'match' is only a real match once it has been stable for a beat —
      // shot.html sets it before the scene has finished building
      if (s === 'match' && Date.now() - lastChange > 1500) { matchedAt = Date.now(); break; }
      if (/^TIMEOUT:/.test(s)) { log('[shot] harness timeout: ' + s); break; }
      if (s === 'menu' && READY !== 'menu') break;
      await sleep(150);
    }
    if (!matchedAt && last) console.log('[shot] stopping at stage: ' + last);

    // 4. settle, then capture
    if (SETTLE > 0) await sleep(SETTLE);
    var shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    if (!shot || !shot.data) throw new Error('empty screenshot');
    fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
    cdp.close();
    done = true;
    cleanup();

    if (cdpErr.length) {
      console.error(cdpErr.slice(0, 20).join('\n'));
    }
    var errs = stderrBuf.split(/\r?\n/).filter(function (l) { return /Uncaught|ERROR:CONSOLE/i.test(l); });
    if (errs.length) console.error(errs.slice(0, 20).join('\n'));
    console.log('[shot] wrote ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes)');
    return true;
  } catch (e) {
    done = true;
    cleanup();
    console.log('[shot] attempt failed: ' + e.message);
    if (stderrBuf.trim()) log('[shot] stderr: ' + stderrBuf.slice(0, 4000));
    return false;
  }
}

server.listen(0, '127.0.0.1', async function () {
  var port = server.address().port;
  var url = 'http://127.0.0.1:' + port + '/tools/shot.html' +
    '?state=' + encodeURIComponent(STATE) +
    '&time=' + encodeURIComponent(TIME) +
    '&court=' + encodeURIComponent(COURT) +
    '&view=' + encodeURIComponent(VIEW) +
    (RAY ? '&ray=' + encodeURIComponent(RAY) : '') +
    (SWEEP ? '&sweep=1' : '') +
    (TEX ? '&tex=1' : '') +
    (NOSHADOW ? '&noshadow=1' : '') +
    (RIG ? '&rig=1' : '') +
    (NORIG ? '&rig=0' : '') +
    (RIGTEST ? '&rigtest=1' : '') +
    (RIGPROBE ? '&rigprobe=1' : '') +
    (GLBTEST ? '&glbtest=1' : '') +
    (GLBTEST ? '&glbpose=' + encodeURIComponent(GLBPOSE) : '') +
    (GLB0 ? '&glb=0' : '') +
    (CLOSEUP ? '&closeup=1' : '') +
    (SCALE ? '&scale=1' : '') +
    (GSCALE ? '&gscale=' + encodeURIComponent(GSCALE) : '') +
    (GLBSCOPE !== '' ? '&glbscope=' + encodeURIComponent(GLBSCOPE) : '') +
    (PAIRZ !== '' ? '&pairz=' + encodeURIComponent(PAIRZ) : '') +
    (GKPAIR ? '&gk=1' : '') +
    (FACE !== '' ? '&face=' + encodeURIComponent(FACE) : '') +
    (GOAL ? '&goal=1' : '') +
    (CROWD ? '&crowd=1' : '') +
    (PARTS ? '&parts=1' : '') +
    (BANDS ? '&bands=1' : '') +
    (HIDEMAT ? '&hidemat=' + encodeURIComponent(HIDEMAT) : '') +
    (FINDZ ? '&findz=' + encodeURIComponent(FINDZ) : '') +
    (HIDE ? '&hide=' + encodeURIComponent(HIDE) : '') +
    '&budget=' + BUDGET;

  var MAX_TRIES = Number(arg('tries', 3));
  var ok = false;
  for (var t = 1; t <= MAX_TRIES && !ok; t++) {
    try { if (fs.existsSync(OUT)) fs.unlinkSync(OUT); } catch (e) {}
    try { if (fs.existsSync(OUT + '.log')) fs.unlinkSync(OUT + '.log'); } catch (e) {}
    ok = await attempt(t, MAX_TRIES, url);
  }
  server.close();
  if (!ok) { console.error('[shot] FAILED after ' + MAX_TRIES + ' tries'); process.exit(1); }
  process.exit(0);
});
