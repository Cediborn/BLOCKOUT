# PHASE 3D — GOAL CELEBRATION CINEMATIC: TECHNICAL AUDIT

Read-only audit of the existing goal flow. No gameplay, camera, animation, physics or model files were modified. Findings are tagged `file:line` against the current `main` (`2ed986a`).

Proposed architecture: `LG.GoalCinematic` with `start / update / finish / abort` (Section J).

---

## A. GOAL FLOW

- **Trigger** — `checkGoal` (`js/match.js:1477`), called only from the PLAY branch after `ball.step` + keepers. Own goal ⇒ `scorer = null`, `isOwnGoal = true`.
- **Order inside `checkGoal`**:
  1. stats/awards; release carrier (`match.js:1532-1534`); `ball.kickT = 10` (`:1536`)
  2. `this.state = 'GOAL'` (`:1537`) — **no `'state'` event is emitted for GOAL entry** (only KICKOFF `:376/:480` and PLAY `:484` emit `'state'`)
  3. `stateT = goalDelay` (`:1538`, config `js/config.js:19-26` = **2.6 s**)
  4. FX: confetti + ring at net (`:1542-1543`), `shakeEffect(0.6, 0.7)` (`:1544` → `camera.js` `shake`), `camera.pulse(1)` (`:1545`)
  5. `sfx.goal(...)` (`:1547`) — audio is **direct**, not event-driven
  6. meter/award fill (`:1549-1552`)
  7. `LG.Celebration.start(scorer, team, isOwnGoal)` (`:1555`)
  8. `bus.emit('goal', {team, scorer, assist, isOwnGoal, score})` (`:1557-1561`)
  9. scorer confetti (`:1563`)
- **GOAL state machine** (`match.js:469-482`): `updatePlayers(0)` (`:473`) → `Celebration.update(this, dt)` (`:474`) → at `stateT <= 0` (`:475`): `Celebration.stop() + clearPoses` (`:476`), `state='KICKOFF'` (`:477`), `stateT=kickoffDelay` 1.4 s (`:478`), `placeKickoff()` (`:479`), `emit('state', KICKOFF)` (`:480`).
- **`'goal'` listeners**: `js/main.js:708` (HUD banner/flash/score + `camCtrl.pulse(0.5)`), `js/crowd.js:274` (cheer 2.8 s), `js/living.js:170` (pedestrian pulse), probes `tools/shot.html:271`, `tools/sim.js`.
- **`'kickoff'`/`'matchEnd'` listeners**: `js/celebration.js:232-234` (stop). Event bus is `LG.Events` — `on/off/emit` only, **no `once`** (`js/util.js:52-64`).
- `stateT` is the only clock of the window; counts down with real `dt` each frame.
- **Consequence for a cinematic**: the only same-frame hooks are `'goal'` (payload complete) or a direct call from `checkGoal` (match-logic edit — avoid).

## B. CAMERA

- Single `THREE.PerspectiveCamera` created `js/main.js:68` (fov / near 0.1 / far 220), wrapped by `LG.MatchCamera` at `:70` (`camCtrl`), `reset()` at `:70/:677/:1497-1498`; `match.camera = camCtrl` at `:1484`.
- **Driven every frame** `main.js:1882` (inside `UIState==='match'`) — **after** `match.update(dt)` (`:1881`): `MatchCamera.update` writes `camera.position` + `lookAt` **unconditionally** (`js/camera.js:119-129`) and lerps fov (`:132-137`). Any same-frame cinematic camera write is overwritten ⇒ takeover must guard **at `main.js:1882`** (branch) or as an early return in `MatchCamera.update` (`camera.js:65`).
- **Internals** (`camera.js`): `followX/followZ` damped, `k = dt*6.5` (`:81-83`) + clamps (`:88-107`: portrait xClamp 11 / zClamp 18.5 + hard near-player guarantees; landscape xClamp 4 / zClamp 14); shake offsets with `Math.random` (`:111-117`); `fov = C.fov − zoomPulse*7` (`:133`). Portrait pose `(followX, 30, followZ+25) → (followX, 1, followZ−2.5)`; landscape `(followX+25, 30, followZ) → (followX, 1, followZ)`.
- **Other camera writers**: `reset()` (`camera.js:38-53`, hard center), menu drift `main.js:1894`, pause pose `(0,19,24)` (pause branch), resize. `shake()/pulse()` gated by `Settings.reducedMotion` at source (`camera.js:56/61`); stale pulses zeroed pattern at `main.js:820`.
- **No camera reset on goal/kickoff** — follow damping runs continuously ⇒ normally smooth; also means `followX/followZ` are public and seedable for blend-back.
- Goal-time pulse/shake (`:1544-1545`, `main.js:714`) only decay inside `camCtrl.update` ⇒ during a takeover they freeze and would re-apply on resume ⇒ **zero `shakeT/shakeAmp/zoomPulse` at finish**.
- Config: `config.js` camera block (`height 30 / distance 25 / fov 50`, landscape `fov 54 / xClamp 4 / zClamp 14`).

## C. CELEBRATION

- `js/celebration.js` (`LG.Celebration :9`): private LCG `prand` (`:12`, seed `0xC0FFEE` — seed-pinned-sim safe), 7 TYPES (`:18`), `start` (`:36`), `stop` (`:51`), `nudgeToward` (`:92`), `resetPose` (`:98`), `update` (`:109`), `clearPoses` (`:224`), `bind` (`:229`) — bound from `match.js:38`.
- Durations (`:44`): slide 3.2 / huddle-group 3.0 / base 2.4 `+ prand()*0.6` ⇒ 2.4–3.8 s; own goal ⇒ `'calm'`. **Effective duration = `min(dur, goalDelay 2.6 s)`** — GOAL exit (`match.js:476`) force-stops mid-pose.
- `current = {type, t, dur, scorer, team, own}` is readable (`tools/shot.html:233`).
- **Poses are a post-mixer bone layer**: `updatePlayers(0)` runs the mixer first (`q.update` inside), then `Celebration.update` writes `p.model.limbs.armL/armR.rotation` with 0.2–0.3 lerp + `body.rotation.x` + `p.facing` — works on GLB bones and procedural Groups alike; `nudgeToward` only zeroes `vx/vz` (**glide disabled — no position writes**).
- Reuse safety: **YES** — v1 cinematic keeps Celebration as the sole limb/pose owner; cinematic owns camera + optional scorer translation only. Do not double-drive bones.

## D. ANIMATION

- Clips: retarget bank idle/jog/run/sprint/stop + `kick` (authored from GLB `Kick` via `/kick|shoot|strike/`, `realplayer.js:734`); GLB ships five authored clips (Kick, Push, Tackle, +2). **No celebration clips exist.** `buildBank` cached in `bankCache` (`realplayer.js:838/:840`), per-player `cloneRig` (`:357`) at build time only.
- Controller contract `state() / pose(name,t) / step / update(dt,p)` (`rig.js:416-463`, `realplayer.js:962+`): **`update` drives the mixer from the real clock** (`nowMs`, `rdt` clamp 0.1) ⇒ mixers keep animating during GOAL (`player.js` comment block; `dt=0` only freezes gameplay timers — `kickAnim` decay `player.js:117`).
- `pose()` is transient: `MIN_DWELL 0.15 s` then the controller transitions back toward the idle want (speed 0 during GOAL) ⇒ **cannot hold a pose > 0.15 s through the public API while `update` runs**.
- No per-player clip trigger exists during gameplay; GLB clip baking is build-time (`bankCache`). Established per-frame override mechanism = Celebration's post-mixer bone layer.
- Failure isolation precedent: `anim.update` returning `false` ⇒ `player.js:186-192` drops `model.anim` with `[RIG] FALLBACK` + procedural `animateChar` (`:195`) ⇒ cinematic must follow the same pattern (throw ⇒ abort, frame loop never breaks).

## E. MOVEMENT

- State: `p.x/p.z` clamped to court bounds **every** `player.update` even at `dt=0` (`player.js:159`); `p.y` default 0 (`:49`); mesh sync `group.position`/`rotation.y` every frame (`:199-200`). Sanctioned teleport pattern = `placeKickoff` (`match.js:428-436`): write `p.x/p.z/vx/vz/facing`, then `group.position.set` + `group.rotation.y` for same-frame accuracy.
- `vx/vz` zeroed each frozen frame (`match.js:546-556`); integration runs at `dt=0` ⇒ residual velocity cannot move a player during GOAL.
- **`resolvePlayerCollisions` runs every frame including GOAL** (`match.js:559` → `:1616`) and writes `x/z` ⇒ cinematic placements must keep separation ≥ `r1+r2` (~0.84 × visualScale) from every other player (corner-flag areas are proven clear), or accept the nudge.
- Input cannot interfere: `resolveHuman` early-returns before switch/shot logic while frozen (`match.js:592-597`); `facing` auto-rotate only when speed > 0.04 ⇒ facing sticks unless the cinematic writes it.
- Never touch: `vx/vz` intent, AI, ball, keeper.

## F. CROWD / AUDIO

- Everything fires the **same frame** as the `'goal'` emit (t=0): crowd cheer `crowd.js:274` (`CHEER_DUR 2.8` `:25`, section stagger `SEC_DELAY` `:30` = home 0 / away 0.08 / side 0.14, arm swing −2.45 rad, exposed in `stats`); living pulse `living.js:170`; HUD banner `GOAL!/CONCEDED` 1800 ms + flash + score + `camCtrl.pulse(0.5)` `main.js:708-715`; direct FX `match.js:1542-1547` (confetti/ring/shake/pulse + `sfx.goal` → melody + `crowdCheer` `audio.js:139`).
- Shot swell: `crowd.js:276` on `'shoot'` power ≥ 0.5, `SWELL_DUR 0.9` (`:26`); deterministic `crowdSwell` (`audio.js`, 3C).
- **No manual re-pulse API on crowd** (events only) ⇒ a cinematic outliving 2.8 s sees cheer decay; a second wave would need an additive `LG.Crowd.pulse()` (leave as-is unless requested).
- `crowdCheer` allocates ~18–40 `AudioBufferSourceNodes` per call ⇒ **never per-frame**.
- Determinism: sim headless path stubs `LG.Particles` (`tools/sim.js:157`) and loads neither `crowd.js`, `celebration.js`, `camera.js` nor `realplayer.js` (`sim.js:145-148`) — `Math.random` in crowd/particles runs browser-only.

## G. FREEZE

GOAL branch freezes gameplay and keeps presentation alive — exactly the slot a cinematic occupies:

| Frozen during GOAL | Continues during GOAL |
|---|---|
| `ball.step`, keepers, `checkGoal` | mixers (real clock, `q.update` inside `updatePlayers(0)`) |
| `tickTimer` (clock paused, PLAY only `:484`) | `Celebration.update(this, dt)` (`:474`) |
| human intent / switch / shots (`resolveHuman` early-return) | `resolvePlayerCollisions` (`:559`) — see E |
| AI effect (`ai.update(0)`), `vx/vz` | whole main loop after `match.update`: `camCtrl.update` `:1882`, HUD `:1883-1885`, `Particles.update` `:1887`, `arenaObj.update`, `Living.update`, render |
| `updateControlMode` only flips a HUD chip (`:444`, `match.js:662-670`) — `match.active` never switches during GOAL | crowd cheer 2.8 s, audio |

- Pause (`main.js:621-634`) sets `UIState='paused'` ⇒ `match.update` not called at all ⇒ `stateT` + any loop-driven cinematic timer freeze; `resumeRequested` (`:635-640`) resets `lastNow` ⇒ no dt spike on resume.

## H. KICKOFF RETURN

- Exit `match.js:475-481`: stop + clearPoses → `state='KICKOFF'`, `stateT=1.4`, `placeKickoff()`, `emit('state', KICKOFF)` (`:480`); `placeKickoff` also emits `'kickoff'` (`:422`) → `Celebration.stop` (`celebration.js:232`); HUD toast via state listener (`main.js:717-719`).
- `placeKickoff` (`match.js:382-423`): formation tables, `vx/vz=0`, stamina 1, mesh sync (`:403/:414`), `faceBall` (facing = atan2 to center), keepers reposition, `ball.reset(0,0)`, possession dropped.
- **Camera never resets** — damping resumes from current `followX/followZ` ⇒ smooth only if the cinematic seeded them before handback; otherwise snap.
- `endMatch` (`:1570`): `state='END'`, `stateT=endDelay` 2.2 s, `crowdStop`, whistle, `'matchEnd'` → celebration stop (`:234`), results UI (`main.js:750`).
- Cinematic must `finish`/`abort` by the kickoff frame at the latest; `placeKickoff` overwrites all player positions anyway (positions self-heal), but the camera-guard flag must be cleared by the `'kickoff'` listener.

## I. PERFORMANCE RISKS

- **Build-time only** (never during GOAL): `cloneRig` ~20 ms/player (rosters ~100–145 ms), `buildBank` (cached), procedural rig build, arena build ~135 ms, crowd build ~11.5 ms.
- No second camera/renderer/scene — drive THE main camera (`main.js:1904` render).
- Particles already pooled: `MAX 900`, `RING_MAX 10`, object pool in `emit` (`particles.js:7-13/:72-80`); `confetti` (`:152`) reuses it. Any new visual must reuse particles — **no new geometry/materials/meshes** (draw-call baseline post-3C: 391 calls / 106 k tris).
- Per-frame allocations: scratch objects only (pattern: `camera.js` locals, `crowd.js` `_T/_P`); timelines/keyframes precomputed in `start()`.
- fov writes only when `|Δ| > 0.01` (`camera.js:134`); no per-frame `updateProjectionMatrix` thrash.
- No per-frame WebAudio, no repeated `crowdCheer`, no per-frame DOM writes (HUD banner/flash are already once-per-goal, `hud.js:143`).
- JSON deep copies (`applyKit` / outfit) stay setup-only.

## J. RECOMMENDED IMPLEMENTATION POINTS

Minimal touch surface (audit only — **not applied**):

1. **Camera takeover slot — `main.js:1881-1882`** (preferred over editing `camera.js`):
   ```js
   match.update(dt);
   if (LG.GoalCinematic && LG.GoalCinematic.active()) LG.GoalCinematic.update(dt);
   else camCtrl.update(dt, match.active.x, match.active.z, match.ball.x, match.ball.z);
   ```
   Pause/menu branches already own the camera in `main.js`, so keeping takeover here leaves `camera.js` and `match.js` untouched. Falls back to today's exact behavior whenever inactive.
2. **Start hook** — new `bus.on('goal', …)` beside `main.js:708` (payload + `match` in scope), guarded by `match.camera` + renderer presence (headless sim never sets `match.camera` — it is only assigned at `main.js:1484` — and loads no cinematic module).
3. **Abort hooks (module-internal)** — `'kickoff'`, `'matchEnd'`, `'pauseRequested'` via `LG.Events.on`; idempotent `bind()` flag (no `once` in the bus — pattern: `crowd.js` `bound`, `celebration.js:229-235`).
4. **Loaders** — `<script>` in `index.html` after `celebration.js` (`:622`); cache entry in `service-worker.js` (`:49` block); optionally `tools/boot.js` SRC (`:230-233`) for parse coverage; **exclude from `tools/sim.js` SRC** (`:145-148`) to keep the seed-pinned path untouched.
5. **Optional config** — additive `cinematic: { enabled, maxDur, extendGoalDelay }` block in `config.js`.
6. **Invariants for the future build phase**:
   - never write `match.state`, `ball`, AI, clock; `stateT` extension must be saved in `start` and restored in `abort`
   - scorer writes = `p.x/p.z/p.y/p.facing` + immediate `group` sync (kickoff pattern `match.js:428-436`), bounds-clamped, separation-aware vs `resolvePlayerCollisions`
   - never drive limbs — Celebration owns bone layering during GOAL
   - at finish: zero `camCtrl.shakeT/shakeAmp/zoomPulse` (`main.js:820` pattern), seed `followX/followZ` to the current blend target, restore `cfg().fov`
   - whole `update` wrapped in `try/catch → abort`; respect `Settings.reducedMotion`
   - no `Math.random` in any path that could run headless (module excluded from sim regardless)

---

## PROPOSED ARCHITECTURE — `LG.GoalCinematic`

New file `js/goal-cinematic.js`, presentation-only, self-bound, mirrors `LG.Celebration` style:

```js
LG.GoalCinematic = (function () {
  // private: active flag, preallocated timeline, scorer ref,
  //          saved { stateT, followX, followZ, shakeT, shakeAmp, zoomPulse, fov }, bound flag
  function bind()    {} // idempotent: bus.on('goal', attempt) | ('kickoff'|'matchEnd'|'pauseRequested', abort)
  function start(g)  {} // guards → snapshot → build keyframes → active = true (returns bool)
  function update(dt){} // called ONLY from main loop while active; try/catch → abort
  function finish()  {} // blend handback, zero pulses, seed follow, active = false
  function abort(reason) {} // instant handback + stateT restore, debug log, never throws
  function active()  {}
  return { bind: bind, start: start, update: update, finish: finish, abort: abort, active: active };
})();
```

**Lifecycle**

| fn | contract |
|---|---|
| `bind()` | idempotent; registers `'goal'` → `start`, `'kickoff' / 'matchEnd' / 'pauseRequested'` → `abort` |
| `start(g)` | guards: `g.scorer && scorer.model && scorer.model.group`, `match.camera` present, `match.state==='GOAL'`, reduced-motion policy, duration cap. Snapshot camera + `match.stateT`; precompute keyframes; `active=true`. Any failure ⇒ return false (silent — current flow runs unchanged) |
| `update(dt)` | advance timeline; write scorer pose (kickoff-pattern teleport, bounds + separation guard); write camera position/lookAt/fov using the same portrait/landscape poses as `camera.js:119-129` parametrized over time; `finish` when timeline done or `match.state!=='GOAL'` or elapsed > cap; `abort` on throw |
| `finish()` | 0.3–0.5 s blend to gameplay pose (or seed `followX/followZ` and let damping continue), zero `shakeT/shakeAmp/zoomPulse`, `active=false` |
| `abort(reason)` | instant handback (worst case = today's snap behavior), restore `stateT` if extended, `console.debug('[CIN] abort:', reason)`, never rethrow |

**Frame ordering (browser, `UIState==='match'`)**

```
main.js:1881  match.update(dt)              // GOAL branch: players frozen, Celebration.update (:474)
main.js:1882  if (active) GoalCinematic.update(dt)   // camera + scorer writes land LAST
              else camCtrl.update(...)               // unchanged today
main.js:1883+ HUD / Particles / arena / Living / render   // crowd cheer runs its own 2.8 s
```

**Fallback ladder (mandated)**

1. Never started (guards fail / headless / disabled) → byte-identical current flow.
2. `abort` mid-timeline → instant camera handback; Celebration + crowd + HUD continue; `stateT` restored → normal GOAL → KICKOFF exit.
3. `finish()` → smooth handback; `placeKickoff` rewrites all positions anyway (self-healing).
4. Any throw inside `update` → catch → abort; the frame loop never breaks.

**Window budget**: default cinematic ≤ 2.4 s fits `goalDelay 2.6 s`. Optional `extendGoalDelay` sets `match.stateT = max(stateT, dur + 0.2)` with the original saved/restored — only delays kickoff; clock (`tickTimer`, PLAY-only) and stats unaffected.

**Why not `match.js`**: the GOAL branch is already presentation-shaped (`Celebration` slot at `:474`), but putting the cinematic in the `main.js` loop keeps match logic untouched, makes pause-safety automatic (loop stops when `UIState !== 'match'`), and keeps the fallback branch trivially equal to today's code.

**Verification plan (build phase, not now)**: BOOT + menu flow green; SIM 203/0 unchanged (module excluded from sim SRC); RIGTEST / GLBPOSE / RIGPROBE unchanged; GOAL probe extended with `[CIN]` markers + pause-mid-goal + own-goal (`scorer=null`) + orientation-flip cases; draw-call delta ≈ 0; `reducedMotion` pass; camera hands back with no snap (follow seeded, pulses zeroed).

**Open design questions** (for implementation kickoff): camera language (orbit behind scorer / low angle at net / crowd two-shot), teammate mobbing (would require suppressing `resolvePlayerCollisions` for the window — **not recommended for v1**), whether to extend `goalDelay`, reduced-motion static alternative.
