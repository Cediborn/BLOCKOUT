// ============================================================
// tools/shot.js — headless screenshot of the REAL game (verification only)
//
// Serves the repo over localhost, boots index.html in headless Chrome and
// drives it straight into a match (or a menu) through the game's own event
// bus, then saves a PNG. Used to eyeball lighting / framing / HUD changes.
//
//   node tools/shot.js                       match, day, procedural court
//   node tools/shot.js --court motherland    a painted court
//   node tools/shot.js --time night          night lighting
//   node tools/shot.js --state menu          main menu
//   node tools/shot.js --out before.png
//   node tools/shot.js --ray 757,500;772,300   dump what the scene raycast hits
//   node tools/shot.js --sweep                 grid-sweep the frame, printed
//   node tools/shot.js --tex                    dump ground/pitch textures
//   node tools/shot.js --noshadow                render with shadows disabled
//   node tools/shot.js --findz -2.14              list meshes crossing that z
//   node tools/shot.js --hide asphalt,slab         hide ground-plane layers
//   node tools/shot.js --view portrait
// ============================================================
var fs = require('fs');
var path = require('path');
var http = require('http');
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
var BUDGET = Number(arg('budget', 9000));
var SIZE = arg('size', '1440,810').split(',');
var VIEW = arg('view', 'landscape');
var RAY = arg('ray', '');
var SWEEP = !!args.includes('--sweep');
var TEX = !!args.includes('--tex');
var NOSHADOW = !!args.includes('--noshadow');
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

server.listen(0, '127.0.0.1', function () {
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
    (FINDZ ? '&findz=' + encodeURIComponent(FINDZ) : '') +
    (HIDE ? '&hide=' + encodeURIComponent(HIDE) : '') +
    '&budget=' + BUDGET;

  var MAX_TRIES = Number(arg('tries', 3));
  var TRIES = 0;

  function attempt() {
    TRIES++;
    try { if (fs.existsSync(OUT)) fs.unlinkSync(OUT); } catch (e) {}
    try { if (fs.existsSync(OUT + '.log')) fs.unlinkSync(OUT + '.log'); } catch (e) {}

    var profile = path.join(require('os').tmpdir(), 'blockout-shot-' + Date.now() + '-' + TRIES);
    var cmd = [
      '--headless=new',
      '--disable-gpu',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--hide-scrollbars',
      '--mute-audio',
      '--enable-logging=stderr',
      '--v=0',
      '--no-first-run',
      '--disable-extensions',
      '--run-all-compositor-stages-before-draw',
      '--user-data-dir=' + profile,
      '--window-size=' + SIZE[0] + ',' + SIZE[1],
      '--virtual-time-budget=' + BUDGET,
      '--screenshot=' + OUT,
      url,
    ];

    console.log('[shot] try ' + TRIES + '/' + MAX_TRIES + ' ' + url);
    // stream Chrome's log to <out>.log as it arrives so a slow / hung probe can
    // still be inspected while it runs
    var logFile = OUT + '.log';
    var logStream = fs.createWriteStream(logFile);
    var proc = child.spawn(CHROME, cmd, { stdio: ['ignore', 'pipe', 'pipe'] });
    var timer = setTimeout(function () { try { proc.kill(); } catch (e) {} }, 170000);
    var se = '';
    proc.stdout.on('data', function (d) { logStream.write(d); });
    proc.stderr.on('data', function (d) { se += d; logStream.write(d); });
    proc.on('error', function (err) {
      clearTimeout(timer); logStream.end(); server.close();
      console.error('[shot] chrome: ' + err.message);
      process.exit(1);
    });
    proc.on('close', function (code) {
      clearTimeout(timer);
      try { require('fs').rmSync(profile, { recursive: true, force: true }); } catch (e) {}
      logStream.end();
      if (fs.existsSync(OUT)) {
        server.close();
        if (se && se.trim()) {
          var lines = se.trim().split(/\r?\n/);
          var interesting = lines.filter(function (l) { return /CONSOLE|Uncaught|ERROR:CONSOLE/i.test(l); });
          if (!interesting.length) interesting = lines.slice(0, 8);
          console.error(interesting.slice(0, 300).join('\n'));
        }
        console.log('[shot] wrote ' + OUT + ' (' + fs.statSync(OUT).size + ' bytes)');
        process.exit(0);
      }
      if (TRIES < MAX_TRIES) {
        console.log('[shot] no output (exit ' + code + ') — retrying');
        attempt();
        return;
      }
      server.close();
      console.error('[shot] FAILED — no output after ' + MAX_TRIES + ' tries');
      process.exit(1);
    });
  }

  attempt();
});








