// Shape / graphic clips (rectangles, arrows, stars, lower thirds, progress bars, callouts…) with animation.
import { EASINGS } from '../core/keyframes.js';

export const SHAPE_KINDS = {
  rect: { de: 'Rechteck', en: 'Rectangle' }, circle: { de: 'Kreis / Ellipse', en: 'Circle / ellipse' }, line: { de: 'Linie', en: 'Line' }, arrow: { de: 'Pfeil', en: 'Arrow' },
  star: { de: 'Stern', en: 'Star' }, polygon: { de: 'Vieleck', en: 'Polygon' }, triangle: { de: 'Dreieck', en: 'Triangle' }, heart: { de: 'Herz', en: 'Heart' },
  bubble: { de: 'Sprechblase', en: 'Speech bubble' }, lowerthird: { de: 'Bauchbinde (Lower Third)', en: 'Lower third' }, progress: { de: 'Fortschrittsbalken', en: 'Progress bar' },
  ring: { de: 'Ring / Kreisfortschritt', en: 'Ring / radial progress' }, cross: { de: 'Kreuz / X', en: 'Cross / X' }, check: { de: 'Haken', en: 'Check mark' }, bracket: { de: 'Fokus-Rahmen', en: 'Focus brackets' },
};
export const SHAPE_ANIMS = { none: { de: 'Keine', en: 'None' }, pop: { de: 'Pop', en: 'Pop' }, fade: { de: 'Einblenden', en: 'Fade' }, draw: { de: 'Zeichnen (Kontur)', en: 'Draw on' }, wipe: { de: 'Wischen', en: 'Wipe' }, grow: { de: 'Wachsen', en: 'Grow' }, slide: { de: 'Reinfliegen', en: 'Slide in' }, spin: { de: 'Drehen', en: 'Spin in' } };

export function defaultShape(kind = 'rect') {
  return { kind, w: 600, h: 300, radius: 24, fill: '#7c5cff', fill2: '', gradAngle: 90, stroke: 0, strokeColor: '#ffffff', lineWidth: 12, points: 5, inner: 0.45, progress: 1, anim: 'pop', animOut: 'fade', animDur: 0.5, shadow: 0.3, label: '', labelColor: '#ffffff', accent: '#22d3ee' };
}

export class ShapeRenderer {
  constructor() { this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d'); }
  render(s, lt, dur, W, H, scale = 1) {
    const c = this.canvas; if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = this.ctx; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H);
    const ad = Math.max(0.05, s.animDur || 0.5);
    const pin = Math.min(1, Math.max(0, lt / ad)), pout = s.animOut && s.animOut !== 'none' ? Math.min(1, Math.max(0, (lt - (dur - ad)) / ad)) : 0;
    const eo = EASINGS.easeOut(pin), bo = EASINGS.backOut(pin);
    let a = 1, sc = 1, rot = 0, dx = 0, draw = 1, wipe = 1;
    switch (s.anim) { case 'pop': sc = 0.2 + 0.8 * bo; a = Math.min(1, pin * 3); break; case 'fade': a = eo; break; case 'draw': draw = eo; break; case 'wipe': wipe = eo; break; case 'grow': sc = eo; break; case 'slide': dx = -(1 - eo) * W * 0.6; a = eo; break; case 'spin': rot = (1 - eo) * -180; sc = eo; break; }
    if (pout > 0) { if (s.animOut === 'fade') a *= 1 - pout; else if (s.animOut === 'pop') sc *= 1 - EASINGS.easeIn(pout); else if (s.animOut === 'wipe') wipe *= 1 - pout; else if (s.animOut === 'slide') dx += EASINGS.easeIn(pout) * W * 0.6; else a *= 1 - pout; }
    if (a <= 0.001 || sc <= 0.001) return c;
    const w = s.w * scale, h = s.h * scale, k = scale;
    g.save(); g.globalAlpha = a; g.translate(W / 2 + dx, H / 2); g.rotate((rot * Math.PI) / 180); g.scale(sc, sc);
    if (wipe < 1) { g.beginPath(); g.rect(-w / 2 - 50 * k, -h / 2 - 50 * k, (w + 100 * k) * wipe, h + 100 * k); g.clip(); }
    let fill = s.fill;
    if (s.fill2) { const an = ((s.gradAngle || 0) * Math.PI) / 180; const r = Math.max(w, h) / 2; const gr = g.createLinearGradient(-Math.cos(an) * r, -Math.sin(an) * r, Math.cos(an) * r, Math.sin(an) * r); gr.addColorStop(0, s.fill); gr.addColorStop(1, s.fill2); fill = gr; }
    if (s.shadow > 0) { g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 30 * k * s.shadow; g.shadowOffsetY = 10 * k * s.shadow; }
    const path = new Path2D(); let strokeOnly = false;
    const kind = s.kind;
    if (kind === 'rect' || kind === 'lowerthird') roundRect(path, -w / 2, -h / 2, w, h, Math.min(s.radius * k, w / 2, h / 2));
    else if (kind === 'circle') path.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
    else if (kind === 'line') { path.moveTo(-w / 2, 0); path.lineTo(w / 2, 0); strokeOnly = true; }
    else if (kind === 'arrow') { const t = (s.lineWidth || 12) * k; const hw = Math.min(h / 2, t * 3); path.moveTo(-w / 2, -t / 2); path.lineTo(w / 2 - hw * 1.4, -t / 2); path.lineTo(w / 2 - hw * 1.4, -hw); path.lineTo(w / 2, 0); path.lineTo(w / 2 - hw * 1.4, hw); path.lineTo(w / 2 - hw * 1.4, t / 2); path.lineTo(-w / 2, t / 2); path.closePath(); }
    else if (kind === 'star' || kind === 'polygon') { const n = Math.max(3, s.points | 0); const st = kind === 'star' ? n * 2 : n; for (let i = 0; i < st; i++) { const ang = (i / st) * Math.PI * 2 - Math.PI / 2; const r = kind === 'star' && i % 2 ? s.inner : 1; const x = Math.cos(ang) * (w / 2) * r, y = Math.sin(ang) * (h / 2) * r; i ? path.lineTo(x, y) : path.moveTo(x, y); } path.closePath(); }
    else if (kind === 'triangle') { path.moveTo(0, -h / 2); path.lineTo(w / 2, h / 2); path.lineTo(-w / 2, h / 2); path.closePath(); }
    else if (kind === 'heart') { const x = w / 2, y = h / 2; path.moveTo(0, y * 0.9); path.bezierCurveTo(-x * 1.6, -y * 0.2, -x * 0.6, -y * 1.3, 0, -y * 0.45); path.bezierCurveTo(x * 0.6, -y * 1.3, x * 1.6, -y * 0.2, 0, y * 0.9); }
    else if (kind === 'bubble') { roundRect(path, -w / 2, -h / 2, w, h * 0.8, Math.min(s.radius * k, h * 0.3)); path.moveTo(-w * 0.2, h * 0.3); path.lineTo(-w * 0.3, h / 2); path.lineTo(-w * 0.05, h * 0.3); }
    else if (kind === 'progress') { roundRect(path, -w / 2, -h / 2, w, h, h / 2); }
    else if (kind === 'ring') { strokeOnly = true; path.arc(0, 0, Math.min(w, h) / 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, (s.progress ?? 1) * draw)); }
    else if (kind === 'cross') { const t = (s.lineWidth || 12) * k; path.moveTo(-w / 2, -h / 2); path.lineTo(w / 2, h / 2); path.moveTo(w / 2, -h / 2); path.lineTo(-w / 2, h / 2); strokeOnly = true; }
    else if (kind === 'check') { path.moveTo(-w / 2, 0); path.lineTo(-w / 6, h / 2); path.lineTo(w / 2, -h / 2); strokeOnly = true; }
    else if (kind === 'bracket') { const L = Math.min(w, h) * 0.25; for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { path.moveTo(sx * w / 2, sy * h / 2 - sy * L); path.lineTo(sx * w / 2, sy * h / 2); path.lineTo(sx * w / 2 - sx * L, sy * h / 2); } strokeOnly = true; }
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (s.anim === 'draw' && draw < 1 && !['ring'].includes(kind)) {
      // draw-on: dashed stroke reveal
      const len = (w + h) * 2.2; g.setLineDash([len * draw, len]); g.lineWidth = Math.max(2, (s.stroke || s.lineWidth || 8) * k); g.strokeStyle = s.stroke ? s.strokeColor : (typeof fill === 'string' ? fill : s.fill); g.stroke(path); g.setLineDash([]);
    } else if (strokeOnly) { g.lineWidth = (s.lineWidth || 12) * k; g.strokeStyle = fill; g.stroke(path); }
    else {
      g.fillStyle = fill; g.fill(path);
      g.shadowColor = 'transparent';
      if (kind === 'progress') { const pr = Math.max(0, Math.min(1, (s.progress ?? 1) * (s.anim === 'grow' ? 1 : eo))); const p2 = new Path2D(); roundRect(p2, -w / 2, -h / 2, Math.max(h, w * pr), h, h / 2); g.fillStyle = s.accent || '#22d3ee'; g.fill(p2); }
      if (kind === 'lowerthird') { g.fillStyle = s.accent || '#22d3ee'; g.fillRect(-w / 2, -h / 2, Math.max(6 * k, w * 0.025), h); }
      if (s.stroke > 0) { g.lineWidth = s.stroke * k; g.strokeStyle = s.strokeColor; g.stroke(path); }
    }
    g.shadowColor = 'transparent';
    if (s.label) { g.fillStyle = s.labelColor || '#fff'; g.font = `800 ${Math.round(h * (kind === 'lowerthird' ? 0.38 : 0.3))}px Bahnschrift, Arial`; g.textAlign = kind === 'lowerthird' ? 'left' : 'center'; g.textBaseline = 'middle'; g.fillText(s.label, kind === 'lowerthird' ? -w / 2 + w * 0.06 : 0, kind === 'bubble' ? -h * 0.1 : 0); }
    g.restore();
    return c;
  }
}
function roundRect(p, x, y, w, h, r) { r = Math.max(0, r); p.moveTo(x + r, y); p.arcTo(x + w, y, x + w, y + h, r); p.arcTo(x + w, y + h, x, y + h, r); p.arcTo(x, y + h, x, y, r); p.arcTo(x, y, x + w, y, r); p.closePath(); }
