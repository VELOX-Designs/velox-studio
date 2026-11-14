// Text rendering into a frame-sized canvas with per-character animations.
import { EASINGS } from '../core/keyframes.js';

export const TEXT_ANIMS_IN = {
  none: { de: 'Keine', en: 'None' }, fade: { de: 'Einblenden', en: 'Fade' }, typewriter: { de: 'Schreibmaschine', en: 'Typewriter' },
  pop: { de: 'Pop', en: 'Pop' }, slideUp: { de: 'Von unten', en: 'Slide up' }, slideLeft: { de: 'Von rechts', en: 'Slide left' },
  blurIn: { de: 'Unschärfe rein', en: 'Blur in' }, zoomIn: { de: 'Zoom rein', en: 'Zoom in' }, words: { de: 'Wort für Wort (Kinetic)', en: 'Word by word (kinetic)' },
  letterDrop: { de: 'Buchstaben fallen', en: 'Letter drop' }, letterPop: { de: 'Buchstaben-Pop', en: 'Letter pop' }, glitchIn: { de: 'Glitch rein', en: 'Glitch in' },
  spread: { de: 'Zusammenziehen', en: 'Tracking in' }, rotateIn: { de: 'Drehen rein', en: 'Rotate in' }, karaoke: { de: 'Karaoke-Highlight', en: 'Karaoke highlight' },
};
export const TEXT_ANIMS_OUT = {
  none: { de: 'Keine', en: 'None' }, fade: { de: 'Ausblenden', en: 'Fade' }, slideDown: { de: 'Nach unten', en: 'Slide down' },
  zoomOut: { de: 'Zoom raus', en: 'Zoom out' }, typeOut: { de: 'Löschen (Typewriter)', en: 'Type out' }, blurOut: { de: 'Unschärfe raus', en: 'Blur out' },
  letterFly: { de: 'Buchstaben wegfliegen', en: 'Letters fly away' },
};
export const TEXT_LOOPS = { none: { de: 'Keine', en: 'None' }, wave: { de: 'Welle', en: 'Wave' }, pulse: { de: 'Puls', en: 'Pulse' }, shake: { de: 'Zittern', en: 'Jitter' }, float: { de: 'Schweben', en: 'Float' }, rainbow: { de: 'Regenbogen', en: 'Rainbow' } };

const eo = EASINGS.easeOut, bo = EASINGS.backOut;

export class TextRenderer {
  constructor() { this.canvas = document.createElement('canvas'); this.ctx = this.canvas.getContext('2d'); }
  // returns canvas with the text drawn for clip-local time lt
  render(t, lt, dur, W, H, scale = 1) {
    const c = this.canvas;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = this.ctx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    let content = String(t.content ?? '');
    if (t.upper) content = content.toUpperCase();
    const size = Math.max(4, t.size * scale);
    const font = `${t.italic ? 'italic ' : ''}${t.weight || 700} ${size}px "${t.font || 'Arial'}", Arial, sans-serif`;
    g.font = font; g.textBaseline = 'alphabetic';
    const letter = (t.letter || 0) * scale;
    // layout lines with wrapping
    const maxW = (t.boxW || 0.9) * W;
    const lines = [];
    for (const para of content.split('\n')) {
      const words = para.split(/(\s+)/);
      let line = '';
      for (const w of words) {
        const test = line + w;
        if (this.measure(g, test.trimEnd(), letter) > maxW && line.trim()) { lines.push(line.trimEnd()); line = w.trimStart(); }
        else line = test;
      }
      lines.push(line);
    }
    const lh = size * (t.lineHeight || 1.1);
    const totalH = lh * lines.length;
    const ad = Math.max(0.05, t.animDur || 0.6);
    const pin = Math.min(1, Math.max(0, lt / ad));
    const pout = t.animOut && t.animOut !== 'none' ? Math.min(1, Math.max(0, (lt - (dur - ad)) / ad)) : 0;
    // build glyph list
    const glyphs = [];
    let gi = 0, wi = 0;
    lines.forEach((ln, li) => {
      const lw = this.measure(g, ln, letter);
      let x = t.align === 'left' ? (W - maxW) / 2 : t.align === 'right' ? (W + maxW) / 2 - lw : (W - lw) / 2;
      const y = H / 2 - totalH / 2 + lh * li + size * 0.82;
      let prevSpace = true;
      for (const ch of ln) {
        const cw = g.measureText(ch).width + letter;
        if (/\s/.test(ch)) prevSpace = true; else { if (prevSpace) wi++; prevSpace = false; }
        glyphs.push({ ch, x, y, w: cw, i: gi++, word: wi - 1, line: li });
        x += cw;
      }
    });
    const n = glyphs.length || 1, nw = Math.max(1, wi);
    // global anim
    let gAlpha = 1, gScale = 1, gDx = 0, gDy = 0, gBlur = 0, gRot = 0;
    const ai = t.anim || 'none', ao = t.animOut || 'none';
    if (ai === 'fade') gAlpha *= eo(pin);
    if (ai === 'pop') { gScale *= 0.3 + 0.7 * bo(pin); gAlpha *= Math.min(1, pin * 3); }
    if (ai === 'slideUp') { gDy += (1 - eo(pin)) * size * 1.2; gAlpha *= eo(pin); }
    if (ai === 'slideLeft') { gDx += (1 - eo(pin)) * W * 0.25; gAlpha *= eo(pin); }
    if (ai === 'blurIn') { gBlur += (1 - eo(pin)) * 30 * scale; gAlpha *= eo(pin); }
    if (ai === 'zoomIn') { gScale *= 2.5 - 1.5 * eo(pin); gAlpha *= eo(pin); }
    if (ai === 'rotateIn') { gRot += (1 - bo(pin)) * -40; gScale *= 0.5 + 0.5 * bo(pin); gAlpha *= Math.min(1, pin * 2); }
    if (ao === 'fade') gAlpha *= 1 - pout;
    if (ao === 'slideDown') { gDy += EASINGS.easeIn(pout) * size * 1.2; gAlpha *= 1 - pout; }
    if (ao === 'zoomOut') { gScale *= 1 + EASINGS.easeIn(pout) * 1.5; gAlpha *= 1 - pout; }
    if (ao === 'blurOut') { gBlur += pout * 30 * scale; gAlpha *= 1 - pout; }
    if (gAlpha <= 0.001) return c;
    g.save();
    g.translate(W / 2 + gDx, H / 2 + gDy);
    g.rotate((gRot * Math.PI) / 180);
    g.scale(gScale, gScale);
    g.translate(-W / 2, -H / 2);
    if (gBlur > 0.3) g.filter = `blur(${gBlur.toFixed(1)}px)`;
    g.globalAlpha = gAlpha;
    // background box
    if (t.bg) {
      const pad = (t.bgPad || 0) * scale;
      const bw = Math.max(...lines.map((l) => this.measure(g, l, letter)), 1);
      const bx = t.align === 'left' ? (W - maxW) / 2 : t.align === 'right' ? (W + maxW) / 2 - bw : (W - bw) / 2;
      g.fillStyle = t.bg;
      this.roundRect(g, bx - pad, H / 2 - totalH / 2 - pad, bw + pad * 2, totalH + pad * 2, (t.bgRadius || 0) * scale);
      g.fill();
    }
    // fill style (gradient)
    let fill = t.color || '#fff';
    if (t.color2) {
      const a = ((t.gradAngle || 0) * Math.PI) / 180;
      const cx = W / 2, cy = H / 2, r = Math.max(maxW, totalH) / 2;
      const grd = g.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      grd.addColorStop(0, t.color); grd.addColorStop(1, t.color2); fill = grd;
    }
    const tsec = lt;
    const drawGlyph = (gl, pass) => {
      let a = 1, dx = 0, dy = 0, sc = 1, rot = 0, col = null;
      const fi = gl.i / n, fw = gl.word / nw;
      if (ai === 'typewriter') { if (pin < 1 && gl.i >= Math.floor(pin * n)) return; }
      if (ai === 'words') { const k = Math.min(1, Math.max(0, pin * nw - gl.word)); a *= eo(k); sc *= 0.6 + 0.4 * bo(k); dy += (1 - eo(k)) * size * 0.4; }
      if (ai === 'letterDrop') { const k = Math.min(1, Math.max(0, pin * 1.6 - fi * 0.6)); dy -= (1 - EASINGS.bounce(k)) * size * 2; a *= Math.min(1, k * 3); }
      if (ai === 'letterPop') { const k = Math.min(1, Math.max(0, pin * 1.6 - fi * 0.6)); sc *= bo(k); a *= Math.min(1, k * 3); }
      if (ai === 'glitchIn' && pin < 1) { const r = Math.sin(gl.i * 91.7 + Math.floor(tsec * 30) * 13.3); if (r > pin * 2 - 1) { dx += r * size * 0.3; a *= pin; col = r > 0.5 ? '#ff0050' : '#00f0ff'; } }
      if (ai === 'spread') { dx += (gl.x + gl.w / 2 - W / 2) * (1 - eo(pin)) * 0.6; a *= eo(pin); }
      if (ai === 'karaoke') { if (fi > pin) col = t.color2 ? '#888888' : 'rgba(255,255,255,0.35)'; }
      if (ao === 'typeOut' && pout > 0 && gl.i >= Math.floor((1 - pout) * n)) return;
      if (ao === 'letterFly' && pout > 0) { const k = Math.min(1, Math.max(0, pout * 1.6 - fi * 0.6)); dy -= EASINGS.easeIn(k) * size * 3; rot += k * 90; a *= 1 - k; }
      const loop = t.loop || 'none';
      if (loop === 'wave') dy += Math.sin(tsec * 5 - gl.i * 0.45) * size * 0.08;
      if (loop === 'pulse') sc *= 1 + Math.sin(tsec * 6) * 0.06;
      if (loop === 'shake') { dx += Math.sin(tsec * 47 + gl.i * 3) * size * 0.02; dy += Math.cos(tsec * 53 + gl.i * 5) * size * 0.02; }
      if (loop === 'float') dy += Math.sin(tsec * 2 + gl.i * 0.2) * size * 0.05;
      if (loop === 'rainbow') col = `hsl(${(tsec * 120 + gl.i * 18) % 360},100%,60%)`;
      if (a <= 0.001) return;
      g.save();
      g.globalAlpha = gAlpha * a;
      const cx = gl.x + gl.w / 2, cy = gl.y - size * 0.35;
      g.translate(cx + dx, cy + dy); g.rotate((rot * Math.PI) / 180); g.scale(sc, sc); g.translate(-cx, -cy);
      if (pass === 'extrude') {
        g.fillStyle = t.extrudeColor || '#111';
        const steps = Math.ceil(t.extrude * scale);
        for (let s = steps; s > 0; s--) g.fillText(gl.ch, gl.x + s * 0.7, gl.y + s);
      } else if (pass === 'stroke') {
        g.lineWidth = t.stroke * scale * 2; g.strokeStyle = t.strokeColor; g.lineJoin = 'round'; g.strokeText(gl.ch, gl.x, gl.y);
      } else if (pass === 'glow') {
        g.shadowColor = t.glowColor; g.shadowBlur = t.glow * scale; g.fillStyle = t.glowColor; g.fillText(gl.ch, gl.x, gl.y); g.fillText(gl.ch, gl.x, gl.y);
      } else if (pass === 'shadow') {
        g.shadowColor = t.shadowColor || '#000'; g.shadowBlur = 18 * scale * t.shadow; g.shadowOffsetX = 4 * scale * t.shadow; g.shadowOffsetY = 6 * scale * t.shadow;
        g.fillStyle = col || fill; g.fillText(gl.ch, gl.x, gl.y);
      } else {
        g.fillStyle = col || fill; g.fillText(gl.ch, gl.x, gl.y);
      }
      g.restore();
    };
    if (t.extrude > 0) glyphs.forEach((x) => drawGlyph(x, 'extrude'));
    if (t.glow > 0) glyphs.forEach((x) => drawGlyph(x, 'glow'));
    if (t.stroke > 0) glyphs.forEach((x) => drawGlyph(x, 'stroke'));
    glyphs.forEach((x) => drawGlyph(x, t.shadow > 0 ? 'shadow' : 'fill'));
    g.restore();
    return c;
  }
  measure(g, s, letter) { return g.measureText(s).width + letter * s.length; }
  roundRect(g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
}
