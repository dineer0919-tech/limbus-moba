// 아주 작은 WebSocket 서버 (외부 패키지 없이 Node 기본 기능만 사용) · 텍스트 메시지 전용
'use strict';
const crypto = require('crypto');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 4 * 1024 * 1024;

function frame(op, payload) {
  const n = payload.length;
  let head;
  if (n < 126) { head = Buffer.alloc(2); head[1] = n; }
  else if (n < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(n, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeBigUInt64BE(BigInt(n), 2); }
  head[0] = 0x80 | op;
  return Buffer.concat([head, payload]);
}

class Conn {
  constructor(sock, req) {
    this.sock = sock; this.req = req; this.open = true; this.buf = Buffer.alloc(0); this.frag = null; this.fragOp = 0;
    this.onmessage = null; this.onclose = null; this.alive = true; this.rxAt = Date.now();
    sock.setNoDelay(true);
    sock.on('data', d => this._data(d));
    sock.on('close', () => this._closed());
    sock.on('error', () => this._closed());
  }
  get bufferedAmount() { return this.sock.writableLength || 0; }
  send(text) { if (!this.open) return; try { this.sock.write(frame(1, Buffer.from(text, 'utf8'))); } catch { this._closed(); } }
  ping() { if (this.open) try { this.sock.write(frame(9, Buffer.alloc(0))); } catch {} }
  close(code = 1000) { if (!this.open) return; const b = Buffer.alloc(2); b.writeUInt16BE(code, 0); try { this.sock.write(frame(8, b)); this.sock.end(); } catch {} this._closed(); }
  _closed() { if (!this.open) return; this.open = false; try { this.sock.destroy(); } catch {} if (this.onclose) this.onclose(); }
  _data(d) {
    this.rxAt = Date.now();
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; const big = b.readBigUInt64BE(2); if (big > BigInt(MAX_MSG)) return this.close(1009); len = Number(big); off = 10; }
      if (len > MAX_MSG) return this.close(1009);
      if (!masked) return this.close(1002);                                          // 브라우저가 보내는 건 항상 가려져(mask) 있어야 함
      if (b.length < off + 4 + len) return;
      const mask = b.subarray(off, off + 4), data = Buffer.from(b.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(off + 4 + len);
      this.alive = true;
      if (op === 8) { this.close(); return; }
      if (op === 9) { try { this.sock.write(frame(10, data)); } catch {} continue; }
      if (op === 10) continue;
      if (op === 0) { if (!this.frag) continue; this.frag.push(data); if (fin) { const all = Buffer.concat(this.frag); this.frag = null; if (this.fragOp === 1) this._emit(all); } continue; }
      if (op === 1 || op === 2) { if (!fin) { this.frag = [data]; this.fragOp = op; continue; } if (op === 1) this._emit(data); }
    }
  }
  _emit(data) { if (this.onmessage) { try { this.onmessage(data.toString('utf8')); } catch (e) { console.error('[ws] handler', e); } } }
}

function attach(server, path, onConn) {
  server.on('upgrade', (req, sock) => {
    const url = (req.url || '').split('?')[0];
    const key = req.headers['sec-websocket-key'];
    if (url !== path || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { sock.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    onConn(new Conn(sock, req));
  });
}
module.exports = {attach};
