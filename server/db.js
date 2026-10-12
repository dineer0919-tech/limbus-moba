// 메모리 안의 작은 실시간 데이터베이스 (Firebase Realtime Database와 같은 모양으로 동작)
'use strict';
const parts = p => String(p || '').split('/').filter(Boolean);
const norm = p => parts(p).join('/');
const related = (a, b) => a === b || !a || !b || a.startsWith(b + '/') || b.startsWith(a + '/');
function clean(v) {                                                    // null 칸 · 빈 객체는 지움 (Firebase와 같게)
  if (v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) { const a = v.map(clean); return a.length ? a : null; }
  const o = {}; let any = false;
  for (const k in v) { const c = clean(v[k]); if (c !== null) { o[k] = c; any = true; } }
  return any ? o : null;
}

class DB {
  constructor() { this.root = {}; this.subs = new Map(); this.dirty = new Set(); this.pending = false; this.sidN = 0; this.onWrite = null; }
  read(p) { let o = this.root; for (const k of parts(p)) { if (o === null || typeof o !== 'object') return null; o = o[k]; if (o === undefined) return null; } return o === undefined ? null : o; }
  get(p) { const v = this.read(p); return v === null ? null : JSON.parse(JSON.stringify(v)); }
  write(p, v) {
    const ks = parts(p); v = clean(v);
    if (!ks.length) { this.root = v && typeof v === 'object' ? v : {}; this._mark(''); return; }
    if (v === null) {                                                    // 지우기 + 비게 된 부모도 정리
      const chain = [this.root]; let o = this.root;
      for (let i = 0; i < ks.length - 1; i++) { o = o && typeof o === 'object' ? o[ks[i]] : undefined; if (o === undefined || o === null || typeof o !== 'object') { this._mark(norm(p)); return; } chain.push(o); }
      if (o && typeof o === 'object') delete o[ks[ks.length - 1]];
      for (let i = chain.length - 1; i > 0; i--) { const c = chain[i]; if (c && typeof c === 'object' && !Object.keys(c).length) delete chain[i - 1][ks[i - 1]]; else break; }
    } else {
      let o = this.root;
      for (let i = 0; i < ks.length - 1; i++) { if (!o[ks[i]] || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
      o[ks[ks.length - 1]] = v;
    }
    this._mark(norm(p));
  }
  update(p, obj) { for (const k in obj) this.write(norm(p) + '/' + k, obj[k]); }
  cas(p, exp, v) { const cur = JSON.stringify(this.read(p)); if (cur !== exp) return {ok:false, v:this.get(p)}; this.write(p, v); return {ok:true, v:this.get(p)}; }
  push(p, v) { const k = Date.now().toString(36) + (++this.sidN).toString(36).padStart(5, '0') + Math.random().toString(36).slice(2, 5); this.write(norm(p) + '/' + k, v); return k; }
  sub(p, cb, child = false) { const id = ++this.sidN, s = {p:norm(p), cb, child, last:undefined}; this.subs.set(id, s); this._fire(s); return id; }
  unsub(id) { this.subs.delete(id); }
  _mark(p) { this.dirty.add(p); if (this.onWrite) this.onWrite(p); if (!this.pending) { this.pending = true; setImmediate(() => this._flush()); } }
  _flush() {
    this.pending = false; const d = [...this.dirty]; this.dirty.clear();
    for (const s of [...this.subs.values()]) if (d.some(p => related(p, s.p))) this._fire(s);
  }
  _fire(s) {
    const v = this.read(s.p);
    if (s.child) {                                                       // 새로 생긴 자식만 차례대로 넘기고 지움
      if (!v || typeof v !== 'object') return;
      const ks = Object.keys(v).sort();
      for (const k of ks) { const c = v[k]; this.write(s.p + '/' + k, null); try { s.cb(c); } catch (e) { console.error('[db] child cb', e); } }
      return;
    }
    const j = JSON.stringify(v);
    if (j === s.last) return; s.last = j;
    try { s.cb(v === null ? null : JSON.parse(j)); } catch (e) { console.error('[db] cb', e); }
  }
  openRooms(f) { const r = this.read('rooms') || {}, o = {}; let n = 0; for (const k in r) if (r[k] && r[k][f] === true && n++ < 20) o[k] = JSON.parse(JSON.stringify(r[k])); return o; }
}
module.exports = {DB, norm, parts};
