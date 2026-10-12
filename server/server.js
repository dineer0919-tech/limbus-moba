// 림버스 MOBA 전용 서버 · 방 기록(로비 · 픽 · 쏠전) + 방마다 게임 계산 + 실시간 중계
// 실행: node server.js   (설정은 환경 변수: PORT, GAME_URL, GAME_FILE, TICK)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const {Worker} = require('worker_threads');
const {attach} = require('./ws');
const {DB, norm} = require('./db');

const PORT = +process.env.PORT || 8080;
const GAME_URL = process.env.GAME_URL ?? 'https://dineer0919-tech.github.io/limbus-moba/';
const GAME_FILE = process.env.GAME_FILE || path.join(__dirname, 'game-cache.html');   // 받아 온 게임 보관 (저장소의 ../index.html 도 함께 살펴봄)
const DISC_GRACE = 4000, EMPTY_TTL = 15000, LOBBY_TTL = 30 * 60 * 1000;
const log = (...a) => console.log(new Date().toISOString().slice(5, 19).replace('T', ' '), ...a);

// ── 게임 파일 (서버도 같은 게임 코드로 계산해야 하므로 GitHub Pages에서 자동으로 받아 옴) ──
const GAME = {html:'', ver:0, at:0, src:'', fetching:null};
const verOf = html => { const m = /버전 v(\d+)/.exec(html); return m ? +m[1] : 0; };
function setGame(html, from) {
  const v = verOf(html); if (!html.includes('<script>') || !v) return false;
  if (!html.includes('mpSrvBoot')) { if (v > GAME.ver) log(`게임 v${v}은 서버용이 아닌 옛 버전이라 건너뜀 (${from})`); return false; }
  if (v < GAME.ver) return false;
  if (v !== GAME.ver) log(`게임 v${v} 불러옴 (${from})`);
  GAME.html = html; GAME.ver = v; GAME.at = Date.now(); return true;
}
function loadLocal() { for (const f of [GAME_FILE, path.join(__dirname, '..', 'index.html')]) try { if (fs.existsSync(f)) setGame(fs.readFileSync(f, 'utf8'), path.basename(f)); } catch (e) { log('게임 파일 읽기 실패', e.message); } }
async function refreshGame(force) {
  if (!GAME_URL) return;
  if (GAME.fetching) return GAME.fetching;
  if (!force && Date.now() - GAME.at < 5 * 60 * 1000 && GAME.html) return;
  GAME.fetching = (async () => {
    try {
      const res = await fetch(GAME_URL + (GAME_URL.includes('?') ? '&' : '?') + 't=' + Date.now(), {headers:{'cache-control':'no-cache'}});
      if (res.ok) { const h = await res.text(); if (setGame(h, 'GitHub')) { try { fs.writeFileSync(GAME_FILE, h); } catch {} } }
      else log('게임 받기 실패', res.status);
    } catch (e) { log('게임 받기 실패', e.message); }
    finally { GAME.at = Date.now(); GAME.fetching = null; }
  })();
  return GAME.fetching;
}
loadLocal();
refreshGame(true);
setInterval(() => refreshGame(false), 60 * 1000);

// ── 데이터베이스 · 접속자 ──
const db = new DB();
const peers = new Set();                                                 // 브라우저 접속 + 방마다 게임 계산 담당
const byUid = new Map();                                                 // uid → Set(peer)
const engines = new Map();                                               // 방 코드 → {worker, peer, emptyAt}
const discTimers = new Map();

function peerUidAdd(p) { if (!p.uid) return; let s = byUid.get(p.uid); if (!s) byUid.set(p.uid, s = new Set()); s.add(p); }
function peerUidDel(p) { const s = p.uid && byUid.get(p.uid); if (s) { s.delete(p); if (!s.size) byUid.delete(p.uid); } }
const liveOf = uid => { const s = byUid.get(uid); return s ? [...s].filter(p => p.live) : []; };

function makePeer(send, kind) {
  const p = {send, kind, uid:null, live:true, subs:new Map(), discs:new Map(), at:Date.now()};
  peers.add(p); return p;
}
function dropPeer(p, grace) {
  if (!p.live) return; p.live = false;
  for (const id of p.subs.values()) db.unsub(id); p.subs.clear();
  peers.delete(p); peerUidDel(p);
  const run = () => {                                                    // 끊긴 사람의 '나가면 지우기' 실행 (같은 사람이 다시 붙었으면 건너뜀)
    if (p.uid && liveOf(p.uid).length) return;
    for (const [pth, v] of p.discs) db.write(pth, v);
    p.discs.clear();
  };
  if (grace && p.uid) { const t = setTimeout(() => { discTimers.delete(t); run(); }, DISC_GRACE); discTimers.set(t, 1); } else run();
}
function code4() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; for (;;) { const c = Array.from({length:4}, () => A[crypto.randomInt(32)]).join(''); if (!db.read('rooms/' + c) && !engines.has(c)) return c; } }

function handle(p, m) {
  const reply = o => p.send({o:'r', id:m.id, ...o});
  switch (m.o) {
    case 'hello': {
      if (p.kind === 'ws') {
        let uid = typeof m.uid === 'string' && /^[A-Za-z0-9_-]{6,40}$/.test(m.uid) && !m.uid.startsWith('srv-') ? m.uid : 'u' + crypto.randomBytes(9).toString('base64url');
        p.uid = uid; peerUidAdd(p);
        const cv = +m.ver || 0;
        if (cv > GAME.ver) refreshGame(true);                            // 손님이 더 새 버전: 서버도 새로 받아 봄
        p.send({o:'hi', uid, ver:GAME.ver, now:Date.now()});
      } else p.send({o:'hi', uid:p.uid, ver:GAME.ver, now:Date.now()});
      return;
    }
    case 't': return reply({now:Date.now()});
    case 'get': return reply({v:db.get(m.p)});
    case 'set': db.write(m.p, m.v); return reply({});
    case 'upd': db.update(m.p, m.v || {}); return reply({});
    case 'cas': { const r = db.cas(m.p, m.exp, m.v); return reply(r); }
    case 'push': return reply({v:db.push(m.p, m.v)});
    case 'rooms': return reply({v:db.openRooms(m.f || 'openPub')});
    case 'disc': p.discs.set(norm(m.p), m.v ?? null); if (m.id) reply({}); return;
    case 'undisc': p.discs.delete(norm(m.p)); return reply({});
    case 'sub': case 'subc': {
      const old = p.subs.get(m.sid); if (old) db.unsub(old);
      const child = m.o === 'subc', sid = m.sid;
      p.subs.set(sid, db.sub(m.p, v => { if (p.live) p.send({o:child ? 'child' : 'val', sid, v}); }, child));
      return;
    }
    case 'unsub': { const id = p.subs.get(m.sid); if (id) db.unsub(id); p.subs.delete(m.sid); return; }
    case 'create': {
      if (p.kind !== 'ws' || !p.uid) return reply({err:'not ready'});
      if (!GAME.html) return reply({err:'서버가 아직 게임 파일을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.'});
      const room = m.room && typeof m.room === 'object' ? m.room : {};
      const code = code4();
      room.host = 'srv-' + code; room.lead = p.uid; room.created = Date.now(); room.ver = GAME.ver;
      db.write('rooms/' + code, room);
      startEngine(code);
      log(`방 ${code} 생성 (${room.mode === 'duel' ? '쏠전' : '멀티'}) · 지금 방 ${engines.size}개`);
      return reply({v:code});
    }
    case 'g': {                                                          // 손님 → 그 방의 게임 계산 담당
      const E = engines.get(m.c); if (!E || !p.uid) return;
      E.worker.postMessage({o:'g', from:p.uid, d:m.d});
      return;
    }
    case 'send': {                                                       // 게임 계산 담당 → 손님
      if (p.kind !== 'engine') return;
      for (const q of liveOf(m.to)) if (q.kind === 'ws') q.send({o:'g', d:m.d});
      return;
    }
    case 'log': log(`[${p.code}]`, m.t); return;
    case 'k': p.send({o:'k'}); return;
  }
}

// ── 방마다 게임 계산 담당 (별도 스레드) ──
function startEngine(code) {
  const w = new Worker(path.join(__dirname, 'engine.js'), {workerData:{code, uid:'srv-' + code, html:GAME.html, tick:+process.env.TICK || 60}});
  const p = makePeer(o => { try { w.postMessage(o); } catch {} }, 'engine');
  p.uid = 'srv-' + code; p.code = code; peerUidAdd(p);
  const E = {worker:w, peer:p, emptyAt:0, born:Date.now()};
  engines.set(code, E);
  w.on('message', m => { if (m && m.o === 'evalr') { const f = evalWait.get(m.id); if (f) { evalWait.delete(m.id); f(m.v); } return; } if (m && m.o) handle(p, m); });
  w.on('error', e => { log(`[${code}] 게임 계산 오류로 멈춤:`, e && e.stack || e); stopEngine(code, true); });
  w.on('exit', () => { if (engines.get(code) === E) stopEngine(code, true); });
}
function stopEngine(code, removeRoom) {
  const E = engines.get(code); if (!E) return;
  engines.delete(code); dropPeer(E.peer, false);
  try { E.worker.terminate(); } catch {}
  if (removeRoom) db.write('rooms/' + code, null);
  log(`방 ${code} 닫힘 · 남은 방 ${engines.size}개`);
}
setInterval(() => {                                                      // 빈 방 · 오래된 대기실 정리
  const now = Date.now();
  for (const [code, E] of engines) {
    const r = db.read('rooms/' + code);
    if (!r) { stopEngine(code, false); continue; }
    const n = Object.keys(r.players || {}).length;
    if (n) E.emptyAt = 0; else if (!E.emptyAt) E.emptyAt = now; else if (now - E.emptyAt > EMPTY_TTL) { stopEngine(code, true); continue; }
    if (r.state === 'lobby' && now - (r.created || now) > LOBBY_TTL) stopEngine(code, true);
  }
  const rooms = db.read('rooms') || {};
  for (const code in rooms) if (!engines.has(code)) db.write('rooms/' + code, null);   // 계산 담당이 없는 방은 지움
}, 2000);
setInterval(() => {                                                      // 손님마다 보내는 줄이 얼마나 밀렸는지 → 게임 계산 담당에게 (밀리면 합쳐서 보냄)
  for (const [code, E] of engines) {
    const r = db.read('rooms/' + code); if (!r || !r.players) continue;
    const m = {};
    for (const uid in r.players) { let b = 0; for (const q of liveOf(uid)) if (q.kind === 'ws') b = Math.max(b, q.conn.bufferedAmount); m[uid] = b; }
    E.worker.postMessage({o:'buf', m});
  }
}, 100);

// ── HTTP + WebSocket ──
const evalWait = new Map(); let evalN = 0;
const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (process.env.DEBUG_EVAL === '1' && url.startsWith('/eval/')) {      // (시험용) 방 계산 담당 안에서 코드 실행
    const code = url.slice(6); let body = ''; req.on('data', d => body += d); req.on('end', () => {
      const E = engines.get(code); if (!E) { res.writeHead(404); res.end('no room'); return; }
      const id = ++evalN; evalWait.set(id, v => { res.writeHead(200); res.end(v ?? 'null'); }); E.worker.postMessage({o:'eval', id, s:body});
    }); return;
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (url === '/health' || url === '/status') {
    const rooms = db.read('rooms') || {};
    res.writeHead(200, {'content-type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({ok:true, ver:GAME.ver, rooms:Object.keys(rooms).length, players:Object.values(rooms).reduce((n, r) => n + Object.keys(r.players || {}).length, 0), online:[...peers].filter(p => p.kind === 'ws').length, uptime:Math.round(process.uptime())}));
    return;
  }
  if (url === '/' || url === '/index.html') {
    if (!GAME.html) { res.writeHead(503, {'content-type':'text/plain; charset=utf-8'}); res.end('게임 파일을 아직 받지 못했습니다'); return; }
    res.writeHead(200, {'content-type':'text/html; charset=utf-8', 'cache-control':'no-cache'}); res.end(GAME.html); return;
  }
  res.writeHead(404, {'content-type':'text/plain; charset=utf-8'}); res.end('not found');
});
attach(server, '/ws', conn => {
  const p = makePeer(o => conn.send(JSON.stringify(o)), 'ws');
  p.conn = conn;
  conn.onmessage = t => { let m; try { m = JSON.parse(t); } catch { return; } if (m && typeof m.o === 'string') handle(p, m); };
  conn.onclose = () => dropPeer(p, true);
});
setInterval(() => {                                                      // 오래 조용한 연결은 정리 (브라우저는 2초마다 핑을 보냄)
  const now = Date.now();
  for (const p of peers) if (p.kind === 'ws') { const q = now - p.conn.rxAt; if (q > 45000) p.conn.close(); else if (q > 12000) p.conn.ping(); }
}, 5000);
server.listen(PORT, () => log(`서버 시작 · 포트 ${PORT} · 게임 ${GAME.ver ? 'v' + GAME.ver : '(받는 중)'}`));
process.on('uncaughtException', e => log('오류', e && e.stack || e));
