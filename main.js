import * as THREE from 'three';
import { mk, preloadBlockbenchAssets, createEnvironment, createGun, createMachine, createMafiaPlayer, PLAYER_SCALE } from './models.js';

await preloadBlockbenchAssets();

/* ================================================================ config */
const GUN_X = 0, GUN_Z = 0.35;                       // gun pivot on the table
const RING_RX = 3.45, RING_RZ = 3.45, RING_CZ = 0.15; // seats follow the round table
const BASE_CAM = new THREE.Vector3(0.0, 2.05, 6.8);
const LOOK = new THREE.Vector3(0.0, 0.92, -0.45);
let camSpread = 3.0;
let machines = [];
let players = [];

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
scene.background = new THREE.Color(0x09090b);
scene.fog = new THREE.FogExp2(0x160d14, 0.026);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 100);
const baseCamPos = BASE_CAM.clone();
let cameraRoll = 0;
camera.position.copy(baseCamPos);
camera.lookAt(LOOK);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.34;
document.body.appendChild(renderer.domElement);

function updateResponsiveCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const viewer = S.you >= 0 ? players[S.you] : null;
  camera.aspect = aspect;
  camera.fov = aspect < 1
    ? Math.min(viewer ? 96 : 84, (viewer ? 72 : 58) / Math.sqrt(aspect))
    : viewer ? 72 : 58;
  camera.updateProjectionMatrix();
  if (viewer) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(viewer.root.quaternion);
    baseCamPos.copy(viewer.root.position).addScaledVector(forward, 0.12);
    baseCamPos.y = viewer.root.position.y + 1.56 * PLAYER_SCALE;
  } else {
    // Keep the room overview while the player is in the party screens.
    const dir = BASE_CAM.clone().sub(LOOK);
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
    const k = Math.max(1, (camSpread / tanH) / dir.length());
    baseCamPos.copy(LOOK).addScaledVector(dir, k);
  }
  camera.position.copy(baseCamPos);
  if (viewer) camera.lookAt(GUN_X, viewer.root.position.y + 0.78 * PLAYER_SCALE, GUN_Z);
  else camera.lookAt(LOOK);
  cameraRoll = 0;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
}
updateResponsiveCamera();
window.addEventListener('resize', updateResponsiveCamera);

const spot = new THREE.SpotLight(0xffd27a, 360, 20, Math.PI / 5, 0.2, 1.05);
spot.position.set(0.0, 6.2, 1.2);
spot.target.position.set(0, 0.2, -0.3);
spot.castShadow = true;
const rim = new THREE.PointLight(0xb20d25, 52, 15, 1.8);
rim.position.set(0, 2.7, -6.2);
const warmFill = new THREE.PointLight(0xffca70, 24, 11, 1.8);
warmFill.position.set(4.8, 3.2, 1.4);
scene.add(
  new THREE.HemisphereLight(0x9ba5b3, 0x171014, 0.32),
  spot, spot.target, rim, warmFill
);

const environment = createEnvironment(scene);
const sign = environment.getObjectByName('Fortuna Sign');
const lettering = sign?.getObjectByName('FORTUNA lettering');
if (!sign || !lettering?.isMesh) throw new Error('Casino environment is missing its Fortuna marquee');
lettering.material.emissive.setHex(0xffbd36);
lettering.material.emissiveIntensity = 2.4;
const gun = createGun(scene);

// shared confetti resources
const confettiGeo = new THREE.PlaneGeometry(0.09, 0.06);
const confettiMats = [0xb20d18, 0xd9d4c8, 0x5b0b10, 0x24262a, 0xeee7d5]
  .map(c => new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
const confetti = [];

function clearSeats() {
  const disposeObject = (root) => {
    const materials = new Set();
    root.traverse(object => {
      if (object.material) {
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
        }
      }
    });
    scene.remove(root);
    materials.forEach(material => material.dispose());
  };
  players.forEach(p => disposeObject(p.root));
  players = [];
  machines.forEach(machine => disposeObject(machine.root));
  machines = [];
  camSpread = 3.0;
  updateResponsiveCamera();
}
function buildSeats(n) {
  clearSeats();
  const seatWidth = (18 / 16) * PLAYER_SCALE * 1.08;
  const ringRadius = Math.max(RING_RX, seatWidth / (2 * Math.sin(Math.PI / n)));
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const x = ringRadius * Math.sin(ang);
    const z = RING_CZ - ringRadius * Math.cos(ang);
    const rotY = Math.atan2(GUN_X - x, GUN_Z - z);       // seat faces the gun
    const pl = createMafiaPlayer(scene, x, 0.14, z, rotY, i);
    pl.root.userData.idx = i;
    pl.deadAt = 0;
    players.push(pl);
  }
  const clockRadius = Math.max(2.75, (86 / 16 * 0.5 * 1.08) / (2 * Math.sin(Math.PI / n)));
  machines = players.map(player => {
    const machine = createMachine(scene);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(player.root.quaternion);
    machine.root.position.copy(player.root.position)
      .addScaledVector(forward, ringRadius - clockRadius);
    machine.root.position.y = 0.29;
    machine.root.rotation.y = player.root.rotation.y;
    machine.root.scale.multiplyScalar(0.5);
    return machine;
  });
  camSpread = ringRadius + 1.0;
  updateResponsiveCamera();
}

/* ================================================================ HTML overlay */
document.body.insertAdjacentHTML('beforeend', `
  <div id="msg" style="position:fixed;top:58px;left:50%;transform:translateX(-50%);font-size:15px;font-weight:bold;letter-spacing:2px;color:#ffe0a0;text-shadow:0 0 12px rgba(255,183,55,.8),0 2px 4px #000;text-align:center;width:92%;z-index:10;pointer-events:none"></div>
  <div id="ui" style="position:fixed;display:none;flex-direction:column;gap:6px;transform:translate(14px,-50%);z-index:10">
      <button id="bStart" disabled style="padding:10px 16px;background:#3b2509;border:2px solid #e6b84a;color:#ffe09a;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:2px;text-shadow:0 0 8px #d59128;box-shadow:0 0 14px rgba(230,184,74,.32);opacity:0.4">START</button>
      <button id="bStop" disabled style="padding:10px 16px;background:#3a080e;border:2px solid #e03b48;color:#ff9a8f;font-family:inherit;font-size:13px;font-weight:bold;letter-spacing:2px;text-shadow:0 0 8px #ee2638;box-shadow:0 0 14px rgba(224,59,72,.3);opacity:0.4">STOP</button>
  </div>
  <div id="pick" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:11">
    <button id="bSelf" style="padding:10px 18px;background:#161518;border:2px solid #9e1b24;color:#ddd4c2;font-family:inherit;font-size:13px;font-weight:bold">SHOOT YOURSELF</button>
  </div>
  <div id="resetRow" style="display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:11">
    <button id="bReset" style="padding:11px 16px;background:#161518;border:2px solid #666;color:#ccc;font-family:inherit;font-size:13px">NEW MATCH</button>
  </div>
  <button id="soundToggle" type="button" aria-label="Mute game sounds" aria-pressed="false"
    style="position:fixed;top:12px;right:12px;z-index:21;padding:8px 11px;background:rgba(12,11,12,.92);border:1px solid #8a7b5d;color:#ddd4c2;font:12px Georgia,serif;letter-spacing:1px">SOUND: ON</button>
  <div id="lobby" style="display:flex;position:fixed;inset:0;align-items:center;justify-content:center;z-index:20;background:rgba(2,2,3,.72)">
    <div id="lobbyBox" style="min-width:260px;max-width:90%;background:#0b0a0c;border:2px solid #8a7b5d;padding:18px;font-size:13px;color:#ddd4c2;line-height:1.7"></div>
  </div>
`);
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
const soundToggle = document.getElementById('soundToggle');

let audioContext = null;
let noiseBuffer = null;
let soundsMuted = false;
let spinSoundTimer = null;

function unlockAudio() {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  if (!audioContext) {
    audioContext = new AudioContextClass();
    noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(error => console.warn('Unable to start game audio:', error));
  }
}
document.addEventListener('pointerdown', unlockAudio, { once: true });

function playTone(frequency, duration, type = 'sine', volume = 0.12, endFrequency = frequency) {
  if (soundsMuted || !audioContext || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), now + duration);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration);
}

function playNoise(duration, volume, filterType, frequency) {
  if (soundsMuted || !audioContext || !noiseBuffer || audioContext.state !== 'running') return;
  const now = audioContext.currentTime;
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  source.buffer = noiseBuffer;
  filter.type = filterType;
  filter.frequency.setValueAtTime(frequency, now);
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audioContext.destination);
  source.start(now);
  source.stop(now + duration);
}

function playDryClick() {
  playNoise(.045, .18, 'highpass', 1000);
  playTone(780, .035, 'square', .045, 360);
}
function playGunshot() {
  playNoise(.28, .42, 'lowpass', 1900);
  playTone(92, .24, 'triangle', .34, 38);
  playTone(510, .055, 'square', .08, 180);
}
function stopSpinSound() {
  if (spinSoundTimer !== null) clearInterval(spinSoundTimer);
  spinSoundTimer = null;
}
function startSpinSound() {
  stopSpinSound();
  spinSoundTimer = setInterval(() => {
    playNoise(.035, .09, 'highpass', 1800 + Math.random() * 1200);
    playTone(240 + Math.random() * 180, .025, 'square', .025, 120);
  }, 115);
}
function playCockingSound() {
  playNoise(.075, .12, 'bandpass', 1350);
  playTone(250, .09, 'square', .055, 180);
}
function playSpinStop() {
  stopSpinSound();
  for (let i = 0; i < 4; i++) {
    setTimeout(() => {
      playNoise(.055, .15, 'bandpass', 900 + i * 350);
      playTone(430 - i * 65, .075, 'triangle', .07, 170);
    }, i * 85);
  }
}
function playStartCue() {
  playNoise(.12, .12, 'highpass', 2400);
  playTone(190, .22, 'triangle', .15, 95);
  setTimeout(() => playTone(420, .3, 'sine', .09, 620), 150);
}

soundToggle.onclick = () => {
  soundsMuted = !soundsMuted;
  soundToggle.textContent = soundsMuted ? 'SOUND: OFF' : 'SOUND: ON';
  soundToggle.setAttribute('aria-label', soundsMuted ? 'Enable game sounds' : 'Mute game sounds');
  soundToggle.setAttribute('aria-pressed', String(soundsMuted));
  if (soundsMuted) stopSpinSound();
  else {
    unlockAudio();
    if (S.phase === 'SPINNING') startSpinSound();
  }
};

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
  if (prev.phase !== S.phase) {
    hoverRemote = null;
    if (S.phase === 'SPINNING') startSpinSound();
    else if (prev.phase === 'SPINNING' && S.phase === 'SETTLING') playSpinStop();
    else stopSpinSound();
    if (S.phase === 'AIMING') playCockingSound();
  }

  if (S.phase === 'LOBBY' || S.phase === 'PARTIES') { if (players.length) clearSeats(); }
  else if (!players.length || players.length !== S.players.length || prev.phase === 'LOBBY') buildSeats(S.players.length);

  S.players.forEach((sp, i) => {
    const p = players[i]; if (!p) return;
    const wasDead = p.isDead;
    p.lives = sp.lives; p.isDead = sp.dead;
    p.head.visible = !sp.dead && i !== S.you;
    p.firstPersonParts.forEach(part => { part.visible = i !== S.you; });
    if (sp.dead && !wasDead) p.deadAt = performance.now();
  });

  const me = S.you >= 0 && S.you === S.active;
  const inGame = S.phase !== 'LOBBY' && S.phase !== 'PARTIES';
  setControls(S.phase === 'IDLE' && me, S.phase === 'SPINNING' && me);
  uiEl.style.display = inGame && S.phase !== 'GAME_OVER' ? 'flex' : 'none';
  const canSelect = me && S.phase === 'SELECTING';
  const canPassOnTouch = me && touchUi && S.phase === 'NEIGHBOR';
  pickEl.style.display = canSelect || canPassOnTouch ? 'flex' : 'none';
  renderSelfChoice();
  resetRow.style.display = S.phase === 'GAME_OVER' && S.you === S.host ? 'block' : 'none';
  renderLobby();

  if (quick && !quickDone && S.phase === 'LOBBY' && S.you >= 0 && S.host === S.you) {
    quickDone = true;
    for (let i = 0; i < quick; i++) send({ t: 'addBot' });
    send({ t: 'start' });
  }
}

let lampOverride = 0, lampUntil = 0;
const lamp = (hex, ms) => { lampOverride = hex; lampUntil = performance.now() + ms; };
let shake = 0, finalFlash = 0, casinoSurge = 0;

function burst(i) {
  const p = players[i]; if (!p) return;
  const pos = p.head.getWorldPosition(new THREE.Vector3());
  for (let k = 0; k < 40; k++) {
    const m = mk(confettiGeo, confettiMats[k % 5], pos.x, pos.y, pos.z, 0, 0, 0, false);
    scene.add(m);
    confetti.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 5, 2 + Math.random() * 4, (Math.random() - 0.5) * 5) });
  }
}
function onEvent(m) {
  const nm = (i) => (S.players[i] ? S.players[i].name : '?');
  if (m.e === 'blank') {
    casinoSurge = Math.max(casinoSurge, 0.35);
    playDryClick();
    lamp(0x3b6e6c, 1000);
    hold(m.target === m.by ? `*CLICK* — BLANK! ${nm(m.by)} GOES AGAIN` : `*CLICK* — BLANK! ${nm(m.target)} TAKES THE GUN`, 1600);
  } else if (m.e === 'shot') {
    casinoSurge = Math.max(casinoSurge, 0.9);
    playGunshot();
    if (Number.isInteger(m.lives) && players[m.target]) {
      players[m.target].lives = m.lives;
      machines[m.target]?.needles.forEach((needle, index) => { needle.visible = index < m.lives; });
    }
    if (!m.dead && players[m.target]) players[m.target].hitAt = performance.now();
    shake = 0.24; gunKick = 0.08; lamp(0x9e1b24, 1100);
    if (m.dead) { burst(m.target); hold(`${nm(m.target)} ELIMINATED!`, 1700); }
    else hold(`BANG! ${nm(m.target)} DROPS TO ${m.lives} ${m.lives === 1 ? 'LIFE' : 'LIVES'}`, 1500);
  } else if (m.e === 'timeout') {
    playTone(115, .35, 'triangle', .18, 45);
    burst(m.who); hold(`${nm(m.who)} DID NOT RESPOND — REMOVED`, 2200);
  } else if (m.e === 'sudden') {
    casinoSurge = 1.4;
    playTone(260, .55, 'sawtooth', .12, 70);
    setTimeout(() => playTone(520, .32, 'sine', .09, 330), 180);
    finalFlash = 1; shake = 0.35; hold('FINAL TWO — ALL LIVES = 1', 2400);
  } else if (m.e === 'start') {
    casinoSurge = 1;
    playStartCue();
    hold('MATCH STARTED — RANDOM SEATS, RANDOM FIRST HOLDER', 2000);
  }
}

function statusText() {
  const P = S.players, a = P[S.active];
  const me = S.you >= 0 && S.you === S.active;
  let t = '';
  switch (S.phase) {
    case 'IDLE':      t = me ? 'YOUR TURN — PRESS START' : `${a?.name || 'PLAYER'}'S TURN`; break;
    case 'SPINNING':  t = me ? 'SPINNING... PRESS STOP' : `${a?.name || 'PLAYER'} IS SPINNING...`; break;
    case 'SETTLING':  t = 'THE WHEEL SLOWS...'; break;
    case 'SELECTING': t = me ? 'WHO DO YOU SHOOT? CLICK A PLAYER OR YOURSELF' : `${a?.name || 'PLAYER'} IS CHOOSING A TARGET...`; break;
    case 'AIMING':    t = S.target === S.active ? `${a?.name || 'PLAYER'} AIMS AT THEMSELVES...` : `${a?.name || 'PLAYER'} AIMS AT ${P[S.target]?.name || 'PLAYER'}...`; break;
    case 'NEIGHBOR': {
      const nb = S.neighbors;
      t = me
        ? `PASS THE GUN: LEFT = ${P[nb?.left]?.name || 'PLAYER'}, RIGHT = ${P[nb?.right]?.name || 'PLAYER'}`
        : `${a?.name || 'PLAYER'} CHOOSES WHO GETS THE GUN...`;
      break;
    }
    case 'GAME_OVER': t = S.winner >= 0 ? `${P[S.winner]?.name || 'PLAYER'} WINS THE TABLE!` : 'NOBODY WINS'; break;
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
function renderSelfChoice() {
  bSelf.style.display = S.you === S.active && S.phase === 'SELECTING' ? 'block' : 'none';
}
function allowed(i) {
  if (!S.players[i] || S.players[i].dead) return false;
  if (S.phase === 'NEIGHBOR') return !!S.neighbors && (i === S.neighbors.left || i === S.neighbors.right);
  return true;
}
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const projectedTarget = new THREE.Vector3();
function pickPlayerAt(ev) {
  ndc.set((ev.clientX / window.innerWidth) * 2 - 1, -(ev.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const targets = players.filter((_, i) => i !== S.you).map(p => p.root);
  const hits = raycaster.intersectObjects(targets, true);
  for (const h of hits) {
    let o = h.object;
    while (o && o.userData.idx === undefined) o = o.parent;
    if (o && allowed(o.userData.idx)) return o.userData.idx;
  }

  camera.updateMatrixWorld(true);
  const maxDistance = Math.max(56, Math.min(96, Math.min(window.innerWidth, window.innerHeight) * 0.14));
  let nearest = null;
  let nearestDistance = maxDistance;
  players.forEach((player, index) => {
    if (index === S.you || !allowed(index)) return;
    player.root.updateMatrixWorld(true);
    for (const part of [player.head, player.body]) {
      part.getWorldPosition(projectedTarget).project(camera);
      if (projectedTarget.z < -1 || projectedTarget.z > 1) continue;
      const x = (projectedTarget.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-projectedTarget.y * 0.5 + 0.5) * window.innerHeight;
      const distance = Math.hypot(ev.clientX - x, ev.clientY - y);
      if (distance < nearestDistance) {
        nearest = index;
        nearestDistance = distance;
      }
    }
  });
  return nearest;
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
let gunKick = 0;
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

  // The active player holds the imported weapon and tracks the selected or hovered target.
  const hi = mySelecting() ? hoverLocal : ((ph === 'SELECTING' || ph === 'NEIGHBOR') ? hoverRemote : null);
  let aimIndex = null;
  if (ph === 'AIMING' || ph === 'RESOLVING') aimIndex = S.target;
  else if (ph === 'SELECTING' || ph === 'NEIGHBOR') aimIndex = hi;
  else if (ph === 'GAME_OVER') aimIndex = S.winner;
  aimPoint.set(0, 0.4, 0);
  if (aimIndex !== null && players[aimIndex]) players[aimIndex].head.getWorldPosition(aimPoint);

  players.forEach((p, i) => {
    if (!p.isDead) {
      const idleHeadTurn = Math.sin(t * 0.31 + i * 2.1) * (i === S.active ? 0.055 : 0.09);
      p.head.rotation.y += (idleHeadTurn - p.head.rotation.y) * 1.4 * dt;
      const headTilt = p.headTilt + Math.sin(t * 0.23 + i * 1.4) * 0.012;
      p.head.rotation.z += (headTilt - p.head.rotation.z) * 0.8 * dt;
      p.body.scale.y = p.bodyHeightScale * (1 + Math.sin(t * 0.73 + i * 1.7) * 0.007);
      const hitProgress = Math.min(1, (now - p.hitAt) / 520);
      const hitFlinch = p.hitAt > 0 && hitProgress < 1 ? Math.sin(hitProgress * Math.PI) : 0;
      p.body.rotation.x += (-0.24 * hitFlinch - p.body.rotation.x) * Math.min(1, 18 * dt);
      p.body.position.z += (-0.1 * hitFlinch - p.body.position.z) * Math.min(1, 18 * dt);
    }
    if (now >= p.nextBlinkAt) {
      p.blinkUntil = now + 120;
      p.nextBlinkAt = now + 2600 + Math.random() * 3200;
    }
    p.eyes.forEach(eye => {
      const blinkScale = now < p.blinkUntil ? 0.08 : eye.userData.openScaleY;
      eye.scale.y += (blinkScale - eye.scale.y) * Math.min(1, 36 * dt);
    });

    if (!p.isDead) {
      const pulling = spinning && i === S.active;
      const holding = i === S.active && ph !== 'LOBBY';
      const selfAiming = i === S.active && aimIndex === i
        && ['SELECTING', 'AIMING', 'RESOLVING'].includes(ph);
      const armYaw = Math.atan2(aimPoint.x - p.root.position.x, aimPoint.z - p.root.position.z);
      const armPitch = selfAiming ? -1.05 : (pulling || holding ? 0.4 : 0);
      p.arm.rotation.x += (armPitch - p.arm.rotation.x) * 10 * dt;
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

    if (machines[i]) {
      const lives = Math.max(0, Math.min(3, p.lives));
      machines[i].needles.forEach((needle, index) => { needle.visible = index < lives; });
      machines[i].screenMat.color.setHex(i === S.active ? 0x3b8c5a : 0x343538);
    }
  });

  const holder = players[S.active];
  if (holder) {
    holder.hand.getWorldPosition(handPosition);
    const aimX = aimPoint.x - handPosition.x;
    const aimY = aimPoint.y - handPosition.y;
    const aimZ = aimPoint.z - handPosition.z;
    const yaw = Math.atan2(aimX, aimZ);
    const pitch = -Math.atan2(aimY, Math.hypot(aimX, aimZ));
    gun.root.rotation.y += angleDiff(yaw, gun.root.rotation.y) * 8 * dt;
    gun.root.rotation.x += angleDiff(pitch, gun.root.rotation.x) * 8 * dt;
    gun.root.position.copy(handPosition);
    const forwardX = Math.sin(gun.root.rotation.y);
    const forwardZ = Math.cos(gun.root.rotation.y);
    gun.root.position.y += 0.12;
    gun.root.position.x += forwardX * 0.18;
    gun.root.position.z += forwardZ * 0.18;
    gunKick *= Math.pow(0.02, dt);
    gun.root.position.x -= forwardX * gunKick;
    gun.root.position.z -= forwardZ * gunKick;
  } else {
    gun.root.position.set(GUN_X, 0.62, GUN_Z);
    gunKick = 0;
  }

  // lights, status lamp
  casinoSurge *= Math.pow(0.08, dt);
  const spinBeat = spinning ? (Math.sin(t * 4.6) + 1) * 0.5 : 0;
  spot.intensity = 360 * (0.96 + Math.sin(t * 0.27) * 0.025) + casinoSurge * 120;
  let lampHex = (ph === 'IDLE' || ph === 'SPINNING') ? 0x3b8c5a : 0x8f7a45;
  if (now < lampUntil) lampHex = lampOverride;
  if (finalFlash > 0.01) {
    lampHex = Math.sin(t * 50) > 0 ? 0xff1e27 : 0x111111;
    rim.intensity = 24 + finalFlash * 60 + spinBeat * 34 + casinoSurge * 34;
    finalFlash *= Math.pow(0.08, dt);
  } else rim.intensity = 44 + Math.sin(t * 0.32) * 4 + spinBeat * 34 + casinoSurge * 34;
  machines.forEach((machine, index) => {
    machine.screenMat.color.setHex(index === S.active ? lampHex : 0x343538);
  });

  if (shake > 0.001) {
    camera.position.set(
      baseCamPos.x + (Math.random() - 0.5) * shake,
      baseCamPos.y + (Math.random() - 0.5) * shake,
      baseCamPos.z + (Math.random() - 0.5) * shake
    );
    shake *= Math.pow(0.02, dt);
  } else camera.position.copy(baseCamPos);
  if (S.you >= 0) {
    camera.position.x += Math.sin(t * 0.21) * 0.009;
    camera.position.y += Math.sin(t * 0.48) * 0.012;
    const targetRoll = Math.sin(t * 0.24) * 0.0035 + Math.sin(t * 0.11) * 0.0015;
    camera.rotateZ(targetRoll - cameraRoll);
    cameraRoll = targetRoll;
  }

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
