import * as THREE from 'three';
import { mk, createEnvironment, createGun, createMachine, createMafiaPlayer } from './models.js';

/* ================================================================ config */
const GUN_X = 0, GUN_Z = 0.35;                       // gun pivot on the table
const RING_RX = 3.45, RING_RZ = 3.45, RING_CZ = 0.15; // seats follow the round table
const BASE_CAM = new THREE.Vector3(0.0, 2.05, 6.8);
const LOOK = new THREE.Vector3(0.0, 0.92, -0.45);
let camSpread = 3.0;

/* ================================================================ server state
   The server owns the game. This client only renders `S` and sends actions:
   join / addBot / removeBot / start / spin / stop / pick{i} / hover{i} / rematch   */
let S = { phase: 'LOBBY', players: [], active: -1, target: null, neighbors: null,
          host: -1, you: -1, finalTwo: false, winner: -1, timeLeft: null, maxLives: 3 };
let stateAt = performance.now();
let hoverLocal = null, hoverRemote = null;

const params = new URLSearchParams(location.search);
const quick = Number(params.get('quick')) || 0;      // ?quick=3 -> join, add 3 bots, start
let quickDone = false;

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
const send = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
ws.onopen = () => { if (quick) send({ t: 'join', name: params.get('name') || 'TESTER' }); };
ws.onclose = () => hold('DISCONNECTED FROM SERVER', 1e9);
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'state') applyState(m);
  else if (m.t === 'hover') hoverRemote = m.i;
  else if (m.t === 'ev') onEvent(m);
  else if (m.t === 'err') hold(m.msg, 2500);
};

/* ================================================================ scene */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x080709);
scene.fog = new THREE.FogExp2(0x080709, 0.035);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 100);
const baseCamPos = BASE_CAM.clone();
camera.position.copy(baseCamPos);
camera.lookAt(LOOK);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.style.filter = 'saturate(0.55) contrast(1.3) brightness(0.95)';
document.body.appendChild(renderer.domElement);

function updateResponsiveCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  camera.fov = aspect < 1 ? Math.min(84, 58 / Math.sqrt(aspect)) : 58;
  camera.updateProjectionMatrix();
  // pull back so every seat fits (portrait phones, many players)
  const dir = BASE_CAM.clone().sub(LOOK);
  const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
  const k = Math.max(1, (camSpread / tanH) / dir.length());
  baseCamPos.copy(LOOK).addScaledVector(dir, k);
  camera.position.copy(baseCamPos);
  camera.lookAt(LOOK);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
}
updateResponsiveCamera();
window.addEventListener('resize', updateResponsiveCamera);

const spot = new THREE.SpotLight(0xe8e2d2, 68, 18, Math.PI / 4.7, 0.34, 1.25);
spot.position.set(0.0, 5.8, 1.2);
spot.target.position.set(0, 0.2, -0.3);
spot.castShadow = true;
const rim = new THREE.PointLight(0x7a2a2e, 11, 14);
rim.position.set(0, 2.7, -3.6);
scene.add(new THREE.AmbientLight(0x211d20, 0.38), spot, spot.target, rim);

const bulbs = createEnvironment(scene);
const gun = createGun(scene);
let machine = null;
let players = [];

// shared confetti resources
const confettiGeo = new THREE.PlaneGeometry(0.09, 0.06);
const confettiMats = [0x9e1b24, 0x8f7a45, 0x3b8c5a, 0x3b6e6c, 0xc7c2b8]
  .map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
const confetti = [];

function clearSeats() {
  players.forEach(p => scene.remove(p.root));
  players = [];
  if (machine) { scene.remove(machine.root); machine = null; }
  camSpread = 3.0;
  updateResponsiveCamera();
}
function buildSeats(n) {
  clearSeats();
  const step = Math.min(34, 170 / Math.max(1, n - 1)) * Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const ang = (i - (n - 1) / 2) * step;
    const x = RING_RX * Math.sin(ang);
    const z = RING_CZ - RING_RZ * Math.cos(ang);
    const rotY = Math.atan2(GUN_X - x, GUN_Z - z);       // seat faces the gun
    const aim  = Math.atan2(x - GUN_X, z - GUN_Z);       // gun yaw that points at this seat
    const pl = createMafiaPlayer(scene, 'p' + i, 'PLAYER ' + (i + 1), x, 0.14, z, rotY, aim);
    pl.root.userData.idx = i;
    pl.armYaw = 0.63;                                    // arm swings toward the gun
    pl.deadAt = 0;
    players.push(pl);
  }
  machine = createMachine(scene, n);
  camSpread = RING_RX * Math.sin(step * (n - 1) / 2) + 1.0;
  updateResponsiveCamera();
}

/* ================================================================ HTML overlay */
document.body.insertAdjacentHTML('beforeend', `
  <div id="roster" style="position:fixed;top:10px;left:50%;transform:translateX(-50%);display:none;flex-wrap:wrap;justify-content:center;gap:6px;width:96%;z-index:10;pointer-events:none"></div>
  <div id="msg" style="position:fixed;top:58px;left:50%;transform:translateX(-50%);font-size:13px;color:#b89f65;text-align:center;width:92%;z-index:10;pointer-events:none"></div>
  <div id="ui" style="position:fixed;display:none;flex-direction:column;gap:6px;transform:translate(14px,-50%);z-index:10">
    <button id="bStart" disabled style="padding:8px 12px;background:#132419;border:2px solid #3b8c5a;color:#52b878;font-family:inherit;font-size:12px;font-weight:bold;opacity:0.4">START</button>
    <button id="bStop" disabled style="padding:8px 12px;background:#261012;border:2px solid #9e1b24;color:#c92a34;font-family:inherit;font-size:12px;font-weight:bold;opacity:0.4">STOP</button>
  </div>
  <div id="pick" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:11">
    <button id="bSelf" style="padding:10px 18px;background:#161518;border:2px solid #666;color:#ccc;font-family:inherit;font-size:13px;font-weight:bold">YOURSELF</button>
  </div>
  <div id="resetRow" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:11">
    <button id="bReset" style="padding:11px 16px;background:#161518;border:2px solid #666;color:#ccc;font-family:inherit;font-size:13px">NEW MATCH</button>
  </div>
  <div id="lobby" style="display:flex;position:fixed;inset:0;align-items:center;justify-content:center;z-index:20;background:rgba(0,0,0,0.6)">
    <div id="lobbyBox" style="min-width:260px;max-width:90%;background:#0b0a0c;border:2px solid #666;padding:16px;font-size:13px;color:#ccc;line-height:1.7"></div>
  </div>
`);
const rosterEl = document.getElementById('roster');
const msgEl    = document.getElementById('msg');
const uiEl     = document.getElementById('ui');
const bStart   = document.getElementById('bStart');
const bStop    = document.getElementById('bStop');
const pickEl   = document.getElementById('pick');
const bSelf    = document.getElementById('bSelf');
const resetRow = document.getElementById('resetRow');
const bReset   = document.getElementById('bReset');
const lobbyEl  = document.getElementById('lobby');
const lobbyBox = document.getElementById('lobbyBox');

function setControls(startOn, stopOn) {
  bStart.disabled = !startOn; bStart.style.opacity = startOn ? '1' : '0.4';
  bStop.disabled  = !stopOn;  bStop.style.opacity  = stopOn  ? '1' : '0.4';
}
bStart.onclick = () => send({ t: 'spin' });
bStop.onclick  = () => send({ t: 'stop' });
bReset.onclick = () => send({ t: 'rematch' });

let msgHold = { text: '', until: 0 };
function hold(text, ms) { msgHold = { text, until: performance.now() + ms }; }
let lastMsg = '';
function setMsg(text) { if (text !== lastMsg) { lastMsg = text; msgEl.textContent = text; } }

function renderRoster() {
  rosterEl.innerHTML = S.players.map((p, i) => {
    const active = i === S.active && S.phase !== 'GAME_OVER';
    const border = p.dead ? '#333' : (active ? '#d4be83' : '#9e1b24');
    const color  = p.dead ? '#555' : (active ? '#f2eadc' : '#c92a34');
    return `<div style="background:rgba(8,7,10,0.92);border:2px solid ${border};padding:4px 8px;font-size:11px;color:${color}">
      ${p.name}${i === S.you ? ' (YOU)' : ''}: <b>${p.dead ? 'OUT' : p.lives}</b></div>`;
  }).join('');
  msgEl.style.top = (rosterEl.offsetHeight + 16) + 'px';
}

/* ---------------------------------------------------------------- lobby */
let lobbySig = '';
function renderLobby() {
  const show = S.phase === 'LOBBY';
  lobbyEl.style.display = show ? 'flex' : 'none';
  if (!show) { lobbySig = ''; return; }
  const joined = S.you >= 0;
  const sig = joined ? 'J' + JSON.stringify(S.players.map(p => p.name + p.bot)) + S.host + S.you : 'F';
  if (sig === lobbySig) return;        // don't wipe the name box while typing
  lobbySig = sig;
  const btn = 'padding:8px 12px;background:#161518;border:2px solid #666;color:#ccc;font-family:inherit;font-size:12px;font-weight:bold;margin-right:6px';
  let h = '<div style="font-size:15px;letter-spacing:2px;margin-bottom:10px">ROULETTE TABLE</div>';
  if (!joined) {
    h += `<div style="margin-bottom:8px">ENTER A NAME</div>
      <input id="nameIn" maxlength="12" value="PLAYER" style="padding:8px;background:#161518;border:2px solid #666;color:#ccc;width:140px;margin-right:6px">
      <button data-act="join" style="${btn}">JOIN</button>`;
  } else {
    h += S.players.map((p, i) =>
      `<div>${i + 1}. ${p.name}${p.bot ? ' [BOT]' : ''}${i === S.host ? ' [HOST]' : ''}${i === S.you ? ' (YOU)' : ''}</div>`).join('');
    if (S.you === S.host) {
      h += `<div style="margin-top:12px">
        <button data-act="addBot" style="${btn}">ADD BOT</button>
        <button data-act="removeBot" style="${btn}">REMOVE BOT</button>
        <button data-act="start" style="${btn}" ${S.players.length < 2 ? 'disabled' : ''}>START</button></div>`;
    } else h += '<div style="margin-top:12px">WAITING FOR THE HOST...</div>';
    h += '<div style="margin-top:8px;font-size:11px;color:#888">2 TO 8 PLAYERS</div>';
  }
  lobbyBox.innerHTML = h;
}
lobbyBox.onclick = (e) => {
  const a = e.target.dataset && e.target.dataset.act;
  if (!a) return;
  if (a === 'join') send({ t: 'join', name: document.getElementById('nameIn').value });
  else send({ t: a });
};

/* ================================================================ server -> client */
function applyState(m) {
  const prev = S;
  S = m; stateAt = performance.now();
  if (prev.phase !== S.phase) hoverRemote = null;

  if (S.phase === 'LOBBY') { if (players.length) clearSeats(); }
  else if (!players.length || players.length !== S.players.length || prev.phase === 'LOBBY') buildSeats(S.players.length);

  S.players.forEach((sp, i) => {
    const p = players[i]; if (!p) return;
    const wasDead = p.isDead;
    p.name = sp.name; p.lives = sp.lives; p.isDead = sp.dead;
    p.head.visible = !sp.dead;
    if (sp.dead && !wasDead) p.deadAt = performance.now();
  });

  // visual-only: the cylinder coasts to a stop. Chambers look identical, so this reveals nothing.
  if (S.phase === 'SETTLING' && prev.phase !== 'SETTLING') {
    const base = Math.random() < 0.5 ? 0 : Math.PI;
    cylTarget = base + (Math.ceil((gun.cyl.rotation.z - base) / (Math.PI * 2)) + 2) * Math.PI * 2;
  }

  const me = S.you >= 0 && S.you === S.active;
  const inGame = S.phase !== 'LOBBY';
  setControls(S.phase === 'IDLE' && me, S.phase === 'SPINNING' && me);
  uiEl.style.display = inGame && S.phase !== 'GAME_OVER' ? 'flex' : 'none';
  pickEl.style.display = me && S.phase === 'SELECTING' ? 'block' : 'none';
  resetRow.style.display = S.phase === 'GAME_OVER' && S.you === S.host ? 'block' : 'none';
  rosterEl.style.display = inGame ? 'flex' : 'none';
  renderRoster();
  renderLobby();

  if (quick && !quickDone && S.phase === 'LOBBY' && S.you >= 0 && S.host === S.you) {
    quickDone = true;
    for (let i = 0; i < quick; i++) send({ t: 'addBot' });
    send({ t: 'start' });
  }
}

let lampOverride = 0, lampUntil = 0;
const lamp = (hex, ms) => { lampOverride = hex; lampUntil = performance.now() + ms; };
let shake = 0, finalFlash = 0, tAng = 0;

function burst(i) {
  const p = players[i]; if (!p) return;
  const pos = p.head.getWorldPosition(new THREE.Vector3());
  for (let k = 0; k < 100; k++) {
    const m = mk(confettiGeo, confettiMats[k % 5], pos.x, pos.y, pos.z, 0, 0, 0, false);
    scene.add(m);
    confetti.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5) });
  }
}
function onEvent(m) {
  const nm = (i) => (S.players[i] ? S.players[i].name : '?');
  const pullTrigger = () => { tAng = 0.45; setTimeout(() => { tAng = 0; }, 140); };
  if (m.e === 'blank') {
    pullTrigger(); lamp(0x3b6e6c, 1000);
    hold(m.target === m.by ? `*CLICK* — BLANK! ${nm(m.by)} GOES AGAIN` : `*CLICK* — BLANK! ${nm(m.target)} TAKES THE GUN`, 1600);
  } else if (m.e === 'shot') {
    pullTrigger(); shake = 0.24; gun.root.position.z = 0.20; lamp(0x9e1b24, 1100);
    if (m.dead) { burst(m.target); hold(`${nm(m.target)} ELIMINATED!`, 1700); }
    else hold(`BANG! ${nm(m.target)} DROPS TO ${m.lives} ${m.lives === 1 ? 'LIFE' : 'LIVES'}`, 1500);
  } else if (m.e === 'timeout') {
    burst(m.who); hold(`${nm(m.who)} DID NOT RESPOND — REMOVED`, 2200);
  } else if (m.e === 'sudden') {
    finalFlash = 1; shake = 0.35; hold('FINAL TWO — ALL LIVES = 1', 2400);
  } else if (m.e === 'start') {
    hold('MATCH STARTED — RANDOM SEATS, RANDOM FIRST HOLDER', 2000);
  }
}

function statusText() {
  const P = S.players, a = P[S.active];
  const me = S.you >= 0 && S.you === S.active;
  let t = '';
  switch (S.phase) {
    case 'IDLE':      t = me ? 'YOUR TURN — PRESS START' : `${a.name}'S TURN`; break;
    case 'SPINNING':  t = me ? 'SPINNING... PRESS STOP' : `${a.name} IS SPINNING...`; break;
    case 'SETTLING':  t = 'THE WHEEL SLOWS...'; break;
    case 'SELECTING': t = me ? 'WHO DO YOU SHOOT? CLICK A PLAYER OR YOURSELF' : `${a.name} IS CHOOSING A TARGET...`; break;
    case 'AIMING':    t = S.target === S.active ? `${a.name} AIMS AT THEMSELVES...` : `${a.name} AIMS AT ${P[S.target].name}...`; break;
    case 'NEIGHBOR': {
      const nb = S.neighbors;
      t = me ? `PASS THE GUN: LEFT = ${P[nb.left].name}, RIGHT = ${P[nb.right].name}` : `${a.name} CHOOSES WHO GETS THE GUN...`;
      break;
    }
    case 'GAME_OVER': t = S.winner >= 0 ? `${P[S.winner].name} WINS THE TABLE!` : 'NOBODY WINS'; break;
    default: t = '';
  }
  if (S.timeLeft !== null && ['IDLE', 'SPINNING', 'SELECTING', 'NEIGHBOR'].includes(S.phase)) {
    const left = Math.max(0, S.timeLeft - (performance.now() - stateAt));
    const s = Math.ceil(left / 1000);
    t += `  [${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}]`;
  }
  return t;
}

/* ================================================================ picking players in the 3D scene */
const mySelecting = () => S.you >= 0 && S.you === S.active && (S.phase === 'SELECTING' || S.phase === 'NEIGHBOR');
function allowed(i) {
  if (!S.players[i] || S.players[i].dead) return false;
  if (S.phase === 'NEIGHBOR') return !!S.neighbors && (i === S.neighbors.left || i === S.neighbors.right);
  return true;
}
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickPlayerAt(ev) {
  ndc.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(players.map(p => p.root), true);
  for (const h of hits) {
    let o = h.object;
    while (o && o.userData.idx === undefined) o = o.parent;
    if (o && allowed(o.userData.idx)) return o.userData.idx;
  }
  return null;
}
function setHover(i) {
  if (i === hoverLocal) return;
  hoverLocal = i;
  send({ t: 'hover', i });
}
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!mySelecting()) { hoverLocal = null; return; }
  const i = pickPlayerAt(e);
  setHover(i);
  renderer.domElement.style.cursor = i !== null ? 'pointer' : '';
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!mySelecting()) return;
  const i = pickPlayerAt(e);
  if (i !== null) { send({ t: 'pick', i }); setHover(null); }
});
renderer.domElement.addEventListener('pointerleave', () => { if (mySelecting()) setHover(null); });
bSelf.onpointerenter = () => { if (mySelecting()) setHover(S.active); };
bSelf.onpointerleave = () => { if (mySelecting()) setHover(null); };
bSelf.onclick = () => { if (mySelecting()) send({ t: 'pick', i: S.active }); };

/* ================================================================ animation */
let spd = 0, cylTarget = null, targetGunYaw = null;
function angleDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

// where the gun should point (null = just coast / hold)
function desiredYaw() {
  const aim = (i) => (players[i] ? players[i].aimAngle : null);
  switch (S.phase) {
    case 'IDLE':      return aim(S.active);
    case 'AIMING':
    case 'RESOLVING': return S.target !== null ? aim(S.target) : null;
    case 'GAME_OVER': return aim(S.winner);
    default:          return null;
  }
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const now = performance.now();
  const ph = S.phase;
  const spinning = ph === 'SPINNING';

  // primer (thumb lever): pulled while spinning; hammer cocked until the shot
  const lAng = spinning ? 0.55 : 0;
  const hAng = ['SPINNING', 'SETTLING', 'SELECTING', 'AIMING'].includes(ph) ? -0.58 : 0;
  gun.primer.rotation.x += (lAng - gun.primer.rotation.x) * 14 * dt;
  gun.hammer.rotation.x += (hAng - gun.hammer.rotation.x) * 18 * dt;
  gun.trigger.rotation.x += (tAng - gun.trigger.rotation.x) * 20 * dt;

  // players: arm pulls the primer, needle shows lives, glow shows hover / target
  const hi = mySelecting() ? hoverLocal : ((ph === 'SELECTING' || ph === 'NEIGHBOR') ? hoverRemote : null);
  players.forEach((p, i) => {
    const pulling = spinning && i === S.active;
    p.arm.rotation.x += ((pulling ? 0.4 : 0) - p.arm.rotation.x) * 10 * dt;
    p.arm.rotation.y += ((pulling ? p.armYaw : 0) - p.arm.rotation.y) * 10 * dt;

    let want = 0;
    if (!p.isDead) {
      if ((ph === 'AIMING' || ph === 'RESOLVING') && i === S.target) want = 1.3;
      else if (i === hi) want = 0.7;
      else if (ph === 'NEIGHBOR' && S.neighbors && (i === S.neighbors.left || i === S.neighbors.right)) want = 0.3;
    }
    p.glow.emissiveIntensity += (want - p.glow.emissiveIntensity) * 12 * dt;

    if (machine && machine.needles[i]) {
      const frac = p.isDead ? 0 : p.lives / S.maxLives;
      const jitter = frac > 0 && frac < 0.5 ? Math.sin(t * 40 + i) * 0.02 : 0;
      const n = machine.needles[i];
      n.rotation.z += ((-0.9 + (1 - frac) * 1.8 + jitter) - n.rotation.z) * 6 * dt;   // full = right, dead = left
    }
    if (p.isDead && p.deadAt && now - p.deadAt > 900) p.root.visible = false;        // removed from play
  });

  // gun spin
  if (ph === 'LOBBY') {
    gun.root.rotation.y += 0.2 * dt;
  } else if (spinning) {
    spd = Math.min(spd + 28 * dt, 18);
    gun.root.rotation.y += spd * dt;
    gun.cyl.rotation.z += spd * 2.4 * dt;
  } else {
    spd *= Math.pow(0.04, dt);
    if (spd < 0.05) {
      spd = 0;
      const ty = desiredYaw();
      if (ty !== null) gun.root.rotation.y += angleDiff(ty, gun.root.rotation.y) * 8 * dt;
    } else {
      gun.root.rotation.y += spd * dt;
    }
    if (cylTarget !== null) {
      gun.cyl.rotation.z += (cylTarget - gun.cyl.rotation.z) * Math.min(1, 4 * dt);
      if (Math.abs(cylTarget - gun.cyl.rotation.z) < 0.02) { gun.cyl.rotation.z = cylTarget; cylTarget = null; }
    } else if (spd > 0) {
      gun.cyl.rotation.z += spd * 2.4 * dt;
    }
  }
  gun.root.position.z += (GUN_Z - gun.root.position.z) * 10 * dt;

  // lights, status lamp
  spot.intensity = 68; // stable casino lighting; no gameplay-driven flicker
  let lampHex = (ph === 'IDLE' || ph === 'SPINNING') ? 0x3b8c5a : 0x8f7a45;
  if (now < lampUntil) lampHex = lampOverride;
  if (finalFlash > 0.01) {
    lampHex = Math.sin(t * 50) > 0 ? 0xff1e27 : 0x111111;
    rim.intensity = 22 + finalFlash * 45;
    finalFlash *= Math.pow(0.08, dt);
  } else rim.intensity = 22;
  if (machine) machine.screenMat.color.setHex(lampHex);

  if (shake > 0.001) {
    camera.position.set(
      baseCamPos.x + (Math.random() - 0.5) * shake,
      baseCamPos.y + (Math.random() - 0.5) * shake,
      baseCamPos.z + (Math.random() - 0.5) * shake
    );
    shake *= Math.pow(0.02, dt);
  } else camera.position.copy(baseCamPos);

  // Casino fixtures and room lighting stay fixed across turns and animations.

  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.v.y -= 7.8 * dt;
    c.m.position.addScaledVector(c.v, dt);
    c.m.rotation.x += 9 * dt; c.m.rotation.y += 9 * dt;
    if (c.m.position.y < -1) { scene.remove(c.m); confetti.splice(i, 1); }
  }

  // message line + 2D buttons follow the gun
  setMsg(now < msgHold.until ? msgHold.text : statusText());
  const ap = gun.root.getWorldPosition(new THREE.Vector3());
  ap.x += 1.0;
  const kp = ap.project(camera);
  uiEl.style.left = `${Math.max(10, Math.min(window.innerWidth - 90, (kp.x * 0.5 + 0.5) * window.innerWidth))}px`;
  uiEl.style.top  = `${Math.max(85, Math.min(window.innerHeight - 85, (-kp.y * 0.5 + 0.5) * window.innerHeight))}px`;

  renderer.render(scene, camera);
}
animate();
