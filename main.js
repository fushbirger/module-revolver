import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mk, preloadBlockbenchAssets, resolveModelStyle, createEnvironment, createGun, createMachine, createMafiaPlayer } from './models.js';

const params = new URLSearchParams(location.search);
const MODEL_STYLE = resolveModelStyle(params.get('models') || 'lowpoly');
await preloadBlockbenchAssets(MODEL_STYLE);

/* ================================================================ config */
const GUN_X = 0, GUN_Z = 0.35;                        // gun pivot on the table
const GUN_Y = 0.9;                                    // held above the tabletop
const TABLE_Y = 0.856;                                // tabletop surface height
const RING_RX = 1.78, RING_RZ = 1.78, RING_CZ = 0;    // seats around the round table
const EYE_HEIGHT = 1.19;                              // seated eye line
const BASE_CAM = new THREE.Vector3(0.0, 2.55, 5.2);   // party-screen overview
const LOOK = new THREE.Vector3(0.0, 0.95, 0.0);
let camSpread = 2.6;
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
scene.background = new THREE.Color(0x050608);
scene.fog = new THREE.FogExp2(0x07080b, 0.034);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 0.05, 120);
const baseCamPos = BASE_CAM.clone();
let cameraRoll = 0;
camera.position.copy(baseCamPos);
camera.lookAt(LOOK);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
document.body.appendChild(renderer.domElement);

let composer = null, bloom = null, gradePass = null;

function updateResponsiveCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  const spectator = S.phase === 'GAME_OVER' && S.you >= 0;
  const viewer = S.you >= 0 && !spectator ? players[S.you] : null;
  camera.aspect = aspect;
  camera.fov = aspect < 1
    ? Math.min(viewer ? 86 : 74, (viewer ? 64 : 46) / Math.sqrt(aspect))
    : viewer ? 64 : 46;
  camera.updateProjectionMatrix();
  const look = spectator ? new THREE.Vector3(0, 0.92, 0) : LOOK;
  if (viewer) {
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(viewer.root.quaternion);
    baseCamPos.copy(viewer.root.position).addScaledVector(forward, -0.3);
    baseCamPos.y = viewer.root.position.y + EYE_HEIGHT + 0.05;
  } else {
    // Keep the room overview while the player is in the party screens or spectating.
    const dir = BASE_CAM.clone().sub(LOOK);
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect;
    const spread = spectator ? camSpread + 1.5 : camSpread;
    const k = Math.max(1, (spread / tanH) / dir.length());
    baseCamPos.copy(LOOK).addScaledVector(dir, k);
  }
  camera.position.copy(baseCamPos);
  if (viewer) camera.lookAt(GUN_X, GUN_Y, GUN_Z);
  else camera.lookAt(look);
  cameraRoll = 0;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (typeof composer !== 'undefined' && composer) {
    composer.setPixelRatio(pixelRatio);
    composer.setSize(window.innerWidth, window.innerHeight);
  }
}
window.addEventListener('resize', updateResponsiveCamera);

/* Buckshot Roulette lighting: one hard overhead practical, a red rim, almost no ambient. */
const spot = new THREE.SpotLight(0xf7f2e4, 155, 17, Math.PI / 5.6, 0.45, 1.55);
spot.position.set(0.0, 5.2, 1.15);
spot.target.position.set(0, 0.82, -0.15);
spot.castShadow = true;
spot.shadow.mapSize.set(2048, 2048);
spot.shadow.camera.near = 0.5;
spot.shadow.camera.far = 14;
spot.shadow.bias = -0.0007;
spot.shadow.normalBias = 0.022;
const rim = new THREE.PointLight(0x9c1119, 100, 13, 2.0);
rim.position.set(0, 2.1, -4.4);
const coldFill = new THREE.PointLight(0x2f3d4d, 9, 9, 2.0);
coldFill.position.set(3.6, 2.7, 2.6);
const hemi = new THREE.HemisphereLight(0x2c3138, 0x050506, 0.4);
const houseFill = new THREE.DirectionalLight(0xcfd3d8, 0.85);
houseFill.position.set(0.6, 3.0, 5.0);
houseFill.target.position.set(0, 0.9, 0);
const sconceL = new THREE.PointLight(0xe6dcc2, 26, 7, 2.0);
sconceL.position.set(-6.5, 2.7, -9.2);
const sconceR = new THREE.PointLight(0xe6dcc2, 26, 7, 2.0);
sconceR.position.set(6.5, 2.7, -9.2);
scene.add(hemi, houseFill, houseFill.target, spot, spot.target, rim, coldFill, sconceL, sconceR);

// Faint volumetric cone under the pendant so the key light reads as a real fixture.
const muzzleLight = new THREE.PointLight(0xffdfae, 0, 5, 2);
scene.add(muzzleLight);

const lightCone = new THREE.Mesh(
  new THREE.ConeGeometry(2.35, 3.9, 40, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xd9d0b6, transparent: true, opacity: 0.028,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending
  })
);
lightCone.position.set(0, 2.55, 0);
scene.add(lightCone);

// A tiny procedural environment gives the metals something to reflect.
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
envScene.background = new THREE.Color(0x06070a);
const envPanel = (color, size, position, rotation) => {
  const panel = new THREE.Mesh(
    new THREE.PlaneGeometry(size[0], size[1]),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide })
  );
  panel.position.set(...position);
  panel.rotation.set(...rotation);
  envScene.add(panel);
};
envPanel(0xfff6e2, [3, 3], [0, 3, 0], [-Math.PI / 2, 0, 0]);
envPanel(0x7d1016, [4, 2], [0, 0.6, -4], [0, 0, 0]);
envPanel(0x1a1d22, [8, 8], [0, -1, 0], [-Math.PI / 2, 0, 0]);
const envRT = pmrem.fromScene(envScene, 0.04);
scene.environment = envRT.texture;
pmrem.dispose();

const environment = createEnvironment(scene);
const sign = environment.getObjectByName('Fortuna Sign');
let lettering;
sign?.traverse(object => {
  if (!lettering && object.isMesh && object.name === 'FORTUNA lettering') lettering = object;
});
if (!sign || !lettering) throw new Error('Casino environment is missing its Fortuna marquee');
const gun = createGun(scene);
gun.model.rotation.set(0.05, 0.2, 0.12);

/* ---------------------------------------------------------------- post grade */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSaturation: { value: 0.2 },
    uContrast: { value: 1.2 },
    uVignette: { value: 0.92 },
    uGrain: { value: 0.055 }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float radius = dot(dir, dir);
      float aberration = 0.0008 + radius * 0.0035;
      vec3 color;
      color.r = texture2D(tDiffuse, uv + dir * aberration).r;
      color.g = texture2D(tDiffuse, uv).g;
      color.b = texture2D(tDiffuse, uv - dir * aberration).b;

      float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
      vec3 graded = mix(vec3(luma), color, uSaturation);

      // cold shadows, bone highlights, a whisper of blood in the midtones
      graded = mix(graded, graded * vec3(0.86, 0.93, 1.08), (1.0 - smoothstep(0.0, 0.42, luma)) * 0.6);
      graded = mix(graded, graded * vec3(1.07, 1.0, 0.9), smoothstep(0.5, 1.0, luma) * 0.55);
      graded.r += smoothstep(0.25, 0.8, luma) * (1.0 - smoothstep(0.8, 1.0, luma)) * 0.012;

      graded = max(graded - 0.014, 0.0);
      graded = (graded - 0.5) * uContrast + 0.5;
      graded = pow(max(graded, 0.0), vec3(1.05));

      float vignette = 1.0 - smoothstep(0.3, 0.95, length(dir * vec2(1.0, 1.12)));
      graded *= mix(1.0, vignette, uVignette);

      float grain = hash(uv * uResolution + fract(uTime) * 91.7) - 0.5;
      graded += grain * uGrain * (1.0 - luma * 0.55);

      gl_FragColor = vec4(max(graded, 0.0), 1.0);
    }
  `
};

const postEnabled = params.get('post') !== '0';
composer = postEnabled ? new EffectComposer(renderer) : null;
if (composer) {
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight), 0.42, 0.72, 0.8
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  gradePass = new ShaderPass(GradeShader);
  gradePass.renderToScreen = true;
  composer.addPass(gradePass);
}
updateResponsiveCamera();


// shared confetti resources
const confettiGeo = new THREE.PlaneGeometry(0.09, 0.06);
const confettiMats = [0x8e1119, 0xd8d2c2, 0x3a0a0e, 0x1b1c1e, 0xa9a292]
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
  camSpread = 2.6;
  updateResponsiveCamera();
}
function buildSeats(n) {
  clearSeats();
  const seatWidth = 0.66;
  const ringRadius = Math.max(RING_RX, seatWidth / (2 * Math.sin(Math.PI / n)));
  for (let i = 0; i < n; i++) {
    const ang = (i / n) * Math.PI * 2;
    const x = ringRadius * Math.sin(ang);
    const z = RING_CZ + ringRadius * Math.cos(ang);
    const rotY = Math.atan2(GUN_X - x, GUN_Z - z);       // seat faces the gun
    const pl = createMafiaPlayer(scene, x, 0, z, rotY, i);
    pl.root.userData.idx = i;
    pl.deadAt = 0;
    players.push(pl);
  }
  const clockRadius = Math.max(1.18, 0.36 / (2 * Math.sin(Math.PI / n)));
  machines = players.map(player => {
    const machine = createMachine(scene);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(player.root.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(player.root.quaternion);
    machine.root.position.copy(player.root.position)
      .addScaledVector(forward, ringRadius - clockRadius)
      .addScaledVector(right, 0.32);
    machine.root.position.y = TABLE_Y + 0.03;
    machine.root.rotation.y = player.root.rotation.y;  // dial faces the seat
    machine.root.scale.multiplyScalar(0.72);
    return machine;
  });
  camSpread = ringRadius + 0.9;
  updateResponsiveCamera();
}

/* ================================================================ HTML overlay */
const HUD_FONT = `ui-monospace,"SFMono-Regular",Menlo,Consolas,"Courier New",monospace`;
const CUT = 'clip-path:polygon(0 0,calc(100% - 9px) 0,100% 9px,100% 100%,9px 100%,0 calc(100% - 9px))';
const BTN = `${CUT};padding:11px 22px;background:rgba(8,8,9,.86);border:1px solid #6d685d;color:#ded8c8;font-family:${HUD_FONT};font-size:12px;font-weight:600;letter-spacing:.22em;text-transform:uppercase`;
document.body.insertAdjacentHTML('beforeend', `
  <div id="scanlines"></div>
  <div id="hudTag">FORTUNA&nbsp;&nbsp;//&nbsp;&nbsp;TABLE</div>
  <div id="msg"></div>
  <div id="ui">
      <button id="bStart" disabled style="${BTN};border-color:#e9e4d6;background:#e9e4d6;color:#08080a">SPIN</button>
      <button id="bStop" disabled style="${BTN};border-color:#a11a1f;background:rgba(36,6,8,.9);color:#ffd9d4">STOP</button>
  </div>
  <div id="pick">
    <button id="bSelf" style="${BTN};border-color:#a11a1f;color:#ffd9d4">SHOOT YOURSELF</button>
  </div>
  <div id="resetRow">
    <button id="bReset" style="${BTN}">NEW MATCH</button>
    <button id="bLeave" style="${BTN};border-color:#a11a1f;color:#ffd9d4">LEAVE TABLE</button>
  </div>
  <button id="soundToggle" type="button" aria-label="Mute game sounds" aria-pressed="false"
    style="${CUT};position:fixed;top:16px;right:16px;z-index:21;padding:9px 14px;background:rgba(8,8,9,.86);border:1px solid #4b4841;color:#b9b3a5;font-family:${HUD_FONT};font-size:10px;letter-spacing:.24em">SOUND ON</button>
  <div id="lobby" style="display:flex;position:fixed;inset:0;align-items:center;justify-content:center;z-index:20;background:rgba(3,3,4,.8)">
    <div id="lobbyBox" style="min-width:280px;max-width:90%;background:#0a0a0b;border:1px solid #6d685d;padding:22px;font-family:${HUD_FONT};font-size:12px;letter-spacing:.06em;color:#ded8c8;line-height:1.75;box-shadow:0 30px 90px #000,inset 0 0 0 1px rgba(222,216,200,.05)"></div>
  </div>
`);
const styleTag = document.createElement('style');
styleTag.textContent = `
  #msg{position:fixed;top:44px;left:50%;transform:translateX(-50%);font-family:${HUD_FONT};font-size:13px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:#efeadd;text-shadow:0 0 22px rgba(0,0,0,.95),0 2px 2px #000;text-align:center;width:92%;z-index:10;pointer-events:none}
  #ui{position:fixed;display:none;right:30px;bottom:28px;gap:12px;z-index:12}
  #ui button{transition:opacity .12s ease,filter .12s ease}
  #ui button[disabled]{visibility:hidden}
  #pick{display:none;position:fixed;right:30px;bottom:92px;z-index:12}
  #resetRow{display:none;position:fixed;right:30px;bottom:28px;gap:10px;z-index:12}
  #hudTag{position:fixed;top:18px;left:20px;z-index:10;font-family:${HUD_FONT};font-size:10px;letter-spacing:.34em;color:#6f6b61;text-transform:uppercase;pointer-events:none}
  #scanlines{position:fixed;inset:0;z-index:4;pointer-events:none;opacity:.16;
    background:repeating-linear-gradient(to bottom,rgba(0,0,0,0) 0,rgba(0,0,0,0) 2px,rgba(0,0,0,.5) 3px,rgba(0,0,0,0) 4px)}
  button{cursor:pointer}
  button:disabled{cursor:default}
  #ui button:not(:disabled):hover{filter:brightness(1.25)}
  #lobbyBox input,#lobbyBox select{font-family:${HUD_FONT};font-size:12px;letter-spacing:.08em}
`;
document.head.appendChild(styleTag);
const msgEl    = document.getElementById('msg');
const uiEl     = document.getElementById('ui');
const bStart   = document.getElementById('bStart');
const bStop    = document.getElementById('bStop');
const pickEl   = document.getElementById('pick');
const bSelf    = document.getElementById('bSelf');
const resetRow = document.getElementById('resetRow');
const bReset   = document.getElementById('bReset');
const bLeave   = document.getElementById('bLeave');
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
  soundToggle.textContent = soundsMuted ? 'SOUND OFF' : 'SOUND ON';
  soundToggle.setAttribute('aria-label', soundsMuted ? 'Enable game sounds' : 'Mute game sounds');
  soundToggle.setAttribute('aria-pressed', String(!soundsMuted));
  if (soundsMuted) stopSpinSound();
  else {
    unlockAudio();
    if (S.phase === 'SPINNING') startSpinSound();
  }
};

function setControls(startOn, stopOn) {
  bStart.disabled = !startOn;
  bStop.disabled = !stopOn;
}
bStart.onclick = () => send({ t: 'spin' });
bStop.onclick  = () => send({ t: 'stop' });
bReset.onclick = () => send({ t: 'rematch' });
bLeave.onclick = () => send({ t: 'leaveTable' });

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
  const exitBtn = 'position:fixed;right:20px;bottom:20px;padding:12px 18px;background:#240709;border:1px solid #a11a1f;color:#ffd9d4;font-family:inherit;font-size:12px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;cursor:pointer';
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
    updateResponsiveCamera();
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
  resetRow.style.display = S.phase === 'GAME_OVER' ? 'flex' : 'none';
  bReset.style.display = S.you === S.host ? 'inline-block' : 'none';
  renderLobby();

  if (quick && !quickDone && S.phase === 'LOBBY' && S.you >= 0 && S.host === S.you) {
    quickDone = true;
    for (let i = 0; i < quick; i++) send({ t: 'addBot' });
    send({ t: 'start' });
  }
}

let lampOverride = 0, lampUntil = 0;
const lamp = (hex, ms) => { lampOverride = hex; lampUntil = performance.now() + ms; };
let shake = 0, finalFlash = 0, casinoSurge = 0, muzzleFlash = 0;

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
    shake = 0.24; gunKick = 0.025; muzzleFlash = 1; lamp(0x9e1b24, 1100);
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
  aimPoint.set(0, TABLE_Y, 0);
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
    gun.root.position.y += 0.02;
    gun.root.position.x += forwardX * 0.06;
    gun.root.position.z += forwardZ * 0.06;
    gunKick *= Math.pow(0.02, dt);
    gun.root.position.x -= forwardX * gunKick;
    gun.root.position.z -= forwardZ * gunKick;
  } else {
    gun.root.position.set(GUN_X, TABLE_Y + 0.03, GUN_Z);
    gunKick = 0;
  }

  // lights, status lamp
  casinoSurge *= Math.pow(0.08, dt);
  const spinBeat = spinning ? (Math.sin(t * 4.6) + 1) * 0.5 : 0;
  const flicker = 0.95 + Math.sin(t * 7.3) * 0.012 + Math.sin(t * 13.7) * 0.008;
  spot.intensity = 148 * flicker + casinoSurge * 80;
  let lampHex = (ph === 'IDLE' || ph === 'SPINNING') ? 0xb8ad91 : 0x4a4a45;
  if (now < lampUntil) lampHex = lampOverride;
  if (finalFlash > 0.01) {
    lampHex = Math.sin(t * 50) > 0 ? 0xff1e27 : 0x111111;
    rim.intensity = 34 + finalFlash * 90 + spinBeat * 40 + casinoSurge * 40;
    finalFlash *= Math.pow(0.08, dt);
  } else rim.intensity = 100 + Math.sin(t * 0.32) * 8 + spinBeat * 40 + casinoSurge * 40;
  lightCone.material.opacity = 0.022 + spinBeat * 0.018 + casinoSurge * 0.02;
  machines.forEach((machine, index) => {
    machine.screenMat.color.setHex(index === S.active ? lampHex : 0x2b2c2e);
  });

  muzzleFlash *= Math.pow(0.0006, dt);
  muzzleLight.intensity = muzzleFlash * 70;
  if (muzzleFlash > 0.01) {
    const mx = Math.sin(gun.root.rotation.y), mz = Math.cos(gun.root.rotation.y);
    muzzleLight.position.set(gun.root.position.x + mx * 0.28, gun.root.position.y + 0.05, gun.root.position.z + mz * 0.28);
  }

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

  // message line
  setMsg(now < msgHold.until ? msgHold.text : statusText());
  if (gradePass) {
    gradePass.uniforms.uTime.value = t;
    gradePass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  }
  if (composer) composer.render();
  else renderer.render(scene, camera);
}
animate();
