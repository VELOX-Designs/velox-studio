// Automation API: lets AI assistants (Claude via MCP) and scripts control VELOX Studio.
// Local HTTP on 127.0.0.1 only, protected by a random token stored in %APPDATA%/velox-studio/api.json.
import { commands, run } from './commands.js';
import { store, clipEnd, sourceLength } from './project.js';
import { paths, settings } from './settings.js';
import { importFiles, placeMedia, appendToMain } from './media.js';
import { bus, deepClone } from './util.js';
import { N } from './i18n.js';
import { EFFECTS } from '../render/effects.js';
import { TRANSITIONS } from '../render/transitions.js';
import { BUILTIN_PRESETS, VELOCITY_PRESETS } from '../ui/presets.js';
import { userPresets } from './settings.js';
import { engine } from '../playback/engine.js';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let server = null;
export const apiInfo = { port: 0, token: '' };

function summary() {
  const P = store.p;
  return {
    name: P.name, file: store.filePath, dirty: store.dirty,
    settings: P.settings, duration: store.duration(), time: store.time, playing: engine.playing,
    selection: [...store.selection], selectedTransition: store.selTransition,
    inPoint: P.inPoint, outPoint: P.outPoint,
    tracks: P.tracks.map((t) => ({ id: t.id, kind: t.kind, name: t.name, muted: t.muted, locked: t.locked, hidden: t.hidden })),
    media: P.media.map((m) => ({ id: m.id, name: m.name, path: m.path, type: m.type, duration: m.duration, width: m.width, height: m.height, fps: m.fps, hasAudio: m.hasAudio, folder: m.folder })),
    clips: P.clips.slice().sort((a, b) => a.start - b.start).map((c) => ({ id: c.id, type: c.type, trackId: c.trackId, name: c.name, mediaId: c.mediaId, start: +c.start.toFixed(4), end: +clipEnd(c).toFixed(4), dur: +c.dur.toFixed(4), in: +c.in.toFixed(4), sourceLength: +sourceLength(c).toFixed(4), speed: c.speed, ramp: c.ramp, reverse: c.reverse, linkId: c.linkId, muted: c.muted, volume: c.volume, effects: c.effects.map((f) => ({ id: f.id, type: f.type, enabled: f.enabled, params: f.params })), text: c.text?.content })),
    transitions: P.transitions, markers: P.markers,
  };
}

const handlers = {
  'GET /ping': () => ({ ok: true, app: 'VELOX Studio', version: paths.version }),
  'GET /state': () => summary(),
  'GET /project': () => deepClone(store.p),
  'POST /project': (b) => { store.edit('API: Projekt ersetzen', (p) => Object.assign(p, b.project)); return { ok: true }; },
  'GET /commands': () => [...commands.values()].map((c) => ({ id: c.id, name: N(c.name), category: c.cat, key: c.key || '', args: c.args || '' })),
  'GET /catalog': () => ({
    effects: Object.values(EFFECTS).map((d) => ({ id: d.id, name: N(d.name), category: d.cat, params: (d.params || []).map((q) => ({ key: q.k, type: q.type, min: q.min, max: q.max, default: q.def, options: q.options })) })),
    transitions: Object.values(TRANSITIONS).map((d) => ({ id: d.id, name: N(d.name), category: d.cat, directional: d.dir })),
    presets: [...BUILTIN_PRESETS, ...Object.values(userPresets).flat()].map((p) => ({ id: p.id, name: p.name, kind: p.kind })),
    velocity: Object.keys(VELOCITY_PRESETS),
  }),
  'POST /run': async (b) => ({ ok: true, result: await run(b.command, b.args || {}) }),
  'POST /batch': async (b) => { const out = []; for (const s of b.steps || []) out.push(await run(s.command, s.args || {})); return { ok: true, results: out }; },
  'POST /import': async (b) => {
    const ms = await importFiles(b.files || [], b.folder || 'root');
    let clips = [];
    if (b.place === 'append') store.edit('API: Anhängen', (p) => { clips = appendToMain(p, ms).map((c) => c.id); });
    else if (b.place === 'at') store.edit('API: Einfügen', (p) => { let t = +b.t || 0; for (const m of ms) { const cs = placeMedia(p, m, t, { videoTrackId: b.videoTrackId, audioTrackId: b.audioTrackId }); clips.push(...cs.map((c) => c.id)); t += cs[0]?.dur || 0; } });
    return { media: ms.map((m) => ({ id: m.id, name: m.name, type: m.type, duration: m.duration })), clips };
  },
  'POST /frame': async (b) => {
    const { exportStill } = await import('../ui/exporter.js');
    if (b.t != null) { engine.pause(); engine.seek(+b.t); }
    const file = b.out || path.join(paths.temp, `velox_frame_${Date.now()}.png`);
    await exportStill(file);
    return { file };
  },
};

export function startApi() {
  const cfgFile = path.join(paths.userData, 'api.json');
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch {}
  apiInfo.token = cfg.token || crypto.randomBytes(18).toString('hex');
  const tryPort = (port) => new Promise((res) => {
    const s = http.createServer(async (req, resp) => {
      const send = (code, obj) => { resp.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); resp.end(JSON.stringify(obj)); };
      if (req.headers['x-velox-token'] !== apiInfo.token) return send(401, { error: 'unauthorized' });
      const key = `${req.method} ${req.url.split('?')[0]}`;
      const h = handlers[key];
      if (!h) return send(404, { error: 'not found', routes: Object.keys(handlers) });
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 50e6) req.destroy(); });
      req.on('end', async () => {
        try { const b = body ? JSON.parse(body) : {}; const r = await h(b); bus.emit('api', key); send(200, r ?? { ok: true }); }
        catch (e) { send(400, { error: e.message }); }
      });
    });
    s.once('error', () => res(null));
    s.listen(port, '127.0.0.1', () => res(s));
  });
  (async () => {
    for (let p = cfg.port || 47800; p < 47820; p++) { server = await tryPort(p); if (server) { apiInfo.port = p; break; } }
    if (!server) return;
    fs.writeFileSync(cfgFile, JSON.stringify({ port: apiInfo.port, token: apiInfo.token }, null, 2));
    bus.emit('api:ready', apiInfo);
  })();
}
