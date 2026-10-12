// 화면 없는 서버에서 게임 스크립트를 돌리기 위한 가짜 브라우저 (DOM · 캔버스 · 저장소 대역)
'use strict';
const FALSY = new Set(['hidden', 'disabled', 'checked', 'open', 'complete', 'naturalWidth', 'naturalHeight', 'scrollTop', 'scrollLeft', 'offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'width', 'height', 'length', 'value', 'textContent', 'innerHTML', 'innerText', 'src', 'id', 'className', 'tagName', 'nodeName', 'files', 'parentNode', 'parentElement', 'firstChild', 'lastChild', 'nextSibling', 'previousSibling', 'firstElementChild', 'nextElementSibling', 'dataset', 'selectedIndex', 'readyState']);
const ZERO = new Set(['width', 'height', 'naturalWidth', 'naturalHeight', 'scrollTop', 'scrollLeft', 'offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'length', 'selectedIndex']);
const NULLS = new Set(['parentNode', 'parentElement', 'firstChild', 'lastChild', 'nextSibling', 'previousSibling', 'firstElementChild', 'nextElementSibling', 'files']);
const STRS = new Set(['value', 'textContent', 'innerHTML', 'innerText', 'src', 'id', 'className', 'tagName', 'nodeName', 'readyState']);
function stub(name = 'stub') {
  const store = Object.create(null);
  const fn = function () { return stub(name + '()'); };
  return new Proxy(fn, {
    get(t, k) {
      if (k in store) return store[k];
      if (k === Symbol.toPrimitive) return h => h === 'number' ? 0 : '';
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;                                          // (await 해도 멈추지 않게)
      if (k === 'toString' || k === 'valueOf') return () => '';
      if (k === 'toJSON') return () => null;
      if (typeof k === 'symbol') return undefined;
      if (k === 'hidden') return true;                                             // (화면 요소는 모두 숨겨진 것으로)
      if (k === 'disabled' || k === 'checked' || k === 'open') return false;
      if (ZERO.has(k)) return 0;
      if (NULLS.has(k)) return null;
      if (STRS.has(k)) return '';
      if (k === 'dataset' || k === 'style') return store[k] = {setProperty() {}, removeProperty() {}};
      if (k === 'classList') return store[k] = {add() {}, remove() {}, toggle() { return false; }, contains() { return false; }};
      if (k === 'getContext') return () => stub('ctx');
      if (k === 'measureText') return () => ({width:0});
      if (k === 'getImageData' || k === 'createImageData') return (x, y, w = 1, h = 1) => ({data:new Uint8ClampedArray(Math.max(4, (w | 0) * (h | 0) * 4)), width:w, height:h});
      if (k === 'querySelectorAll' || k === 'getElementsByClassName' || k === 'getElementsByTagName') return () => [];
      if (k === 'getBoundingClientRect') return () => ({left:0, top:0, right:0, bottom:0, width:0, height:0, x:0, y:0});
      if (k === 'toDataURL') return () => 'data:,';
      if (k === 'closest' || k === 'querySelector') return () => null;
      if (k === 'contains' || k === 'matches' || k === 'hasAttribute') return () => false;
      if (k === 'getAttribute') return () => null;
      return stub(name + '.' + String(k));
    },
    set(t, k, v) { store[k] = v; return true; },
    has() { return true; },
    apply() { return stub(name + '()'); },
    construct() { return stub('new ' + name); },
  });
}
function makeWindow(extra = {}) {
  const ls = new Map();
  const localStorage = {getItem: k => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)), removeItem: k => ls.delete(k), clear: () => ls.clear(), key: i => [...ls.keys()][i] ?? null, get length() { return ls.size; }};
  const els = new Map();
  const el = id => { let e = els.get(id); if (!e) els.set(id, e = stub('#' + id)); return e; };
  const document = stub('document');
  document.getElementById = el;
  document.createElement = tag => stub('<' + tag + '>');
  document.querySelector = () => null;
  document.querySelectorAll = () => [];
  document.hidden = false;
  document.visibilityState = 'visible';
  document.body = stub('body'); document.head = stub('head'); document.documentElement = stub('html');
  document.fonts = {ready:Promise.resolve(), load: () => Promise.resolve([]), check: () => true, add() {}};
  const raf = cb => setTimeout(() => cb(performance.now()), 16);
  const W = {
    document, localStorage, sessionStorage: localStorage,
    navigator: {userAgent:'node-server', maxTouchPoints:0, language:'ko', vibrate() {}, locks:null, clipboard:{writeText: async () => {}}},
    location: {href:'https://server.local/', search:'', hash:'', protocol:'https:', host:'server.local', origin:'https://server.local', reload() {}},
    innerWidth:1280, innerHeight:720, devicePixelRatio:1, screen:{width:1280, height:720, orientation:{lock: async () => {}}},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    requestAnimationFrame: raf, cancelAnimationFrame: id => clearTimeout(id),
    matchMedia: () => ({matches:false, addEventListener() {}, addListener() {}}),
    getComputedStyle: () => stub('style'),
    Image: function () { return stub('img'); }, Audio: function () { return stub('audio'); },
    AudioContext: undefined, webkitAudioContext: undefined,
    Worker: undefined, BroadcastChannel: undefined, RTCPeerConnection: undefined,
    HTMLCanvasElement: function () {}, CanvasRenderingContext2D: function () {}, CanvasGradient: function () {}, Node: function () {}, ImageBitmap: undefined, OffscreenCanvas: undefined,
    Path2D: function () { return stub('path'); }, DOMMatrix: function () { return stub('matrix'); },
    FontFace: function () { return {load: () => Promise.resolve(this)}; },
    ResizeObserver: function () { return {observe() {}, disconnect() {}}; },
    MutationObserver: function () { return {observe() {}, disconnect() {}}; },
    IntersectionObserver: function () { return {observe() {}, disconnect() {}}; },
    URL: Object.assign(function (u) { return new URL(u); }, {createObjectURL: () => 'blob:x', revokeObjectURL() {}}),
    Blob: function () {}, alert() {}, confirm: () => false, prompt: () => null,
    open: () => null, scrollTo() {}, focus() {}, blur() {},
    fetch: async () => { throw new Error('no fetch on server'); },
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, performance,
    TextEncoder, TextDecoder, structuredClone, crypto: globalThis.crypto, atob, btoa,
    ...extra,
  };
  W.window = W; W.self = W; W.globalThis = W; W.top = W; W.parent = W;
  return W;
}
module.exports = {stub, makeWindow};
