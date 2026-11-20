// Render cache ("Vorschau rendern"): heavy timeline parts are rendered in the background at preview size
// (own WebGL compositor + FFmpeg frame readers, so the live preview is not disturbed) and stored as WebP.
// Playback shows cached frames instead of compositing live → smooth even with many effects / 4K.
// Every frame carries a signature of everything visible at that moment; any edit invalidates exactly the
// frames it touches (green bar in the timeline ruler = cached).
import { store, clipEnd } from '../core/project.js';
import { bus } from '../core/util.js';
import { settings, setSetting } from '../core/settings.js';
import { Compositor } from '../render/compositor.js';

function hash(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }

class RenderCache {
  constructor() {
    this.frames = new Map(); // frame index -> { sig, blob }
    this.bitmaps = new Map(); // frame index -> ImageBitmap (decoded ahead during playback)
    this.decoding = new Set();
    this.bytes = 0; this.segs = null; this.size = [0, 0];
    this.job = null; this.idleT = null; this.rangesCache = null;
    this.hits = 0; this.misses = 0;
  }
  get enabled() { return settings.renderCache !== false; }
  get limit() { return (settings.renderCacheMB || 1500) * 1e6; }
  init(previewCanvas) {
    this.preview = previewCanvas;
    bus.on('changed', () => { this.segs = null; this.rangesCache = null; this.cancel(); this.scheduleIdle(); });
    bus.on('play', (on) => { if (on) this.cancel(); else this.scheduleIdle(); });
    bus.on('time', () => { if (!this.playing()) { this.cancel(); this.scheduleIdle(); } });
    bus.on('export:start', () => { window.__exporting = true; this.cancel(); });
    bus.on('export:end', () => { window.__exporting = false; this.scheduleIdle(); });
    // the user always wins: any input pauses background rendering, it resumes after a quiet moment
    const poke = () => { this.lastInput = performance.now(); if (this.job?.auto) this.cancel(); if (!this.playing()) this.scheduleIdle(); };
    for (const ev of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, poke, { capture: true, passive: true });
  }
  // encoder pool: WebP encoding runs in workers (off the UI thread, in parallel)
  encoder() {
    if (this.pool) return this.pool;
    const src = 'onmessage = async (e) => { const { id, bm, q } = e.data; try { const c = new OffscreenCanvas(bm.width, bm.height); c.getContext("2d").drawImage(bm, 0, 0); bm.close(); postMessage({ id, b: await c.convertToBlob({ type: "image/webp", quality: q }) }); } catch (err) { postMessage({ id, err: String(err) }); } };';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const n = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) >> 1));
    const waits = new Map(); let seq = 0, rr = 0;
    const ws = Array.from({ length: n }, () => { const w = new Worker(url); w.onmessage = (e) => { const f = waits.get(e.data.id); waits.delete(e.data.id); f?.(e.data.b || null); }; return w; });
    this.pool = { size: n, encode: (bm) => new Promise((res) => { const id = ++seq; waits.set(id, res); ws[rr++ % n].postMessage({ id, bm, q: 0.82 }, [bm]); }) };
    return this.pool;
  }
  playing() { return !!this.engine?.playing; }
  // ---------------------------------------------------------------- signatures
  segments(P = store.p, size = this.size) {
    if (P === store.p && this.segs && this.segs.size === size.join('x')) return this.segs;
    const visual = P.clips.filter((c) => c.type !== 'audio');
    const vtr = P.tracks.filter((t) => t.kind === 'video');
    const global = hash(JSON.stringify([P.settings.width, P.settings.height, P.settings.bg, P.settings.fps, size, vtr.map((t) => [t.id, t.hidden, t.muted, t.solo, t.opacity, t.blend]),
      visual.some((c) => c.type === 'compound' || c.type === 'multicam') ? P.sequences : 0, P.camera || 0]));
    const ch = new Map();
    const msig = (id) => { const m = P.media.find((x) => x.id === id); return m ? m.path + (m.proxyPath ? '|px' : '') : ''; };
    for (const c of visual) ch.set(c.id, hash(JSON.stringify(c) + JSON.stringify(P.transitions.filter((t) => t.a === c.id || t.b === c.id)) + msig(c.mediaId)));
    const pts = new Set([0]); for (const c of visual) { pts.add(c.start); pts.add(clipEnd(c)); }
    for (const t of P.transitions) { const a = P.clips.find((c) => c.id === t.a); if (a) { pts.add(clipEnd(a) - (t.dur || 0)); pts.add(clipEnd(a) + (t.dur || 0)); } }
    const b = [...pts].filter((x) => x >= 0).sort((x, y) => x - y);
    const list = [];
    for (let i = 0; i < b.length; i++) {
      const a = b[i], e = b[i + 1] ?? a + 1e9, mid = e > a + 1e8 ? a + 0.5 : (a + e) / 2;
      const act = visual.filter((c) => c.start <= mid && clipEnd(c) > mid).map((c) => ch.get(c.id)).sort();
      list.push({ a, e, sig: act.length ? hash(global + act.join('|')) : 'empty' });
    }
    const out = { size: size.join('x'), list };
    if (P === store.p) this.segs = out;
    return out;
  }
  sigAt(t, segs = this.segments()) {
    const l = segs.list; let lo = 0, hi = l.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (l[m].a <= t + 1e-6) lo = m; else hi = m - 1; }
    return l[lo]?.sig;
  }
  valid(fi) { const e = this.frames.get(fi); return !!e && e.sig === this.sigAt(fi / store.fps); }
  // ---------------------------------------------------------------- playback side
  // returns an ImageBitmap for the frame at time t (null = render live); decodes a few frames ahead
  frameFor(t) {
    if (!this.enabled || !this.frames.size) return null;
    const fps = store.fps, fi = Math.round(t * fps);
    if (this.size[0] !== this.preview?.width || this.size[1] !== this.preview?.height) return null;
    for (let k = 0; k < 10; k++) this.decode(fi + k);
    for (const [k, bm] of this.bitmaps) if (k < fi - 2 || k > fi + 30) { bm.close?.(); this.bitmaps.delete(k); }
    const bm = this.valid(fi) ? this.bitmaps.get(fi) : null;
    if (bm) this.hits++; else if (this.frames.has(fi)) this.misses++;
    return bm || null;
  }
  decode(fi) {
    if (this.bitmaps.has(fi) || this.decoding.has(fi) || !this.valid(fi)) return;
    this.decoding.add(fi);
    createImageBitmap(this.frames.get(fi).blob).then((bm) => { this.bitmaps.set(fi, bm); }).catch(() => {}).finally(() => this.decoding.delete(fi));
  }
  // ---------------------------------------------------------------- render side
  cancel() { if (this.job) { this.job.cancelled = true; this.job = null; } clearTimeout(this.idleT); }
  scheduleIdle() {
    clearTimeout(this.idleT);
    if (!this.enabled || settings.renderCacheAuto === false) return;
    this.idleT = setTimeout(() => {
      if (this.playing() || this.job || window.__exporting) return;
      if (store.p.media.some((m) => m._proxying)) { this.scheduleIdle(); return; } // proxies first – decoding the originals would be slow
      if (performance.now() - (this.lastInput || 0) < 1500) { this.scheduleIdle(); return; }
      this.renderRange(null, null, { auto: true }).catch((e) => console.warn('render cache', e));
    }, 1500);
  }
  store(fi, sig, blob) {
    const old = this.frames.get(fi); if (old) this.bytes -= old.blob.size;
    this.frames.set(fi, { sig, blob }); this.bytes += blob.size; this.rangesCache = null;
    if (this.bytes > this.limit) this.evict(fi);
  }
  evict(keep) {
    const segs = this.segments(); const now = Math.round(store.time * store.fps);
    const entries = [...this.frames.entries()].map(([fi, e]) => [fi, e.sig !== this.sigAt(fi / store.fps, segs) ? -1 : Math.abs(fi - now)]).sort((a, b) => (a[1] < 0 ? -1 : b[1] < 0 ? 1 : b[1] - a[1]));
    for (const [fi] of entries) { if (this.bytes <= this.limit * 0.85) break; if (fi === keep) continue; this.bytes -= this.frames.get(fi).blob.size; this.frames.delete(fi); }
  }
  clear() { this.cancel(); this.frames.clear(); for (const b of this.bitmaps.values()) b.close?.(); this.bitmaps.clear(); this.bytes = 0; this.rangesCache = null; bus.emit('rendercache'); }
  // cached ranges (seconds) for the timeline bar
  ranges() {
    if (this.rangesCache) return this.rangesCache;
    const fps = store.fps; const segs = this.segments(); const out = []; let run = null;
    for (const fi of [...this.frames.keys()].sort((a, b) => a - b)) {
      if (this.frames.get(fi).sig !== this.sigAt(fi / fps, segs)) continue;
      if (run && fi === run[1] + 1) run[1] = fi; else { if (run) out.push(run); run = [fi, fi]; }
    }
    if (run) out.push(run);
    return (this.rangesCache = out.map(([a, b]) => [a / fps, (b + 1) / fps]));
  }
  async renderRange(a, b, { auto = false, onProgress } = {}) {
    if (!this.enabled || !this.preview) return 0;
    this.cancel();
    const job = (this.job = { cancelled: false, auto });
    const P = JSON.parse(JSON.stringify(store.p)); const fps = P.settings.fps || store.fps;
    const W = this.preview.width, H = this.preview.height;
    if (this.size[0] !== W || this.size[1] !== H) { this.frames.clear(); this.bytes = 0; this.size = [W, H]; this.segs = null; }
    const dur = store.duration(); if (!(dur > 0)) { this.job = null; return 0; }
    a = Math.max(0, a ?? (P.inPoint != null && !auto ? P.inPoint : 0)); b = Math.min(dur, b ?? (P.outPoint != null && !auto ? P.outPoint : dur));
    const segs = this.segments(P, [W, H]);
    // render order: from the playhead forward, then the part before it
    const f0 = Math.floor(a * fps), f1 = Math.ceil(b * fps), now = Math.min(f1, Math.max(f0, Math.round(store.time * fps)));
    const todo = []; for (let f = now; f < f1; f++) todo.push(f); for (let f = f0; f < now; f++) todo.push(f);
    const need = todo.filter((f) => { const s = this.sigAt(f / fps, segs); return s !== 'empty' && this.frames.get(f)?.sig !== s; });
    if (!need.length) { this.job = null; return 0; }
    const { ExportProvider } = await import('../ui/exporter.js');
    const cv = (this.cv ||= document.createElement('canvas'));
    const comp = (this.comp ||= new Compositor(cv, { preserve: true }));
    comp.setSize(W, H);
    const useProxy = settings.useProxies !== false;
    let prov = new ExportProvider(P, W, H, { proxy: useProxy });
    const pool = this.encoder(); const inflight = new Set();
    let done = 0, last = -2;
    try {
      if (P.clips.some((c) => c.reverse && c.type === 'video')) await prov.prepareReverse();
      for (const f of need) {
        if (job.cancelled) break;
        if (f !== last + 1) { prov.close(); const rv = prov.reversed; prov = new ExportProvider(P, W, H, { proxy: useProxy }); prov.reversed = rv; } // jump → fresh readers
        last = f;
        const t = f / fps;
        await prov.prepare(t);
        if (job.cancelled) break;
        comp.renderFrame(P, t, prov);
        const bm = await createImageBitmap(cv);
        const sig = this.sigAt(t, segs);
        const pr = pool.encode(bm).then((blob) => { inflight.delete(pr); if (blob && !job.cancelled) { this.store(f, sig, blob); done++; onProgress?.(done / need.length); if (done % 10 === 0) bus.emit('rendercache'); } });
        inflight.add(pr);
        if (inflight.size >= pool.size * 2) await Promise.race(inflight);
        await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
      }
      await Promise.all(inflight);
    } finally { prov.close(); if (this.job === job) this.job = null; bus.emit('rendercache'); }
    return done;
  }
  stats() { const r = this.ranges(); return { frames: this.frames.size, mb: +(this.bytes / 1e6).toFixed(1), cachedSeconds: +r.reduce((s, [a, b]) => s + b - a, 0).toFixed(2), ranges: r, size: this.size, rendering: !!this.job, hits: this.hits, misses: this.misses, enabled: this.enabled, auto: settings.renderCacheAuto !== false }; }
  setEnabled(on) { setSetting('renderCache', !!on); if (!on) this.clear(); else this.scheduleIdle(); bus.emit('rendercache'); }
}
export const renderCache = new RenderCache();

// ------------------------------------------------------------------ commands
import { registerCommands } from '../core/commands.js';
import { L } from '../core/i18n.js';
import { toast, progressModal } from '../ui/dialogs.js';
registerCommands([
  { id: 'renderPreview', name: { de: 'Vorschau rendern (flüssig abspielen)', en: 'Render preview (smooth playback)' }, cat: 'timeline', key: 'Ctrl+Enter', args: '{ start?, end? }', run: async ({ start, end } = {}) => {
    if (!renderCache.enabled) renderCache.setEnabled(true);
    const pm = progressModal(L('Rendere Vorschau…', 'Rendering preview…')); let cancelled = false; pm.onCancel(() => { cancelled = true; renderCache.cancel(); });
    const t0 = performance.now();
    try { const n = await renderCache.renderRange(start ?? null, end ?? null, { onProgress: (p) => pm.set(p, `${Math.round(p * 100)} %`) }); if (!cancelled) toast(n ? L(`Vorschau gerendert (${n} Bilder, ${((performance.now() - t0) / 1000).toFixed(1)} s) – grüner Balken = läuft flüssig`, `Preview rendered (${n} frames)`) : L('Schon alles gerendert ✓', 'Already rendered ✓'), 'ok'); return renderCache.stats(); }
    finally { pm.close(); }
  } },
  { id: 'clearRenderCache', name: { de: 'Render-Cache leeren', en: 'Clear render cache' }, cat: 'timeline', run: () => { renderCache.clear(); toast(L('Render-Cache geleert', 'Render cache cleared')); } },
  { id: 'toggleRenderCacheAuto', name: { de: 'Hintergrund-Rendern an/aus', en: 'Background rendering on/off' }, cat: 'timeline', run: () => { const on = settings.renderCacheAuto === false; setSetting('renderCacheAuto', on); if (on) renderCache.scheduleIdle(); else renderCache.cancel(); toast(on ? L('Hintergrund-Rendern an: VELOX rendert in Pausen automatisch vor', 'Background rendering on') : L('Hintergrund-Rendern aus', 'Background rendering off')); return on; } },
  { id: 'renderCacheStats', name: { de: 'Render-Cache Status (API)', en: 'Render cache stats (API)' }, cat: 'timeline', hidden: true, run: () => renderCache.stats() },
]);
