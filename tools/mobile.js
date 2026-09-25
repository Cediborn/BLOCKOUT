// ============================================================
// tools/mobile.js — REAL-BROWSER mobile startup test (verification only)
// Boots the shipped game in headless Chrome at a phone viewport and walks the
// exact field-report scenario: fresh launch -> full HUD -> joystick present,
// uncovered and taking touch input, before / during / after a rotation, then
// menu -> match again and a plain reload. Run: node tools/mobile.js
// ============================================================
var fs = require('fs'), path = require('path'), http = require('http'), net = require('net');
var cp = require('child_process'), os = require('os');

var ROOT = path.join(__dirname, '..');
var FAIL = 0;
function check(cond, label, detail) {
  if (cond) console.log('  ok   ' + label);
  else { FAIL++; console.log('  FAIL ' + label + (detail !== undefined ? '  ->  ' + detail : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

// ---------------- static server ----------------
var MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg' };
var server = http.createServer(function (req, res) {
  var url = decodeURIComponent(String(req.url).split('?')[0]);
  if (url === '/') url = '/index.html';
  var file = path.normalize(path.join(ROOT, url));
  if (path.relative(ROOT, file).indexOf('..') === 0) { res.writeHead(403); return res.end(); }
  fs.readFile(file, function (err, buf) {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
});

function freePort() {
  return new Promise(function (resolve) {
    var s = net.createServer();
    s.listen(0, '127.0.0.1', function () { var p = s.address().port; s.close(function () { resolve(p); }); });
  });
}

// ---------------- chrome ----------------
function findChrome() {
  var cands = [
    path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ];
  for (var i = 0; i < cands.length; i++) if (cands[i] && fs.existsSync(cands[i])) return cands[i];
  return null;
}

// ---------------- cdp ----------------
function makeCdp(wsUrl) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket(wsUrl);
    var id = 0, pending = {}, listeners = [];
    ws.onopen = function () {
      resolve({
        send: function (method, params) {
          var mid = ++id;
          ws.send(JSON.stringify({ id: mid, method: method, params: params || {} }));
          return new Promise(function (res, rej) { pending[mid] = { res: res, rej: rej }; });
        },
        on: function (fn) { listeners.push(fn); },
        close: function () { try { ws.close(); } catch (e) {} },
      });
    };
    ws.onerror = function (e) { reject(new Error('cdp socket failed')); };
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && pending[m.id]) {
        var p = pending[m.id]; delete pending[m.id];
        if (m.error) p.rej(new Error(m.error.message)); else p.res(m.result);
      } else if (m.method) {
        listeners.forEach(function (f) { try { f(m); } catch (e) {} });
      }
    };
  });
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// evaluate in the page, resolve the value (promise-aware)
function ev(cdp, expression) {
  return cdp.send('Runtime.evaluate', { expression: expression, returnByValue: true, awaitPromise: true })
    .then(function (r) {
      if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
      return r.result ? r.result.value : undefined;
    });
}

// wait inside the page for a condition (rAF-driven, no fixed sleeps)
function waitFor(cdp, expression, timeoutMs) {
  var expr = 'new Promise(function(done){var t0=Date.now();(function w(){var v=false;try{v=!!(' + expression + ');}catch(e){v=false;}if(v)return done(true);if(Date.now()-t0>' + (timeoutMs || 20000) + ')return done(false);requestAnimationFrame(w);})();})';
  return ev(cdp, expr);
}

// one JSON report of everything the field report complained about
var REPORT = [
  '(function(){',
  ' function R(id){var e=document.getElementById(id);if(!e)return null;var r=e.getBoundingClientRect();',
  '  return {x:Math.round(r.left),y:Math.round(r.top),w:Math.round(r.width),h:Math.round(r.height)};}',
  ' function covered(id){var e=document.getElementById(id);if(!e)return true;var r=e.getBoundingClientRect();',
  '  if(r.width<=0||r.height<=0)return true;',
  '  var hit=document.elementFromPoint(r.left+r.width/2, r.top+r.height/2);',
  '  if(!hit)return true; while(hit){if(hit===e)return false;hit=hit.parentElement;} return true;}',
  ' function inView(id){var r=R(id);if(!r)return false;return r.x>=-1&&r.y>=-1&&r.x+r.w<=innerWidth+1&&r.y+r.h<=innerHeight+1;}',
  ' var zone=document.getElementById("joystick-zone");',
  ' var btns=["btn-pass","btn-shoot","btn-tackle","btn-switch","btn-sprint"];',
  ' return {',
  '  state: (window.LGMain?LGMain.getState():null),',
  '  inner: [innerWidth, innerHeight],',
  '  vp: (window.LGMain?LGMain.getViewport():null),',
  '  portrait: document.body.classList.contains("is-portrait"),',
  '  bodyCls: document.body.className,',
  '  coarse: (window.matchMedia ? matchMedia("(pointer: coarse)").matches : null),',
  '  touch: ("ontouchstart" in window),',
  '  rz: (window.__rz || 0),',
  '  ds: (window.LG && LG.Player ? LG.Player.deviceScale : null),',
  '  rotCls: document.getElementById("rotate-overlay").className,',
  '  coverHidden: document.getElementById("loading-overlay").classList.contains("hidden"),',
  '  menu: !document.getElementById("menu-overlay").classList.contains("hidden"),',
  '  controlsHidden: document.getElementById("controls").classList.contains("hidden"),',
  '  joyRect: R("joystick-zone"), joyCovered: covered("joystick-zone"), joyInView: inView("joystick-zone"),',
  '  joySize: zone?Math.round(zone.getBoundingClientRect().width):0,',
  '  hintShown: !document.getElementById("rotate-overlay").classList.contains("hidden"),',
  '  hintPE: getComputedStyle(document.getElementById("rotate-overlay")).pointerEvents,',
  '  btn: btns.map(function(id){var r=R(id);var e=document.getElementById(id);',
  '     return {id:id,on:e?!e.classList.contains("hidden-control")&&!e.classList.contains("hidden"):false,',
  '             covered:covered(id), inView:inView(id), w:r?r.w:0};}),',
  ' };})()'
].join('\n');

function report(cdp) { return ev(cdp, 'JSON.stringify(' + REPORT + ')').then(JSON.parse); }

function show(tag, r) {
  console.log('   [' + tag + '] ' + r.inner[0] + 'x' + r.inner[1] +
    ' state=' + r.state + ' vp=' + (r.vp ? r.vp.w + 'x' + r.vp.h : '-') +
    ' resizeEvents=' + r.rz + ' coarse=' + r.coarse + ' touch=' + r.touch +
    ' joy=' + JSON.stringify(r.joyRect) + ' covered=' + r.joyCovered +
    ' hint=' + r.hintShown + (r.hintShown ? ' (pointer-events=' + r.hintPE + ')' : ''));
}

// is the page actually animating, and is the layout pipeline alive?
function dbg(cdp, tag) {
  var e = '(function(){var v=window.LGMain?LGMain.getViewport():null;' +
    'return JSON.stringify({inner:[innerWidth,innerHeight],applies:v?v.applies:-1,' +
    'raf:(window.__raf||0),rz:(window.__rz||0),loop:(window.__loopN||0),' +
    'rot:document.getElementById("rotate-overlay").className,ds:(window.LG&&LG.Player?LG.Player.deviceScale:null),' +
    'vis:document.visibilityState,hidden:document.hidden,now:Math.round(performance.now())});})()';
  return ev(cdp, e).then(function (s) { console.log('   [' + tag + '] ' + s); return JSON.parse(s); });
}

// everything the menu music controller + its chip are doing right now
function musicState(cdp) {
  var e = '(function(){if(!(window.LG&&LG.Music))return null;' +
    'var s=LG.Music.snapshot(),n=document.getElementById("now-playing"),t=document.querySelector("#now-playing .np-title");' +
    'var r=n?n.getBoundingClientRect():null,cs=n?getComputedStyle(n):null;' +
    'return {snap:s, show:!!n&&n.classList.contains("show"), title:t?t.textContent:"",' +
    'st:(window.LGMain?LGMain.getState():null), loopN:(window.__loopN||0),' +
    'inView:!!r&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1,' +
    'w:r?Math.round(r.width):0,h:r?Math.round(r.height):0,pe:cs?cs.pointerEvents:null};})()';
  return ev(cdp, e);
}

// click the real controls with trusted input (a real mouse press, so
// fullscreen/gesture-gated APIs behave like a phone tap). Panels scroll on
// short landscape viewports, so reveal the target first like a player would.
function tap(cdp, id) {
  var reveal = '(function(){var e=document.getElementById("' + id + '");if(!e)return false;var r=e.getBoundingClientRect();' +
    'if(r.top<8||r.bottom>innerHeight-8){ if(e.scrollIntoView)e.scrollIntoView({block:"center"}); return true;} return false;})()';
  var probe = '(function(){var e=document.getElementById("' + id + '");if(!e)return null;var r=e.getBoundingClientRect();' +
    'var x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);' +
    'var h=document.elementFromPoint(x,y);' +
    'return {x:x,y:y,w:Math.round(r.width),h:Math.round(r.height),' +
    'hit:h?((h.id||h.tagName)+(h.className&&h.className.baseVal===undefined?("."+String(h.className).split(" ")[0]):"")):null,' +
    'ok:!!(h&&(h===e||e.contains(h)))};})()';
  return ev(cdp, reveal)
    .then(function () { return ev(cdp, probe); })
    .then(function (p) {
      if (!p) throw new Error('no element ' + id);
      if (!p.ok) console.log('   tap ' + id + ' would hit ' + p.hit + ' (' + p.w + 'x' + p.h + ')');
      var base = { x: p.x, y: p.y, button: 'left', clickCount: 1 };
      return cdp.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseMoved', buttons: 0 }, base))
        .then(function () { return cdp.send('Input.dispatchMouseEvent', Object.assign({ type: 'mousePressed', buttons: 1 }, base)); })
        .then(function () { return cdp.send('Input.dispatchMouseEvent', Object.assign({ type: 'mouseReleased', buttons: 0 }, base)); });
    });
}

// a finger drag inside an open menu panel: on a 390px-tall landscape phone
// every panel scrolls, and that only works if the panel is allowed to pan
function touchScrollPanel(cdp) {
  var where = '(function(){var p=document.querySelector(".overlay:not(.hidden) .panel");if(!p)return null;' +
    'var r=p.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+26),id:p.parentElement.id,can:p.scrollHeight>p.clientHeight};})()';
  var pt = function (x, y) { return [{ x: x, y: y, id: 1, radiusX: 12, radiusY: 12, force: 1 }]; };
  return ev(cdp, where).then(function (p) {
    if (!p) return null;
    if (!p.can) { console.log('   (panel ' + p.id + ' fits, nothing to scroll)'); return null; }
    return cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(p.x, p.y) })
      .then(function () { return cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(p.x, p.y - 70) }); })
      .then(function () { return cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(p.x, p.y - 150) }); })
      .then(function () { return sleep(80); })
      .then(function () { return cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); })
      .then(function () { return sleep(150); })
      .then(function () {
        return ev(cdp, '(function(){var p=document.querySelector(".overlay:not(.hidden) .panel");return p?Math.round(p.scrollTop):-1;})()');
      })
      .then(function (st) {
        check(st > 0, 'a finger drag scrolls the open menu panel (short landscape viewports)', st);
        return ev(cdp, '(function(){var p=document.querySelector(".overlay:not(.hidden) .panel");if(p)p.scrollTop=0;return true;})()');
      });
  });
}

var FLOW = ['btn-play', 'btn-mode-go', 'btn-diff-go', 'btn-select-go', 'btn-style-go', 'btn-court-go', 'btn-start-match'];
function playMatch(cdp, from) {
  // each screen reveals its panel with a 0.32s paste-in animation — settle it
  // first so the press lands on the final position, like a human would
  return FLOW.slice(from || 0).reduce(function (p, id) {
    return p.then(function () { return sleep(420); }).then(function () { return tap(cdp, id); });
  }, Promise.resolve());
}

// a real touch drag across the joystick
function dragStick(cdp) {
  return report(cdp).then(function (r) {
    var cx = r.joyRect.x + r.joyRect.w / 2, cy = r.joyRect.y + r.joyRect.h / 2;
    var pts = function (x, y) { return [{ x: x, y: y, id: 1, radiusX: 12, radiusY: 12, force: 1 }]; };
    return cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(cx, cy) })
      .then(function () { return cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(cx + 40, cy) }); })
      .then(function () { return cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(cx + 110, cy) }); })
      .then(function () { return sleep(60); })
      .then(function () { return ev(cdp, 'JSON.stringify(LG.Input.moveVec())'); })
      .then(function (mv) {
        var v = JSON.parse(mv);
        check(v.x > 0.5 && Math.abs(v.y) < 0.3, 'a real touch drag on the joystick steers the player', mv);
        return cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      })
      .then(function () { return sleep(30); })
      .then(function () { return ev(cdp, 'JSON.stringify(LG.Input.moveVec())'); })
      .then(function (mv2) {
        var v2 = JSON.parse(mv2);
        check(v2.x === 0 && v2.y === 0, 'lifting the thumb stops the stick', mv2);
      });
  });
}

function checkControls(r, tag, wantHint) {
  check(r.state === 'match', tag + ': the match is running', r.state);
  check(!r.controlsHidden, tag + ': the control layer is shown with no rotation needed', 'controlsHidden=' + r.controlsHidden);
  check(r.joyRect && r.joyInView, tag + ': the joystick sits inside the visible viewport', JSON.stringify(r.joyRect));
  check(!r.joyCovered, tag + ': the joystick is on top and really hit-testable', JSON.stringify(r.joyRect));
  check(r.joySize > 120, tag + ': the joystick is a real size (not collapsed)', r.joySize);
  var live = r.btn.filter(function (b) { return b.on; });
  check(live.length >= 3, tag + ': the action buttons are shown', live.map(function (b) { return b.id; }).join(','));
  var bad = live.filter(function (b) { return b.covered || !b.inView || b.w < 40; });
  check(bad.length === 0, tag + ': every visible button is on screen and tappable', JSON.stringify(bad));
  if (wantHint) {
    check(r.hintShown, tag + ': the rotate hint still tells a portrait player to turn', 'hintShown=' + r.hintShown);
    check(r.portrait, tag + ': body carries is-portrait', r.portrait);
    check(r.hintPE === 'none', tag + ': the hint never blocks the joystick underneath', 'pointerEvents=' + r.hintPE);
  } else {
    check(!r.hintShown, tag + ': no rotate hint over a landscape phone', 'hintShown=' + r.hintShown);
    check(!r.portrait, tag + ': body carries is-landscape', r.portrait);
  }
}

// ---------------- main ----------------
var chromeProc = null, httpSrv = null;
async function main() {
  var chromePath = findChrome();
  if (!chromePath) { console.log('  FAIL no Chrome/Edge found'); return 1; }

  var httpPort = await freePort(), dbgPort = await freePort();
  await new Promise(function (r) { httpSrv = server.listen(httpPort, '127.0.0.1', r); });
  var url = 'http://127.0.0.1:' + httpPort + '/index.html';

  var profile = fs.mkdtempSync(path.join(os.tmpdir(), 'blockout-mob-'));
  chromeProc = cp.spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=' + dbgPort, '--user-data-dir=' + profile,
    '--no-sandbox', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--disable-features=Translate,MediaRouter',
    '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--window-size=844,390',
    // keep the browser's real autoplay gate in place: the menu music must
    // start on the player's first tap, never on its own
    '--autoplay-policy=user-gesture-required',
  ], { stdio: 'ignore', windowsHide: true });

  // wait for the devtools endpoint
  var wsUrl = null;
  for (var i = 0; i < 100 && !wsUrl; i++) {
    await sleep(200);
    try {
      var list = await (await fetch('http://127.0.0.1:' + dbgPort + '/json/list')).json();
      var page = list.filter(function (t) { return t.type === 'page'; })[0];
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) { /* chrome not up yet */ }
  }
  if (!wsUrl) throw new Error('devtools never came up');

  var cdp = await makeCdp(wsUrl);
  var jsErrors = [];
  cdp.on(function (m) {
    if (m.method === 'Runtime.exceptionThrown') {
      var d = m.params.exceptionDetails;
      jsErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry && m.params.entry.level === 'error' &&
      m.params.entry.source !== 'network') jsErrors.push(m.params.entry.text);
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  // the service worker can swap builds mid-test; the boot harness owns that
  // logic, this test is about viewport/controls so keep it out of the way
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'try{Object.defineProperty(navigator,"serviceWorker",{get:function(){return undefined;}});}catch(e){}',
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });

  async function setViewport(w, h) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: w, height: h, deviceScaleFactor: 3, mobile: true, screenWidth: w, screenHeight: h,
    });
    await sleep(150);
  }

  section('A. fresh launch, landscape phone (844x390)');
  await setViewport(844, 390);
  await cdp.send('Page.navigate', { url: url });
  var booted = await waitFor(cdp, 'window.LGMain && LGMain.getState()==="menu" && document.getElementById("loading-overlay").classList.contains("hidden")', 30000);
  check(booted, 'the game boots to the menu and lifts the boot cover');
  await ev(cdp, 'window.__rz=0;window.addEventListener("resize",function(){window.__rz++;});window.__raf=0;(function f(){window.__raf++;requestAnimationFrame(f);})();' +
    'window.__loopN=0;(function(){if(!window.LG||!LG.Input)return;var o=LG.Input.setEnabled;' +
    'LG.Input.setEnabled=function(on){window.__loopN++;return o.call(LG.Input,on);};})();true');
  var r = await report(cdp);
  show('boot', r);
  check(r.vp && r.vp.w === 844 && r.vp.h === 390, 'the renderer was sized from the real viewport',
    r.vp && (r.vp.w + 'x' + r.vp.h));
  check(!r.portrait, 'body is-landscape on a landscape phone', r.portrait);
  check(r.menu, 'the full menu interface is up', 'menu=' + r.menu);

  var ms = await musicState(cdp);
  check(ms && ms.snap && ms.snap.index >= 0 && !!ms.snap.title,
    'the first menu track is already queued on load', ms && ms.snap.title);
  check(ms && ms.snap.playing === false,
    'nothing plays before the first real gesture (autoplay gate)', JSON.stringify(ms && ms.snap));
  check(ms && !ms.show, 'no now-playing chip before a track actually starts');

  section('B. menu -> match: the whole control layer appears at once');
  await tap(cdp, 'btn-play');
  await sleep(420);

  // the first trusted tap is what the browser was waiting for
  var musicUp = await waitFor(cdp, 'window.LG && LG.Music && LG.Music.snapshot().playing === true', 12000);
  check(musicUp, 'the first real tap starts the menu music');
  ms = await musicState(cdp);
  check(ms && ms.show, 'the now-playing chip appears when a track starts', ms && ms.title);
  check(ms && ms.title && !/\.(mp3|ogg|wav|m4a|flac)$/i.test(ms.title) && !/[._]/.test(ms.title),
    'the chip shows a clean song title', ms && ms.title);
  check(ms && ms.pe === 'none', 'the chip can never block a tap', ms && ms.pe);
  check(ms && ms.inView && ms.w > 40 && ms.h > 10,
    'the chip sits on screen and is a sensible size', JSON.stringify({ w: ms && ms.w, h: ms && ms.h }));
  var starts0 = ms && ms.snap ? ms.snap.starts : -1;

  // ~5 seconds of screen time, then it gets out of the way on its own
  await sleep(5400);
  ms = await musicState(cdp);
  check(ms && !ms.show, 'the chip fades away after about 5 seconds');
  check(ms && ms.snap.playing, 'the same song keeps playing after the chip is gone');

  await dbg(cdp, 'B menu');
  await touchScrollPanel(cdp);          // the mode panel overflows a 390px-tall phone
  await playMatch(cdp, 1);
  await waitFor(cdp, 'window.LGMain && LGMain.getState()==="match"', 15000);
  await sleep(400);
  r = await report(cdp); show('landscape match', r);
  checkControls(r, 'landscape', false);
  // the stop may land on the very same tick or on the next frame — wait for it
  // instead of sampling at a fixed moment
  var musicOff = await waitFor(cdp, 'window.LG && LG.Music && LG.Music.snapshot().active === false', 8000);
  ms = await musicState(cdp);
  check(musicOff && !ms.snap.playing,
    'menu music stops when the match kicks off', JSON.stringify(ms));
  check(ms && !ms.show, 'the chip is gone over the match');
  check(ms && ms.snap.starts === starts0, 'entering the match never starts a new track',
    ms && ms.snap.starts);
  await dragStick(cdp);

  section('C. rotate to portrait during gameplay (the reported workaround)');
  await dbg(cdp, 'B pre-rot');
  await setViewport(390, 844);
  // software rendering runs the page at ~1 frame per second here, so wait for
  // the relayout itself instead of guessing how long a frame takes
  var relaid = await waitFor(cdp, 'window.LGMain && LGMain.getViewport().w===390 && LGMain.getViewport().h===844', 20000);
  check(relaid, 'rotating to portrait re-measures and relayouts the renderer',
    JSON.stringify(await ev(cdp, 'LGMain.getViewport()')));
  await sleep(300);
  await dbg(cdp, 'C after relayout');
  r = await report(cdp); show('portrait match', r);
  checkControls(r, 'portrait', true);

  section('D. rotate back to landscape');
  await setViewport(844, 390);
  await waitFor(cdp, 'window.LGMain && LGMain.getViewport().w===844 && LGMain.getViewport().h===390', 20000);
  await sleep(300);
  await dbg(cdp, 'D t+400');
  r = await report(cdp); show('landscape again', r);
  checkControls(r, 'landscape', false);
  await dragStick(cdp);

  section('E. menu -> match a second time');
  await tap(cdp, 'pause-btn');
  await sleep(450);
  await tap(cdp, 'btn-quit-menu');
  await waitFor(cdp, 'LGMain.getState()==="menu"', 8000);
  var resumed = await waitFor(cdp,
    'window.LG && LG.Music && LG.Music.snapshot().active && LG.Music.snapshot().playing', 10000);
  check(resumed, 'returning to the menu resumes the music');
  ms = await musicState(cdp);
  check(ms && !ms.show, 'resuming the same song shows no second chip', ms && ms.title);
  check(ms && ms.snap.starts === starts0, 'the round trip never counts a new track',
    ms && ms.snap.starts);
  await playMatch(cdp);
  await waitFor(cdp, 'LGMain.getState()==="match"', 15000);
  await sleep(400);
  r = await report(cdp); show('second match', r);
  checkControls(r, 'second match', false);

  section('F. plain reload is deterministic');
  await cdp.send('Page.reload', { ignoreCache: true });
  var reloaded = await waitFor(cdp, 'window.LGMain && LGMain.getState()==="menu" && document.getElementById("loading-overlay").classList.contains("hidden")', 30000);
  check(reloaded, 'reload boots to the menu again');
  r = await report(cdp); show('reloaded', r);
  check(r.vp && r.vp.w === 844 && r.vp.h === 390, 'the reload measures the same viewport', r.vp && (r.vp.w + 'x' + r.vp.h));
  check(r.coverHidden && r.menu, 'interface complete after reload', 'coverHidden=' + r.coverHidden);
  ms = await musicState(cdp);
  check(ms && ms.snap.index >= 0 && !ms.snap.playing && !ms.show,
    'a reload re-queues the playlist and waits for a gesture again',
    JSON.stringify(ms && ms.snap));

  section('G. no javascript / console errors');
  check(jsErrors.length === 0, 'the page raised no JS or console errors', jsErrors.slice(0, 4).join(' | '));

  return FAIL;
}

main().then(function (code) {
  console.log('\n---------------------------------------------');
  console.log(code === 0 ? 'MOBILE STARTUP TEST PASSED' : (code + ' FAILED'));
  console.log('---------------------------------------------');
  shutdown(code);
}).catch(function (e) {
  console.log('  FAIL harness threw  ->  ' + e.message);
  shutdown(1);
});

function shutdown(code) {
  try { if (chromeProc) chromeProc.kill(); } catch (e) {}
  try { if (httpSrv) httpSrv.close(); } catch (e) {}
  setTimeout(function () { process.exit(code ? 1 : 0); }, 300);
}
