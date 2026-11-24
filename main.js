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
   createParty / joinParty / leaveParty / addBot / removeBot / start / spin / stop / pick{i} / hover{i} / rematch */
let S = { phase: 'PARTIES', players: [], active: -1, target: null, neighbors: null,
          host: -1, you: -1, maxPlayers: 12, finalTwo: false, winner: -1, timeLeft: null, maxLives: 3 };
let stateAt = performance.now();
let hoverLocal = null, hoverRemote = null;
let parties = [], lobbyError = '';

const params = new URLSearchParams(location.search);
const quick = Number(params.get('quick')) || 0;      // ?quick=3 -> create a test party, add bots, start
let quickDone = false;

const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
const send = (o) => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(o));
    return true;
  }
  lobbyError = 'SERVER CONNECTION NOT READY — PLEASE WAIT OR RELOAD';
  const errorEl = document.getElementById('partyError');
  if (errorEl) errorEl.textContent = lobbyError;
  return false;
};
ws.onopen = () => {
  if (quick) send({ t: 'createParty', name: params.get('name') || 'TESTER', partyName: 'QUICK TEST', maxPlayers: 12 });
};
ws.onclose = () => {
  lobbyError = 'DISCONNECTED FROM SERVER';
  const errorEl = document.getElementById('partyError');
  if (errorEl) errorEl.textContent = lobbyError;
  hold(lobbyError, 1e9);
};
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.t === 'state') applyState(m);
  else if (m.t === 'parties') { parties = m.parties; renderPartyList(); }
  else if (m.t === 'hover') hoverRemote = m.i;
  else if (m.t === 'ev') onEvent(m);
  else if (m.t === 'err') {
    lobbyError = m.msg;
    const errorEl = document.getElementById('partyError');
    if (errorEl) errorEl.textContent = lobbyError;
    hold(m.msg, 2500);
  }
};

/* ================================================================ scene */
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050506);
scene.fog = new THREE.FogExp2(0x050506, 0.038);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 100);
const baseCamPos = BASE_CAM.clone();
camera.position.copy(baseCamPos);
camera.lookAt(LOOK);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.domElement.style.filter = 'grayscale(0.12) saturate(0.72) contrast(1.68) brightness(0.82)';
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

const spot = new THREE.SpotLight(0xf1eadc, 68, 18, Math.PI / 4.7, 0.28, 1.25);
spot.position.set(0.0, 5.8, 1.2);
spot.target.position.set(0, 0.2, -0.3);
spot.castShadow = true;
const rim = new THREE.PointLight(0xa20d12, 16, 14);
rim.position.set(0, 2.7, -3.6);
scene.add(new THREE.AmbientLight(0x211d20, 0.38), spot, spot.target, rim);

createEnvironment(scene);
const gun = createGun(scene);
let machine = null;
let players = [];

// shared confetti resources
const confettiGeo = new THREE.PlaneGeometry(0.09, 0.06);
const confettiMats = [0xb20d18, 0xd9d4c8, 0x5b0b10, 0x24262a, 0xeee7d5]
  .map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
const confetti = [];

function clearSeats() {
  const disposeObject = (root) => {
    const geometries = new Set();
    const materials = new Set();
    root.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
        }
      }
    });
    scene.remove(root);
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
  };
  players.forEach(p => disposeObject(p.root));
  players = [];
  if (machine) { disposeObject(machine.root); machine = null; }
  camSpread = 3.0;
  updateResponsiveCamera();
}
function buildSeats(n) {
  clearSeats();
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const x = RING_RX * Math.sin(ang);
    const z = RING_CZ - RING_RZ * Math.cos(ang);
    const rotY = Math.atan2(GUN_X - x, GUN_Z - z);       // seat faces the gun
    const pl = createMafiaPlayer(scene, x, 0.14, z, rotY);
    pl.root.userData.idx = i;
    pl.deadAt = 0;
    players.push(pl);
  }
  machine = createMachine(scene, n);
  camSpread = RING_RX + 1.0;
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
    <div id="targetChoices" aria-label="Choose a player"></div>
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
const targetChoices = document.getElementById('targetChoices');
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
let partyScreen = 'parties';
let playerNameDraft = 'PLAYER';
let partyNameDraft = 'MY PARTY';
let partyMaxDraft = 12;
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

function renderPartyList() {
  const listEl = document.getElementById('partyEntries');
  if (!listEl) return;
  listEl.innerHTML = parties.length ? parties.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid #333">
      <div><b>${escapeHtml(p.name)}</b><div style="font-size:11px;color:#888">LEADER: ${escapeHtml(p.host)} · ${p.count}/${p.maxPlayers} PLAYERS</div></div>
      <button data-party="${escapeHtml(p.id)}" style="padding:7px 10px;background:#161518;border:2px solid #666;color:#ccc;font-family:inherit;font-weight:bold" ${p.count >= p.maxPlayers ? 'disabled' : ''}>JOIN</button>
    </div>`).join('') : '<div style="padding:12px 0;color:#888">NO OPEN PARTIES — CREATE ONE TO GET STARTED</div>';
}

function renderLobby() {
  const show = S.phase === 'PARTIES' || S.phase === 'LOBBY';
  lobbyEl.style.display = show ? 'flex' : 'none';
  if (!show) { lobbySig = ''; return; }
  const inParty = S.phase === 'LOBBY' && S.you >= 0;
  const sig = inParty
    ? 'J' + S.roomName + JSON.stringify(S.players.map(p => p.name + p.bot)) + S.host + S.you
    : S.phase + partyScreen;
  if (sig === lobbySig) return;        // don't wipe the name box while typing
  lobbySig = sig;
  const btn = 'padding:8px 12px;background:#161518;border:2px solid #666;color:#ccc;font-family:inherit;font-size:12px;font-weight:bold;margin-right:6px';
  const exitBtn = 'position:fixed;right:20px;bottom:20px;padding:12px 18px;background:#063514;border:3px solid #38df69;color:#c7ffd4;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:2px;text-shadow:0 0 8px #55ff7a;box-shadow:0 0 14px rgba(48,220,95,.45);cursor:pointer';
  let h = '<div style="font-size:15px;letter-spacing:2px;margin-bottom:10px">ROULETTE PARTIES</div>';
  if (S.phase === 'PARTIES') {
    if (partyScreen === 'make') {
      h = '<div style="font-size:15px;letter-spacing:2px;margin-bottom:10px">MAKE A PARTY</div>';
      h += `<div style="margin-bottom:12px">CREATE A PARTY FOR OTHERS TO JOIN</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label>YOUR NAME<input id="nameIn" maxlength="12" value="${escapeHtml(playerNameDraft)}" style="display:block;padding:8px;background:#161518;border:2px solid #666;color:#ccc;width:210px;margin-top:4px"></label>
          <label>PARTY NAME<input id="partyNameIn" maxlength="20" value="${escapeHtml(partyNameDraft)}" style="display:block;padding:8px;background:#161518;border:2px solid #666;color:#ccc;width:210px;margin-top:4px"></label>
          <label>PARTY SIZE (3-12)
            <select id="partyMaxIn" style="display:block;padding:8px;background:#161518;border:2px solid #666;color:#ccc;width:226px;margin-top:4px">
              ${Array.from({ length: 10 }, (_, i) => i + 3).map(n => `<option value="${n}"${n === partyMaxDraft ? ' selected' : ''}>${n} PLAYERS</option>`).join('')}
            </select>
          </label>
          <button data-act="createParty" style="${btn};width:max-content">CREATE PARTY</button>
        </div>
        <div id="partyError" style="min-height:18px;color:#d36b70;font-size:11px">${escapeHtml(lobbyError)}</div>
        <button data-act="exitMake" style="${exitBtn}">EXIT</button>`;
    } else {
      h += `<div style="margin-bottom:12px">CHOOSE AN OPEN PARTY OR MAKE YOUR OWN</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px">
          <input id="nameIn" maxlength="12" value="${escapeHtml(playerNameDraft)}" placeholder="PLAYER NAME" style="padding:8px;background:#161518;border:2px solid #666;color:#ccc;width:150px">
          <button data-act="showMake" style="${btn}">MAKE PARTY</button>
        </div>
        <div id="partyError" style="min-height:18px;color:#d36b70;font-size:11px">${escapeHtml(lobbyError)}</div>
        <div style="margin:12px 0 4px;border-top:1px solid #444;padding-top:8px">OPEN PARTIES</div>
        <div id="partyEntries" style="max-height:42vh;overflow:auto;min-width:280px"></div>`;
    }
  } else {
    h = `<div style="font-size:15px;letter-spacing:2px;margin-bottom:4px">${escapeHtml(S.roomName || 'PARTY')}</div>
      <div style="font-size:11px;color:#888;margin-bottom:10px">PARTY LEADER STARTS THE MATCH</div>`;
    h += S.players.map((p, i) =>
      `<div>${i + 1}. ${escapeHtml(p.name)}${p.bot ? ' [BOT]' : ''}${i === S.host ? ' [LEADER]' : ''}${i === S.you ? ' (YOU)' : ''}</div>`).join('');
    if (S.you === S.host) {
      h += `<div style="margin-top:12px">
        <button data-act="addBot" style="${btn}" ${S.players.length >= S.maxPlayers ? 'disabled' : ''}>ADD BOT</button>
        <button data-act="removeBot" style="${btn}">REMOVE BOT</button>
        <button data-act="start" style="${btn}" ${S.players.length < 3 ? 'disabled' : ''}>START</button></div>`;
    } else h += '<div style="margin-top:12px">WAITING FOR THE PARTY LEADER...</div>';
    h += `<div style="margin-top:8px;font-size:11px;color:#888">MIN. 3 · MAX. ${S.maxPlayers} · ${S.players.length} IN PARTY</div>`;
    h += `<div id="partyError" style="min-height:18px;color:#d36b70;font-size:11px">${escapeHtml(lobbyError)}</div>
      <button data-act="leaveParty" style="${exitBtn}">EXIT</button>`;
  }
  lobbyBox.innerHTML = h;
  if (S.phase === 'PARTIES' && partyScreen === 'parties') renderPartyList();
}
lobbyBox.onclick = (e) => {
  const action = e.target.dataset && e.target.dataset.act;
  const partyId = e.target.dataset && e.target.dataset.party;
  if (action === 'showMake' || action === 'exitMake') {
    partyScreen = action === 'showMake' ? 'make' : 'parties';
    lobbySig = '';
    renderLobby();
    return;
  }
  if (action === 'createParty') {
    lobbyError = '';
    const nameIn = document.getElementById('nameIn');
    const partyNameIn = document.getElementById('partyNameIn');
    const partyMaxIn = document.getElementById('partyMaxIn');
    if (!nameIn || !partyNameIn || !partyMaxIn) return;
    send({
      t: 'createParty',
      name: nameIn.value,
      partyName: partyNameIn.value,
      maxPlayers: Number(partyMaxIn.value)
    });
    return;
  }
  if (partyId) {
    lobbyError = '';
    send({ t: 'joinParty', id: partyId, name: document.getElementById('nameIn').value });
    return;
  }
  if (action === 'leaveParty') {
    lobbyError = '';
    partyScreen = 'parties';
    lobbySig = '';
    send({ t: action });
  } else if (action) send({ t: action });
};
lobbyBox.oninput = (e) => {
  if (e.target.id === 'nameIn') playerNameDraft = e.target.value;
  if (e.target.id === 'partyNameIn') partyNameDraft = e.target.value;
};
lobbyBox.onchange = (e) => {
  if (e.target.id === 'partyMaxIn') partyMaxDraft = Number(e.target.value);
};

/* ================================================================ server -> client */
function applyState(m) {
  const prev = S;
  S = m; stateAt = performance.now();
  if (prev.phase !== S.phase) hoverRemote = null;

  if (S.phase === 'LOBBY' || S.phase === 'PARTIES') { if (players.length) clearSeats(); }
  else if (!players.length || players.length !== S.players.length || prev.phase === 'LOBBY') buildSeats(S.players.length);

  S.players.forEach((sp, i) => {
    const p = players[i]; if (!p) return;
    const wasDead = p.isDead;
    p.lives = sp.lives; p.isDead = sp.dead;
    p.head.visible = !sp.dead;
    if (sp.dead && !wasDead) p.deadAt = performance.now();
  });

  // visual-only: the cylinder coasts to a stop. Chambers look identical, so this reveals nothing.
  if (S.phase === 'SETTLING' && prev.phase !== 'SETTLING') {
    const base = Math.random() < 0.5 ? 0 : Math.PI;
    cylTarget = base + (Math.ceil((gun.cyl.rotation.z - base) / (Math.PI * 2)) + 2) * Math.PI * 2;
  }

  const me = S.you >= 0 && S.you === S.active;
  const inGame = S.phase !== 'LOBBY' && S.phase !== 'PARTIES';
  setControls(S.phase === 'IDLE' && me, S.phase === 'SPINNING' && me);
  uiEl.style.display = inGame && S.phase !== 'GAME_OVER' ? 'flex' : 'none';
  const canSelect = me && S.phase === 'SELECTING';
  const canPassOnTouch = me && touchUi && S.phase === 'NEIGHBOR';
  pickEl.style.display = canSelect ? (touchUi ? 'flex' : 'block') : (canPassOnTouch ? 'flex' : 'none');
  renderPickChoices();
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
    pullTrigger(); shake = 0.24; gunKick = 0.20; lamp(0x9e1b24, 1100);
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
const touchUi = window.matchMedia('(pointer: coarse)').matches;
function renderPickChoices() {
  const choosing = mySelecting();
  const showChoices = touchUi && choosing;
  bSelf.style.display = S.phase === 'SELECTING' ? '' : 'none';
  targetChoices.replaceChildren();
  targetChoices.style.display = showChoices ? 'flex' : 'none';
  if (!showChoices) return;

  const indexes = S.phase === 'NEIGHBOR'
    ? [S.neighbors.left, S.neighbors.right]
    : S.players.map((_, i) => i).filter(i => i !== S.active && !S.players[i].dead);
  for (const i of indexes) {
    const player = S.players[i];
    if (!player || player.dead) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${S.phase === 'NEIGHBOR' ? 'PASS' : 'SHOOT'} ${player.name}`;
    button.setAttribute('aria-label', `${S.phase === 'NEIGHBOR' ? 'Pass the gun to' : 'Shoot'} ${player.name}`);
    button.style.cssText = 'padding:10px 12px;background:#161518;border:2px solid #666;color:#ccc;font-family:inherit;font-size:12px;font-weight:bold';
    button.onclick = () => { if (mySelecting()) { send({ t: 'pick', i }); setHover(null); } };
    targetChoices.append(button);
  }
}
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
let spd = 0, cylTarget = null, gunKick = 0;
function angleDiff(a, b) { return Math.atan2(Math.sin(a - b), Math.cos(a - b)); }

const clock = new THREE.Clock();
const aimPoint = new THREE.Vector3();
const handPosition = new THREE.Vector3();
const uiAnchor = new THREE.Vector3();
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

  // The active player holds the revolver and tracks the selected or hovered target.
  const hi = mySelecting() ? hoverLocal : ((ph === 'SELECTING' || ph === 'NEIGHBOR') ? hoverRemote : null);
  let aimIndex = null;
  if (ph === 'AIMING' || ph === 'RESOLVING') aimIndex = S.target;
  else if (ph === 'SELECTING' || ph === 'NEIGHBOR') aimIndex = hi;
  else if (ph === 'GAME_OVER') aimIndex = S.winner;
  aimPoint.set(0, 0.4, 0);
  if (aimIndex !== null && players[aimIndex]) players[aimIndex].head.getWorldPosition(aimPoint);

  players.forEach((p, i) => {
    if (!p.isDead) {
      const pulling = spinning && i === S.active;
      const holding = i === S.active && ph !== 'LOBBY';
      const armYaw = Math.atan2(aimPoint.x - p.root.position.x, aimPoint.z - p.root.position.z);
      p.arm.rotation.x += (((pulling || holding) ? 0.4 : 0) - p.arm.rotation.x) * 10 * dt;
      p.arm.rotation.y += ((holding ? angleDiff(armYaw, p.root.rotation.y) : 0) - p.arm.rotation.y) * 10 * dt;
    } else if (p.deadAt) {
      const fall = Math.min(1, (now - p.deadAt) / 700);
      const easedFall = fall * fall * (3 - 2 * fall);
      p.body.rotation.x = -0.95 * easedFall;
      p.body.rotation.z = (i % 2 ? 0.12 : -0.12) * easedFall;
      p.body.position.z = -0.08 * easedFall;
    }

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
  });

  // Only the cylinder spins; the revolver stays in its holder's hand.
  if (spinning) {
    spd = Math.min(spd + 28 * dt, 18);
    gun.cyl.rotation.z += spd * 2.4 * dt;
  } else {
    spd *= Math.pow(0.04, dt);
    if (cylTarget !== null) {
      gun.cyl.rotation.z += (cylTarget - gun.cyl.rotation.z) * Math.min(1, 4 * dt);
      if (Math.abs(cylTarget - gun.cyl.rotation.z) < 0.02) { gun.cyl.rotation.z = cylTarget; cylTarget = null; }
    } else if (spd > 0) {
      gun.cyl.rotation.z += spd * 2.4 * dt;
    }
  }
  const holder = players[S.active];
  if (holder) {
    holder.hand.getWorldPosition(handPosition);
    const yaw = Math.atan2(aimPoint.x - handPosition.x, aimPoint.z - handPosition.z);
    gun.root.rotation.y += angleDiff(yaw, gun.root.rotation.y) * 8 * dt;
    gun.root.position.copy(handPosition);
    gun.root.position.y += 0.37;
    gunKick *= Math.pow(0.02, dt);
    gun.root.position.z += gunKick;
  } else {
    gun.root.position.set(GUN_X, 0.62, GUN_Z);
    gunKick = 0;
  }

  // lights, status lamp
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
  gun.root.getWorldPosition(uiAnchor);
  uiAnchor.x += 1.0;
  const kp = uiAnchor.project(camera);
  uiEl.style.left = `${Math.max(10, Math.min(window.innerWidth - 90, (kp.x * 0.5 + 0.5) * window.innerWidth))}px`;
  uiEl.style.top  = `${Math.max(85, Math.min(window.innerHeight - 85, (-kp.y * 0.5 + 0.5) * window.innerHeight))}px`;

  renderer.render(scene, camera);
}
animate();
