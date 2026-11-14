// Video scopes: RGB parade / luma waveform and histogram from the preview canvas.
import { bus, el } from '../core/util.js';
import { grabPreview } from './viewer.js';

let mounted = null;
export function mountScopes(host) {
  if (!host) return;
  host.innerHTML = '';
  const wf = el('canvas', { width: 300, height: 130 }), hist = el('canvas', { width: 300, height: 130 });
  const mode = el('select', {}, el('option', { value: 'parade' }, 'RGB Parade'), el('option', { value: 'luma' }, 'Luma Waveform'), el('option', { value: 'vector' }, 'Vectorscope'));
  host.append(mode, wf, hist);
  mounted = { wf, hist, mode };
  update();
}
let pending = false;
bus.on('frame', () => { if (!mounted || pending || !document.body.contains(mounted.wf)) return; pending = true; setTimeout(() => { pending = false; update(); }, 120); });

function update() {
  if (!mounted) return;
  const src = grabPreview(240);
  const W = src.width, H = src.height;
  const d = src.getContext('2d').getImageData(0, 0, W, H).data;
  const { wf, hist, mode } = mounted;
  const g = wf.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, wf.width, wf.height);
  g.globalCompositeOperation = 'lighter';
  const m = mode.value;
  if (m === 'vector') {
    const cx = wf.width / 2, cy = wf.height / 2, R = wf.height / 2 - 4;
    g.strokeStyle = '#333'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.stroke();
    for (let i = 0; i < d.length; i += 8) {
      const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
      const u = -0.147 * r - 0.289 * gg + 0.436 * b, v = 0.615 * r - 0.515 * gg - 0.1 * b;
      g.fillStyle = `rgba(${d[i]},${d[i + 1]},${d[i + 2]},0.25)`; g.fillRect(cx + u * R * 2.2, cy - v * R * 2.2, 1.5, 1.5);
    }
  } else {
    const cols = m === 'parade' ? 3 : 1;
    const cw = wf.width / cols;
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y += 1) {
      const i = (y * W + x) * 4;
      if (m === 'parade') {
        for (let c = 0; c < 3; c++) { g.fillStyle = ['rgba(255,60,60,0.12)', 'rgba(60,255,60,0.12)', 'rgba(60,120,255,0.12)'][c]; g.fillRect(c * cw + (x / W) * cw, wf.height - (d[i + c] / 255) * wf.height, 1, 1); }
      } else { const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; g.fillStyle = 'rgba(180,255,200,0.12)'; g.fillRect((x / W) * wf.width, wf.height - (L / 255) * wf.height, 1, 1); }
    }
  }
  g.globalCompositeOperation = 'source-over';
  // histogram
  const bins = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < d.length; i += 4) { bins[0][d[i]]++; bins[1][d[i + 1]]++; bins[2][d[i + 2]]++; }
  const h = hist.getContext('2d'); h.fillStyle = '#000'; h.fillRect(0, 0, hist.width, hist.height);
  const max = Math.max(...bins.map((b) => Math.max(...b))) || 1;
  h.globalCompositeOperation = 'lighter';
  ['#ff3c3c', '#3cff3c', '#3c78ff'].forEach((col, c) => { h.fillStyle = col + '99'; for (let i = 0; i < 256; i++) { const v = Math.sqrt(bins[c][i] / max) * hist.height; h.fillRect((i / 256) * hist.width, hist.height - v, hist.width / 256 + 0.5, v); } });
  h.globalCompositeOperation = 'source-over';
}
