// 방 하나의 게임 계산 담당 (별도 스레드) · 브라우저와 똑같은 게임 코드를 화면 없이 돌림
'use strict';
const {parentPort, workerData} = require('worker_threads');
const vm = require('vm');
const {makeWindow} = require('./stub');
const {code, uid, html, tick} = workerData;

const send = o => parentPort.postMessage(o);
let handler = null;
const inbox = [];
const safe = (f, m) => { try { f(m); } catch (e) { send({o:'log', t:'처리 오류: ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)}); } };
parentPort.on('message', m => {
  if (m && m.o === 'eval') { let v; try { v = W.__ev(m.s); } catch (e) { v = 'ERR ' + e.message; } try { v = JSON.stringify(v); } catch { v = String(v); } send({o:'evalr', id:m.id, v}); return; }   // (시험용)
  if (handler) safe(handler, m); else inbox.push(m);
});
process.on('uncaughtException', e => send({o:'log', t:'오류(계속 진행): ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)}));
process.on('unhandledRejection', e => send({o:'log', t:'오류(계속 진행): ' + (e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e)}));

let warnN = 0, warnT = 0;
const quiet = {                                                           // 게임 안의 console 출력은 서버 기록으로 (너무 많으면 줄임)
  log() {}, info() {}, debug() {},
  warn: (...a) => { const now = Date.now(); if (now - warnT > 60000) { warnT = now; warnN = 0; } if (warnN++ < 8) send({o:'log', t:'경고: ' + a.map(x => x && x.stack ? x.stack.split('\n').slice(0, 3).join(' | ') : String(x)).join(' ').slice(0, 600)}); },
  error: (...a) => send({o:'log', t:'오류: ' + a.map(x => x && x.stack ? x.stack.split('\n').slice(0, 4).join(' | ') : String(x)).join(' ').slice(0, 800)}),
};
const step = Math.max(10, Math.round(1000 / (tick || 60)));
const W = makeWindow({
  console: quiet,
  requestAnimationFrame: cb => setTimeout(() => cb(performance.now()), step),
  __srv: {code, uid, send, onMessage: f => { handler = f; for (const m of inbox.splice(0)) safe(f, m); }},
});
const a = html.indexOf('<script>'), b = html.lastIndexOf('</script>');
const src = html.slice(a + 8, b).replace('\nrequestAnimationFrame(loop);\n', '\nrequestAnimationFrame(loop);window.__ev=s=>eval(s);\n');
vm.createContext(W);
try { vm.runInContext(src, W, {filename:'game.js'}); }
catch (e) { send({o:'log', t:'게임 코드 실행 실패: ' + (e && e.stack || e)}); process.exit(1); }
if (!W.__ev) { send({o:'log', t:'게임 코드 연결 지점을 찾지 못했습니다'}); process.exit(1); }
W.__ev('mpSrvBoot()').catch(e => { send({o:'log', t:'방 연결 실패: ' + (e && e.stack || e)}); process.exit(1); });
