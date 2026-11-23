'use strict';
/*
 * Roulette table server: zero dependencies (Node 18+).
 *   node server.js            -> http://localhost:3000
 *   PORT=8080 node server.js
 *   SPEED=10 node server.js   -> all server delays 10x faster (for testing)
 *   TURN_SECONDS=90           -> inactivity limit per decision (default 90)
 *
 * The server owns all game state. The hidden chamber is rolled here at STOP
 * and is only revealed when the shot resolves, so clients can't peek.
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const SPEED = Number(process.env.SPEED) || 1;
const TURN_MS = (Number(process.env.TURN_SECONDS) || 90) * 1000;
const MAX_LIVES = 3, MIN_PLAYERS = 2, MAX_PLAYERS = 8;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav'
};

/* ------------------------------------------------------------ static files */
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(req.url.split('?')[0]); } catch { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

/* ------------------------------------------------------------ minimal WebSocket */
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const clients = new Set();
let nextId = 1;

function frame(str) {
  const p = Buffer.from(str);
  let h;
  if (p.length < 126) h = Buffer.from([0x81, p.length]);
  else if (p.length < 65536) { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 126; h.writeUInt16BE(p.length, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(p.length), 2); }
  return Buffer.concat([h, p]);
}
function send(c, obj) {
  if (!c.socket.writable) return;
  c.socket.write(frame(JSON.stringify(obj)));
}
function readFrames(c) {
  while (c.buf.length >= 2) {
    const b0 = c.buf[0], b1 = c.buf[1];
    const opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f, off = 2;
    if (len === 126) { if (c.buf.length < 4) return; len = c.buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (c.buf.length < 10) return; len = Number(c.buf.readBigUInt64BE(2)); off = 10; }
    if (len > 65536) return c.socket.destroy();
    const total = off + (masked ? 4 : 0) + len;
    if (c.buf.length < total) return;
    let payload;
    if (masked) {
      const mask = c.buf.subarray(off, off + 4);
      payload = Buffer.from(c.buf.subarray(off + 4, total));
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    } else payload = c.buf.subarray(off, total);
    c.buf = c.buf.subarray(total);
    if (opcode === 0x8) { c.socket.end(Buffer.from([0x88, 0x00])); return; }
    if (opcode === 0x9) { c.socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue; }
    if (opcode === 0x1) onMessage(c, payload.toString('utf8'));
  }
}
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade).toLowerCase() !== 'websocket') return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const c = { id: nextId++, socket, buf: Buffer.alloc(0), seat: -1 };
  clients.add(c);
  socket.on('data', d => { c.buf = Buffer.concat([c.buf, d]); readFrames(c); });
  socket.on('close', () => onClose(c));
  socket.on('error', () => socket.destroy());
  send(c, snapshot(c));
});

/* ------------------------------------------------------------ room state */
function newRoom() {
  return {
    phase: 'LOBBY',   // LOBBY IDLE SPINNING SETTLING SELECTING AIMING RESOLVING NEIGHBOR GAME_OVER
    seats: [],        // { name, bot, client, lives, dead, away }
    active: -1,       // seat index of the player holding the revolver
    target: null, neighbors: null, hover: null,
    live: false,      // HIDDEN outcome: never sent to clients before it resolves
    spinStart: 0, finalTwo: false, winner: -1, deadline: null, host: null
  };
}
const room = newRoom();
let timers = new Set(), botTimer = null, turnTimer = null;

function later(fn, ms) {
  const t = setTimeout(() => { timers.delete(t); fn(); }, ms / SPEED);
  timers.add(t);
  return t;
}
function clearTimers() {
  timers.forEach(clearTimeout); timers.clear();
  clearTimeout(botTimer); clearTimeout(turnTimer); botTimer = turnTimer = null;
}

const aliveIdx = () => room.seats.map((s, i) => (s.dead ? -1 : i)).filter(i => i >= 0);
const randomAlive = () => { const a = aliveIdx(); return a[Math.floor(Math.random() * a.length)]; };
function reindex() { room.seats.forEach((s, i) => { if (s.client) s.client.seat = i; }); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } }

// "left" = the seat after you (your left as you face the table), "right" = the seat before you.
// Nearest LIVING players, wrapping around the table.
function neighborsOf(i) {
  const n = room.seats.length;
  let left = -1, right = -1;
  for (let k = 1; k < n; k++) { const j = (i + k) % n; if (!room.seats[j].dead) { left = j; break; } }
  for (let k = 1; k < n; k++) { const j = (i - k + n) % n; if (!room.seats[j].dead) { right = j; break; } }
  return { left, right };
}

function ensureHost() {
  if (room.host && clients.has(room.host) && room.host.seat >= 0) return;
  room.host = [...clients].find(c => c.seat >= 0) || null;
}

function snapshot(c) {
  ensureHost();
  return {
    t: 'state',
    phase: room.phase,
    players: room.seats.map(s => ({ name: s.name, lives: s.lives, dead: s.dead, bot: s.bot, away: !!s.away })),
    active: room.active, target: room.target,
    neighbors: room.phase === 'NEIGHBOR' ? room.neighbors : null,
    host: room.host ? room.host.seat : -1,
    you: c.seat, finalTwo: room.finalTwo, winner: room.winner,
    timeLeft: room.deadline ? Math.max(0, (room.deadline - Date.now()) * SPEED) : null,
    maxLives: MAX_LIVES
  };
}
function broadcast(obj) { clients.forEach(c => send(c, obj)); }
function broadcastState() { clients.forEach(c => send(c, snapshot(c))); }
const ev = (o) => broadcast({ t: 'ev', ...o });

function change() {
  armTimers();
  broadcastState();
}

/* ------------------------------------------------------------ timers: bots + inactivity */
const DECISION = ['IDLE', 'SPINNING', 'SELECTING', 'NEIGHBOR'];
function armTimers() {
  clearTimeout(botTimer); clearTimeout(turnTimer); botTimer = turnTimer = null;
  room.deadline = null;
  if (!DECISION.includes(room.phase)) return;
  const s = room.seats[room.active];
  if (!s || s.dead) return;
  if (s.bot) {
    const d = { IDLE: 900, SPINNING: 1200 + Math.random() * 2200, SELECTING: 900, NEIGHBOR: 900 }[room.phase];
    botTimer = setTimeout(botAct, d / SPEED);
  } else if (s.away) {
    turnTimer = setTimeout(timeoutPlayer, 300 / SPEED);   // gone: counts as no response
  } else {
    room.deadline = Date.now() + TURN_MS / SPEED;
    turnTimer = setTimeout(timeoutPlayer, TURN_MS / SPEED);
  }
}

function botAct() {
  const s = room.seats[room.active];
  if (!s || !s.bot || s.dead) return;
  if (room.phase === 'IDLE') doSpin();
  else if (room.phase === 'SPINNING') doStop();
  else if (room.phase === 'SELECTING') {
    const alive = aliveIdx();
    const others = alive.filter(i => i !== room.active);
    const cand = Math.random() < 0.25 || !others.length ? room.active : others[Math.floor(Math.random() * others.length)];
    room.hover = cand; broadcast({ t: 'hover', i: cand });
    later(() => { if (room.phase === 'SELECTING' && room.seats[room.active] === s) doPick(cand); }, 700);
  } else if (room.phase === 'NEIGHBOR') {
    const nb = room.neighbors;
    const cand = Math.random() < 0.5 ? nb.left : nb.right;
    room.hover = cand; broadcast({ t: 'hover', i: cand });
    later(() => { if (room.phase === 'NEIGHBOR' && room.seats[room.active] === s) doNeighbor(cand); }, 700);
  }
}

/* ------------------------------------------------------------ game flow */
function startGame() {
  clearTimers();
  const seats = room.seats;
  shuffle(seats);                         // random seating
  reindex();
  seats.forEach(s => { s.lives = MAX_LIVES; s.dead = false; s.away = false; });
  Object.assign(room, { target: null, neighbors: null, hover: null, finalTwo: false, winner: -1 });
  if (seats.length === 2) { seats.forEach(s => (s.lives = 1)); room.finalTwo = true; }   // already the final two
  room.active = Math.floor(Math.random() * seats.length);                                // random first holder
  room.phase = 'IDLE';
  ev({ e: 'start' });
  change();
}

function nextHolder(i) {
  room.active = i; room.phase = 'IDLE';
  room.target = null; room.neighbors = null; room.hover = null;
  change();
}
function gameOver(i) {
  room.phase = 'GAME_OVER'; room.winner = i; room.target = null; room.neighbors = null;
  change();
}
// After anyone is eliminated: win check, final-two reset, then a random new holder.
function afterElimination() {
  const a = aliveIdx();
  if (a.length <= 1) return gameOver(a.length ? a[0] : -1);
  if (a.length === 2 && !room.finalTwo) {
    room.finalTwo = true;
    a.forEach(i => (room.seats[i].lives = 1));   // discard any extra lives
    ev({ e: 'sudden' });
  }
  nextHolder(randomAlive());
}

function timeoutPlayer() {
  const i = room.active, s = room.seats[i];
  if (!s || s.dead || !DECISION.includes(room.phase)) return;
  s.lives = 0; s.dead = true;
  ev({ e: 'timeout', who: i });
  room.phase = 'RESOLVING'; room.target = null; room.neighbors = null;
  change();
  later(afterElimination, 1300);
}

function doSpin() {
  room.phase = 'SPINNING'; room.spinStart = Date.now();
  change();
}
function doStop() {
  // Hidden 50/50. Hold time nudges it by at most 8% through a sine, so there is no pattern to learn.
  const held = ((Date.now() - room.spinStart) * SPEED) / 1000;
  room.live = Math.random() < 0.5 + 0.08 * Math.sin(held * 6.1);
  room.phase = 'SETTLING';
  change();
  later(() => { room.phase = 'SELECTING'; room.target = null; room.hover = null; change(); }, 2600);
}
function doPick(i) {
  room.target = i; room.hover = null; room.phase = 'AIMING';
  broadcast({ t: 'hover', i: null });
  change();
  later(fire, 1300);                       // gun turns to the target, then the game determines the outcome
}
function fire() {
  if (room.phase !== 'AIMING') return;
  const h = room.active, t = room.target, v = room.seats[t];
  room.phase = 'RESOLVING';

  if (!room.live) {                        // BLANK
    ev({ e: 'blank', target: t, by: h });
    change();
    later(() => nextHolder(t === h ? h : t), 1100);   // self: go again / other: target takes the gun
    return;
  }

  v.lives -= 1;                            // SHOT
  const dead = v.lives <= 0;
  if (dead) v.dead = true;
  ev({ e: 'shot', target: t, by: h, lives: v.lives, dead });
  change();
  if (dead) later(afterElimination, 1500);
  else if (t === h) {
    later(() => {                          // shot yourself: pick a living neighbour to take the gun
      const nb = neighborsOf(h);
      if (nb.left === nb.right) return nextHolder(nb.left);
      room.phase = 'NEIGHBOR'; room.neighbors = nb; room.hover = null;
      change();
    }, 1200);
  } else later(() => nextHolder(randomAlive()), 1200);
}
function doNeighbor(i) {
  const nb = room.neighbors;
  if (!nb || (i !== nb.left && i !== nb.right)) return;
  broadcast({ t: 'hover', i: null });
  nextHolder(i);
}

/* ------------------------------------------------------------ client messages */
const clean = (n) => String(n || '').replace(/[^\w \-]/g, '').trim().slice(0, 12).toUpperCase();
const isHolder = (c) => c.seat >= 0 && c.seat === room.active;

const handlers = {
  join(c, m) {
    if (c.seat >= 0) return;
    if (room.phase !== 'LOBBY') return send(c, { t: 'err', msg: 'MATCH IN PROGRESS: YOU ARE SPECTATING' });
    if (room.seats.length >= MAX_PLAYERS) return send(c, { t: 'err', msg: 'TABLE IS FULL' });
    room.seats.push({ name: clean(m.name) || 'PLAYER ' + (room.seats.length + 1), bot: false, client: c, lives: MAX_LIVES, dead: false, away: false });
    c.seat = room.seats.length - 1;
  },
  addBot(c) {
    if (room.phase !== 'LOBBY' || c !== room.host || room.seats.length >= MAX_PLAYERS) return;
    const n = room.seats.filter(s => s.bot).length + 1;
    room.seats.push({ name: 'BOT ' + n, bot: true, client: null, lives: MAX_LIVES, dead: false, away: false });
  },
  removeBot(c) {
    if (room.phase !== 'LOBBY' || c !== room.host) return;
    for (let i = room.seats.length - 1; i >= 0; i--) if (room.seats[i].bot) { room.seats.splice(i, 1); break; }
    reindex();
  },
  start(c) {
    if (room.phase !== 'LOBBY' || c !== room.host || room.seats.length < MIN_PLAYERS) return;
    return startGame();
  },
  spin(c) { if (room.phase === 'IDLE' && isHolder(c)) doSpin(); },
  stop(c) { if (room.phase === 'SPINNING' && isHolder(c)) doStop(); },
  pick(c, m) {
    if (!isHolder(c)) return;
    const i = Number(m.i);
    if (!Number.isInteger(i) || i < 0 || i >= room.seats.length || room.seats[i].dead) return;
    if (room.phase === 'SELECTING') doPick(i);
    else if (room.phase === 'NEIGHBOR') doNeighbor(i);
  },
  hover(c, m) {
    if (!isHolder(c) || (room.phase !== 'SELECTING' && room.phase !== 'NEIGHBOR')) return;
    const i = m.i === null ? null : Number(m.i);
    room.hover = Number.isInteger(i) ? i : null;
    clients.forEach(o => { if (o !== c) send(o, { t: 'hover', i: room.hover }); });
    return 'nochange';
  },
  rematch(c) {
    if (room.phase !== 'GAME_OVER' || c !== room.host) return;
    clearTimers();
    room.seats = room.seats.filter(s => !s.away);
    room.seats.forEach(s => { s.lives = MAX_LIVES; s.dead = false; });
    Object.assign(room, { phase: 'LOBBY', active: -1, target: null, neighbors: null, hover: null, winner: -1, finalTwo: false });
    reindex();
  }
};

function onMessage(c, text) {
  let m; try { m = JSON.parse(text); } catch { return; }
  const h = handlers[m && m.t];
  if (!h || !Object.prototype.hasOwnProperty.call(handlers, m.t)) return;
  if (h(c, m) === 'nochange') return;
  if (room.phase === 'LOBBY' || !['spin', 'stop', 'pick', 'start'].includes(m.t)) change();   // others call change() themselves
}

function onClose(c) {
  if (!clients.delete(c)) return;
  if (c.seat >= 0) {
    const s = room.seats[c.seat];
    if (room.phase === 'LOBBY') { room.seats.splice(c.seat, 1); reindex(); }
    else if (s) { s.client = null; s.away = true; }       // gone: removed when it is their turn
    c.seat = -1;
  }
  if (room.phase !== 'LOBBY' && !room.seats.some(s => s.client)) {   // nobody human left
    clearTimers();
    Object.assign(room, newRoom());
  }
  change();
}

server.listen(PORT, () => {
  console.log(`Roulette table running: http://localhost:${PORT}`);
  console.log(`  speed x${SPEED}, inactivity limit ${TURN_MS / 1000}s`);
  console.log('  quick test: open /?quick=3 (you + 3 bots, auto-start)');
});
