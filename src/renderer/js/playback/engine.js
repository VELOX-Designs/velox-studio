// Preview playback engine: drives <video>/<audio> elements, keeps them in sync with the
// timeline clock, routes audio through Web Audio (volume, pan, EQ, voice, echo, ducking) and
// asks the compositor for a frame every animation tick.
import { store, sourceTime, clipEnd, speedAt, evalParam } from '../core/project.js';
import { bus, fileUrl, clamp } from '../core/util.js';
import { activeVisualLayers, neededClips } from '../render/compositor.js';
import { settings } from '../core/settings.js';
import { makeReversed } from '../core/ffmpeg.js';

const LOOKAHEAD = 2.5;

class Engine {
  constructor() {
    this.playing = false;
    this.rate = 1;
    this.videos = new Map(); // clipId -> {el, src, ready}
    this.audios = new Map(); // clipId -> {el, nodes}
    this.images = new Map(); // mediaId -> HTMLImageElement
    this.reversed = new Map(); // key -> path | 'pending'
    this.ac = null;
    this.master = null;
    this.loopRange = false;
    this.compositor = null;
    this.needsRender = true;
    this.lastTick = 0;
    this.meter = { l: 0, r: 0 };
    this.scrubbing = false;
  }
  init(compositor) {
    this.compositor = compositor;
    bus.on('changed', () => { this.needsRender = true; this.syncAudioParams(); });
    bus.on('time', () => { this.needsRender = true; });
    const loop = (ts) => { this.tick(ts); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }
  audioCtx() {
    if (!this.ac) {
      this.ac = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
      this.master = this.ac.createGain();
      this.splitter = this.ac.createChannelSplitter(2);
      this.anL = this.ac.createAnalyser(); this.anR = this.ac.createAnalyser();
      this.anL.fftSize = 1024; this.anR.fftSize = 1024;
      this.master.connect(this.ac.destination);
      this.master.connect(this.splitter);
      this.splitter.connect(this.anL, 0); this.splitter.connect(this.anR, 1);
      this.meterBuf = new Float32Array(1024);
    }
    if (this.ac.state === 'suspended') this.ac.resume();
    return this.ac;
  }
  levels() {
    if (!this.anL) return [0, 0];
    const rms = (an) => { an.getFloatTimeDomainData(this.meterBuf); let m = 0; for (const v of this.meterBuf) m = Math.max(m, Math.abs(v)); return m; };
    return [rms(this.anL), rms(this.anR)];
  }
  // -------------------------------------------------------------- media path resolution (proxy aware)
  mediaSrc(m) { return (settings.useProxies !== false && m.proxyPath) ? m.proxyPath : m.path; }
  revKey(clip) { const m = store.media(clip.mediaId); return `${m.id}|${clip.in.toFixed(3)}|${(clip.dur * 1).toFixed(3)}|${clip.speed}`; }
  ensureReversed(clip) {
    const m = store.media(clip.mediaId); if (!m) return null;
    const srcLen = clip.dur * (clip.ramp ? 1 : clip.speed);
    const start = Math.max(0, clip.in - 0.5), len = Math.min(m.duration - start, srcLen + 1);
    const key = `${m.id}|${start.toFixed(3)}|${len.toFixed(3)}`;
    const r = this.reversed.get(key);
    if (r && r !== 'pending') return { path: r, start, len };
    if (!r) {
      this.reversed.set(key, 'pending');
      makeReversed(m, start, len, { height: Math.min(720, m.height || 720) }).then((p) => { this.reversed.set(key, p); this.needsRender = true; bus.emit('toast', 'Rückwärts-Vorschau bereit'); })
        .catch((e) => { console.warn(e); this.reversed.delete(key); });
    }
    return null;
  }
  // element source and time for a clip at local time lt
  elementTarget(clip, lt) {
    const m = store.media(clip.mediaId); if (!m) return null;
    let st = sourceTime(clip, lt);
    if (clip.reverse) {
      const r = this.ensureReversed(clip);
      if (r) return { src: r.path, time: clamp(r.start + r.len - st, 0, r.len - 0.001), reversedFile: true };
    }
    return { src: this.mediaSrc(m), time: clamp(st, 0, Math.max(0, (m.duration || 0) - 0.001)) };
  }
  getVideo(clip) {
    let v = this.videos.get(clip.id);
    if (!v) {
      const el = document.createElement('video');
      el.muted = true; el.preload = 'auto'; el.playsInline = true; el.crossOrigin = 'anonymous';
      el.addEventListener('seeked', () => { this.needsRender = true; });
      el.addEventListener('loadeddata', () => { this.needsRender = true; });
      el.addEventListener('error', () => bus.emit('media:error', clip.mediaId));
      if ('requestVideoFrameCallback' in el) {
        const cb = () => { this.needsRender = true; el.requestVideoFrameCallback(cb); };
        el.requestVideoFrameCallback(cb);
      }
      v = { el, src: null, frameVer: 0, lastSeek: 0 };
      this.videos.set(clip.id, v);
    }
    return v;
  }
  getImage(media) {
    let im = this.images.get(media.id);
    if (!im) {
      im = new Image(); im.decoding = 'async';
      im.onload = () => { this.needsRender = true; };
      im.src = fileUrl(media.path);
      this.images.set(media.id, im);
    }
    return im;
  }
  framesReady(t) {
    for (const L of activeVisualLayers(store.p, t)) {
      const cs = L.kind === 'transition' ? [L.a, L.b] : [L.clip];
      for (const c of cs) {
        if (!c || c.type !== 'video') continue;
        const v = this.videos.get(c.id);
        const ok = v && v.el.readyState >= 2 && !v.el.seeking;
        if (!ok && !this.compositor?.texCache.has('vid_' + c.id)) return false;
      }
    }
    return true;
  }
  // provider interface used by the compositor
  source(clip, lt) {
    const m = store.media(clip.mediaId); if (!m) return null;
    if (clip.type === 'image') {
      const im = this.getImage(m);
      if (!im.complete || !im.naturalWidth) return null;
      return { key: 'img_' + m.id, img: im, w: im.naturalWidth, h: im.naturalHeight, version: m.id };
    }
    const v = this.videos.get(clip.id);
    const key = 'vid_' + clip.id;
    // while the element seeks/decodes it has no valid frame: keep showing the last uploaded one (no black flash)
    if (!v || v.el.readyState < 2 || v.el.seeking) {
      if (this.compositor?.texCache.has(key)) return { key, img: null, w: m.width || v?.el.videoWidth || 1920, h: m.height || v?.el.videoHeight || 1080, hold: true };
      return null;
    }
    const el = v.el;
    // report source dimensions of the ORIGINAL media so proxies frame identically
    return { key: 'vid_' + clip.id, img: el, w: m.width || el.videoWidth, h: m.height || el.videoHeight, version: undefined };
  }
  // -------------------------------------------------------------- audio graph per clip
  audioClipsActive(t, lookahead = 0) {
    const tracks = store.p.tracks.filter((tr) => tr.kind === 'audio');
    const anySolo = tracks.some((tr) => tr.solo);
    return store.p.clips.filter((c) => {
      if (c.type !== 'audio') return false;
      const tr = store.track(c.trackId);
      if (!tr || tr.muted || (anySolo && !tr.solo) || c.muted) return false;
      return t + lookahead >= c.start && t < clipEnd(c);
    });
  }
  getAudio(clip) {
    let a = this.audios.get(clip.id);
    if (!a) {
      const ac = this.audioCtx();
      const el = document.createElement('audio');
      el.preload = 'auto'; el.crossOrigin = 'anonymous';
      const srcNode = ac.createMediaElementSource(el);
      const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 10;
      const low = ac.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 200;
      const mid = ac.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1500; mid.Q.value = 0.8;
      const high = ac.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 6000;
      const presence = ac.createBiquadFilter(); presence.type = 'peaking'; presence.frequency.value = 3200; presence.Q.value = 1; presence.gain.value = 0;
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = 0; comp.ratio.value = 1;
      const gain = ac.createGain();
      const pan = ac.createStereoPanner();
      const delay = ac.createDelay(1.0); delay.delayTime.value = 0.28;
      const fb = ac.createGain(); fb.gain.value = 0;
      const wet = ac.createGain(); wet.gain.value = 0;
      srcNode.connect(hp); hp.connect(low); low.connect(mid); mid.connect(high); high.connect(presence); presence.connect(comp); comp.connect(gain); gain.connect(pan); pan.connect(this.trackNode(clip.trackId).input);
      gain.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(pan);
      a = { el, src: null, trackId: clip.trackId, nodes: { hp, low, mid, high, presence, comp, gain, pan, delay, fb, wet } };
      this.audios.set(clip.id, a);
      this.applyAudioParams(clip, a);
    }
    return a;
  }
  applyAudioParams(clip, a) {
    const n = a.nodes, A = clip.audio || {};
    n.low.gain.value = A.eqLow || 0; n.mid.gain.value = A.eqMid || 0; n.high.gain.value = A.eqHigh || 0;
    n.hp.frequency.value = A.voice ? 90 : (A.denoise > 0 ? 40 + A.denoise * 80 : 10);
    n.presence.gain.value = A.voice ? 4 : 0;
    n.comp.threshold.value = A.voice ? -24 : 0; n.comp.ratio.value = A.voice ? 4 : 1;
    n.pan.pan.value = A.pan || 0;
    n.fb.gain.value = (A.echo || 0) * 0.55; n.wet.gain.value = Math.max(A.echo || 0, (A.reverb || 0) * 0.6);
    n.delay.delayTime.value = A.reverb > A.echo ? 0.06 : 0.28;
  }
  trackNode(id) {
    this.tracks ||= new Map();
    let t = this.tracks.get(id);
    if (!t) {
      const ac = this.audioCtx();
      const input = ac.createGain(), low = ac.createBiquadFilter(), mid = ac.createBiquadFilter(), high = ac.createBiquadFilter(), pan = ac.createStereoPanner(), vol = ac.createGain(), an = ac.createAnalyser();
      low.type = 'lowshelf'; low.frequency.value = 200; mid.type = 'peaking'; mid.frequency.value = 1500; mid.Q.value = 0.8; high.type = 'highshelf'; high.frequency.value = 6000; an.fftSize = 512;
      input.connect(low); low.connect(mid); mid.connect(high); high.connect(pan); pan.connect(vol); vol.connect(this.master); vol.connect(an);
      t = { input, low, mid, high, pan, vol, an, buf: new Float32Array(512) }; this.tracks.set(id, t);
      this.applyTrackParams();
    }
    return t;
  }
  applyTrackParams() {
    for (const [id, t] of this.tracks || []) { const tr = store.track(id); if (!tr) continue; t.vol.gain.value = tr.volume ?? 1; t.pan.pan.value = tr.pan || 0; t.low.gain.value = tr.eqLow || 0; t.mid.gain.value = tr.eqMid || 0; t.high.gain.value = tr.eqHigh || 0; }
  }
  trackLevel(id) { const t = this.tracks?.get(id); if (!t || !this.playing) return 0; t.an.getFloatTimeDomainData(t.buf); let m = 0; for (const v of t.buf) m = Math.max(m, Math.abs(v)); return m; }
  syncAudioParams() {
    this.applyTrackParams(); for (const [id, a] of this.audios) { const c = store.clip(id); if (c) this.applyAudioParams(c, a); } }
  clipGain(c, lt) {
    const tr = store.track(c.trackId);
    let g = evalParam(c.volume, lt) * Math.pow(10, (c.audio?.gainDb || 0) / 20);
    if (c.fadeIn > 0 && lt < c.fadeIn) g *= Math.max(0, lt / c.fadeIn);
    if (c.fadeOut > 0 && lt > c.dur - c.fadeOut) g *= Math.max(0, (c.dur - lt) / c.fadeOut);
    // ducking: lower this clip while any non-duck clip on another track with voice flag plays
    if (c.audio?.duck) {
      const t = c.start + lt;
      const voice = store.p.clips.some((o) => o.type === 'audio' && o.id !== c.id && o.audio?.voice && t >= o.start && t < clipEnd(o) && !store.track(o.trackId)?.muted);
      if (voice) g *= 0.25;
    }
    return Math.max(0, g);
  }
  // -------------------------------------------------------------- transport
  play() {
    if (this.playing) return;
    this.audioCtx();
    const dur = store.duration();
    if (store.time >= dur - 0.02) store.setTime(this.loopRange && store.p.inPoint != null ? store.p.inPoint : 0);
    this.playing = true; this.playStartWall = performance.now(); this.playStartT = store.time;
    bus.emit('play', true);
  }
  pause() {
    if (!this.playing) return;
    this.playing = false;
    for (const v of this.videos.values()) v.el.pause();
    for (const a of this.audios.values()) a.el.pause();
    store.setTime(Math.round(store.time * store.fps) / store.fps);
    bus.emit('play', false);
  }
  toggle() { this.playing ? this.pause() : this.play(); }
  setRate(r) { this.rate = r; if (this.playing) { this.playStartWall = performance.now(); this.playStartT = store.time; } bus.emit('rate', r); }
  seek(t) { store.setTime(Math.max(0, t)); if (this.playing) { this.playStartWall = performance.now(); this.playStartT = store.time; } this.needsRender = true; }
  step(frames) { this.pause(); this.seek(Math.round(store.time * store.fps + frames) / store.fps); }
  // -------------------------------------------------------------- per-frame
  tick() {
    const P = store.p;
    if (this.playing) {
      let t = this.playStartT + ((performance.now() - this.playStartWall) / 1000) * this.rate;
      const end = this.loopRange && P.outPoint != null ? P.outPoint : store.duration();
      if (this.rate < 0 && t <= 0) { t = 0; this.pause(); }
      if (t >= end) {
        if (this.loopRange && P.inPoint != null) { t = P.inPoint; this.playStartT = t; this.playStartWall = performance.now(); }
        else { t = end; this.pause(); }
      }
      store.time = t; bus.emit('time', t);
      this.needsRender = true;
    }
    const t = store.time;
    this.syncVideos(t);
    this.syncAudio(t);
    if (this.needsRender && this.compositor && this.onRender) {
      // a visible video that has never shown a frame yet → keep the previous picture instead of drawing black
      if (!this.playing && !this.framesReady(t) && (this._holdTries = (this._holdTries || 0) + 1) < 40) return;
      this._holdTries = 0; this.needsRender = this.playing; this.onRender(t);
    }
  }
  syncVideos(t) {
    const P = store.p;
    const needed = new Map();
    // current layers + lookahead for preloading
    const addLayer = (L) => {
      if (L.kind === 'transition') { needed.set(L.a.id, { clip: L.a, lt: L.ltA }); needed.set(L.b.id, { clip: L.b, lt: L.ltB }); }
      else if (L.clip.type === 'video') needed.set(L.clip.id, { clip: L.clip, lt: L.lt, active: true });
    };
    activeVisualLayers(P, t).forEach(addLayer);
    for (const n of neededClips(P, t)) if (n.clip.type === 'video' && !needed.has(n.clip.id)) needed.set(n.clip.id, { clip: n.clip, lt: n.lt, active: true });
    for (const c of P.clips) {
      if (c.type !== 'video' || needed.has(c.id)) continue;
      if (c.start > t && c.start - t < LOOKAHEAD) needed.set(c.id, { clip: c, lt: 0, preload: true });
    }
    const live = this.playing && Math.abs(this.rate) === 1 ? false : true;
    for (const [id, n] of needed) {
      const v = this.getVideo(n.clip);
      const tgt = this.elementTarget(n.clip, n.lt);
      if (!tgt) continue;
      const url = fileUrl(tgt.src);
      if (v.src !== url) { v.src = url; v.el.src = url; v.el.currentTime = tgt.time; continue; }
      const el = v.el;
      if (this.playing && !n.preload && this.rate > 0) {
        const sp = n.clip.freeze ? 0 : speedAt(n.clip, clamp(n.lt / n.clip.dur, 0, 1)) * this.rate;
        const isRevSeek = n.clip.reverse && !tgt.reversedFile;
        if (sp <= 0.06 || sp > 16 || isRevSeek) {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - tgt.time) > 0.5 / store.fps && !el.seeking) el.currentTime = tgt.time;
        } else {
          if (Math.abs(el.playbackRate - sp) > 0.01) el.playbackRate = sp;
          const drift = Math.abs(el.currentTime - tgt.time);
          if (drift > 0.25 && !el.seeking) el.currentTime = tgt.time;
          if (el.paused && el.readyState >= 2) el.play().catch(() => {});
        }
      } else {
        if (!el.paused) el.pause();
        if (n.preload) { if (Math.abs(el.currentTime - tgt.time) > 0.5 && !el.seeking) el.currentTime = tgt.time; continue; }
        if (Math.abs(el.currentTime - tgt.time) > 0.4 / store.fps) {
          if (!el.seeking) { el.currentTime = tgt.time; v.pendingSeek = null; }
          else v.pendingSeek = tgt.time;
        } else if (v.pendingSeek != null && !el.seeking) { el.currentTime = v.pendingSeek; v.pendingSeek = null; }
      }
    }
    // release elements no longer needed
    for (const [id, v] of this.videos) {
      if (!needed.has(id)) {
        const c = store.clip(id) || (store.p.sequences || []).flatMap((q) => q.clips).find((x) => x.id === id);
        if (!c || !store.clip(id) || c.start > t + LOOKAHEAD + 2 || clipEnd(c) < t - 2) { v.el.pause(); v.el.removeAttribute('src'); v.el.load(); this.videos.delete(id); this.compositor?.dropTexture('vid_' + id); }
        else if (!v.el.paused) v.el.pause();
      }
    }
  }
  syncAudio(t) {
    const active = this.playing && this.rate > 0 ? this.audioClipsActive(t, LOOKAHEAD) : [];
    const ids = new Set(active.map((c) => c.id));
    for (const c of active) {
      const a = this.getAudio(c);
      if (a.trackId !== c.trackId) { try { a.nodes.pan.disconnect(); a.nodes.pan.connect(this.trackNode(c.trackId).input); } catch {} a.trackId = c.trackId; }
      const m = store.media(c.mediaId); if (!m) continue;
      const lt = t - c.start;
      const url = fileUrl(c.audio?.bakedPath && require('fs').existsSync(c.audio.bakedPath) ? c.audio.bakedPath : m.path);
      if (a.src !== url) { a.src = url; a.el.src = url; }
      const el = a.el;
      if (lt < 0) { if (!el.paused) el.pause(); const st = sourceTime(c, 0); if (Math.abs(el.currentTime - st) > 0.2) el.currentTime = st; continue; }
      const sp = c.freeze ? 0 : speedAt(c, clamp(lt / c.dur, 0, 1)) * this.rate;
      a.nodes.gain.gain.setTargetAtTime(this.clipGain(c, lt), this.ac.currentTime, 0.015);
      if (c.reverse || sp < 0.25 || sp > 4) { if (!el.paused) el.pause(); continue; }
      el.preservesPitch = !c.audio?.pitchShift;
      if (Math.abs(el.playbackRate - sp) > 0.01) el.playbackRate = sp;
      const st = sourceTime(c, lt);
      if (Math.abs(el.currentTime - st) > 0.12 && !el.seeking) el.currentTime = st;
      if (el.paused && el.readyState >= 2) el.play().catch(() => {});
    }
    for (const [id, a] of this.audios) {
      if (!ids.has(id)) {
        if (!a.el.paused) a.el.pause();
        const c = store.clip(id);
        if (!c) { a.el.removeAttribute('src'); try { a.nodes.pan.disconnect(); } catch {} this.audios.delete(id); }
      }
    }
  }
  // scrub audio blip when dragging playhead
  scrubAudio(t) {
    const cs = this.audioClipsActive(t, 0); if (!cs.length) return;
    for (const c of cs.slice(0, 3)) {
      const a = this.getAudio(c); const m = store.media(c.mediaId); if (!m) continue;
      const url = fileUrl(c.audio?.bakedPath && require('fs').existsSync(c.audio.bakedPath) ? c.audio.bakedPath : m.path); if (a.src !== url) { a.src = url; a.el.src = url; }
      a.el.currentTime = sourceTime(c, t - c.start);
      a.nodes.gain.gain.value = this.clipGain(c, t - c.start);
      a.el.play().catch(() => {});
      clearTimeout(a.scrubT); a.scrubT = setTimeout(() => { if (!this.playing) a.el.pause(); }, 90);
    }
  }
}
export const engine = new Engine();
