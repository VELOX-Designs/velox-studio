// Rewrites com.microsoft.SkipGroupNorm (CUDA-only fused op) into Add + com.microsoft.GroupNorm so the
// SD-Turbo ONNX files run on DirectML (AMD/Intel/NVIDIA). Pure protobuf surgery, no dependencies.
const fs = require('fs');

function readVarint(b, p) { let r = 0n, s = 0n; for (;;) { const x = b[p++]; r |= BigInt(x & 0x7f) << s; if (!(x & 0x80)) return [r, p]; s += 7n; } }
function varint(n) { n = BigInt(n); const o = []; do { let x = Number(n & 0x7fn); n >>= 7n; if (n) x |= 0x80; o.push(x); } while (n); return Buffer.from(o); }
const key = (field, wt) => varint((field << 3) | wt);
const ld = (field, buf) => Buffer.concat([key(field, 2), varint(buf.length), buf]);
const str = (field, s) => ld(field, Buffer.from(s, 'utf8'));
// iterate fields of a message: yields {field, wt, start, end, valStart, valEnd, value}
function* fields(b, start = 0, end = b.length) {
  let p = start;
  while (p < end) {
    const s = p; let k; [k, p] = readVarint(b, p); const field = Number(k >> 3n), wt = Number(k & 7n);
    if (wt === 0) { let v; [v, p] = readVarint(b, p); yield { field, wt, start: s, end: p, value: v }; }
    else if (wt === 1) { p += 8; yield { field, wt, start: s, end: p, valStart: p - 8, valEnd: p }; }
    else if (wt === 5) { p += 4; yield { field, wt, start: s, end: p, valStart: p - 4, valEnd: p }; }
    else if (wt === 2) { let l; [l, p] = readVarint(b, p); const vs = p; p += Number(l); yield { field, wt, start: s, end: p, valStart: vs, valEnd: p }; }
    else throw new Error('unsupported wire type ' + wt);
  }
}
function parseNode(b, s, e) {
  const n = { input: [], output: [], name: '', op: '', domain: '', attrs: {} };
  for (const f of fields(b, s, e)) {
    const txt = () => b.toString('utf8', f.valStart, f.valEnd);
    if (f.field === 1) n.input.push(txt()); else if (f.field === 2) n.output.push(txt()); else if (f.field === 3) n.name = txt(); else if (f.field === 4) n.op = txt(); else if (f.field === 7) n.domain = txt();
    else if (f.field === 5) { let an = '', fv = null, iv = null; for (const a of fields(b, f.valStart, f.valEnd)) { if (a.field === 1) an = b.toString('utf8', a.valStart, a.valEnd); else if (a.field === 2) fv = b.readFloatLE(a.valStart); else if (a.field === 3) iv = Number(BigInt.asIntN(64, a.value)); } n.attrs[an] = fv ?? iv; }
  }
  return n;
}
function makeNode({ input, output, name, op, domain = '', attrs = {} }) {
  const parts = [...input.map((x) => str(1, x)), ...output.map((x) => str(2, x)), str(3, name), str(4, op)];
  for (const [k, v] of Object.entries(attrs)) {
    const isF = typeof v === 'object'; const val = isF ? v.f : v;
    const a = isF ? Buffer.concat([str(1, k), key(2, 5), (() => { const f = Buffer.alloc(4); f.writeFloatLE(val); return f; })(), key(20, 0), varint(1)]) : Buffer.concat([str(1, k), key(3, 0), varint(BigInt.asUintN(64, BigInt(val))), key(20, 0), varint(2)]);
    parts.push(ld(5, a));
  }
  if (domain) parts.push(str(7, domain));
  return ld(1, Buffer.concat(parts));
}
function rewriteGraph(b, s, e) {
  const out = []; let n = 0;
  for (const f of fields(b, s, e)) {
    if (f.field !== 1) { out.push(b.subarray(f.start, f.end)); continue; }
    const nd = parseNode(b, f.valStart, f.valEnd);
    if (nd.op !== 'SkipGroupNorm') { out.push(b.subarray(f.start, f.end)); continue; }
    n++;
    const [x, gamma, beta, skip, bias] = nd.input; const sum = nd.output[1] || nd.name + '_sum';
    if (bias) { out.push(makeNode({ input: [x, skip], output: [nd.name + '_s0'], name: nd.name + '_add0', op: 'Add' }), makeNode({ input: [nd.name + '_s0', bias], output: [sum], name: nd.name + '_add1', op: 'Add' })); }
    else out.push(makeNode({ input: [x, skip], output: [sum], name: nd.name + '_add', op: 'Add' }));
    out.push(makeNode({ input: [sum, gamma, beta], output: [nd.output[0]], name: nd.name + '_gn', op: 'GroupNorm', domain: 'com.microsoft', attrs: { epsilon: { f: nd.attrs.epsilon ?? 1e-5 }, groups: nd.attrs.groups, activation: nd.attrs.activation ?? 0, channels_last: 1 } }));
  }
  return { buf: Buffer.concat(out), n };
}
// returns number of replaced nodes; writes `out` (only if something was replaced)
function fixModel(inp, outFile) {
  const b = fs.readFileSync(inp); const parts = []; let total = 0;
  for (const f of fields(b)) {
    if (f.field === 7) { const g = rewriteGraph(b, f.valStart, f.valEnd); total += g.n; parts.push(ld(7, g.buf)); } else parts.push(b.subarray(f.start, f.end));
  }
  if (total) { const fd = fs.openSync(outFile, 'w'); for (const p of parts) fs.writeSync(fd, p); fs.closeSync(fd); }
  return total;
}
module.exports = { fixModel };
