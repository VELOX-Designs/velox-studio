// Editing commands (registered in the central registry → menus, shortcuts, automation API).
import { registerCommands, run } from '../core/commands.js';
import { setTransitionOverlap } from '../core/project.js';
import { store, clipEnd, splitAt, removeClip, rippleTrack, trimClipStart, trimClipEnd, setClipSpeed, setClipRamp, newTrack, newClip, dropBrokenTransitions, sourceTime, rippleDeleteRange, clearRange, sourceLength } from '../core/project.js';
import { uid, deepClone, bus } from '../core/util.js';
import { settings, setSetting, savePreset, userPresets } from '../core/settings.js';
import { engine } from '../playback/engine.js';
import { L } from '../core/i18n.js';
import { tl, zoomBy, zoomFit, setTool, draw, buildToolbar } from './timeline.js';
import { EFFECTS, defaultParams } from '../render/effects.js';
import { TRANSITIONS } from '../render/transitions.js';
import { addTextClip, addSolidClip, freeVideoTrack, createProxy, addShapeClip } from '../core/media.js';
import { toast, promptBox } from './dialogs.js';
import { BUILTIN_PRESETS, VELOCITY_PRESETS } from './presets.js';

const frame = (t) => Math.round(t * store.fps) / store.fps;
const sel = () => store.selectedClips();
// selection, otherwise the clip(s) under the playhead (top-most visual clip + its linked audio)
const needSel = () => {
  const s = sel(); if (s.length) return s;
  const t = store.time;
  const under = store.p.clips.filter((c) => c.start <= t && clipEnd(c) > t && !store.track(c.trackId)?.locked);
  const vt = store.p.tracks.filter((x) => x.kind === 'video').reverse();
  for (const tr of vt) { const c = under.find((x) => x.trackId === tr.id && x.type !== 'adjust'); if (c) { store.select([c.id, ...store.linked(c).map((l) => l.id)]); return [c, ...store.linked(c)]; } }
  if (under.length) { store.select(under.map((c) => c.id)); return under; }
  throw new Error(L('Kein Clip am Playhead – Playhead auf einen Clip setzen oder Clip anklicken', 'No clip at the playhead – move the playhead onto a clip or click one'));
};
// clips under playhead on target tracks if nothing selected
function selOrUnderPlayhead() {
  const s = sel(); if (s.length) return s;
  const t = store.time;
  return store.p.clips.filter((c) => c.start <= t && clipEnd(c) > t && !store.track(c.trackId)?.locked);
}
let clipboard = null;

registerCommands([
  // ---------------------------------------------------------------- transport
  { id: 'togglePlay', name: { de: 'Wiedergabe / Pause', en: 'Play / Pause' }, cat: 'play', key: 'Space', run: () => engine.toggle() },
  { id: 'play', name: { de: 'Abspielen', en: 'Play' }, cat: 'play', run: () => engine.play() },
  { id: 'pause', name: { de: 'Pause', en: 'Pause' }, cat: 'play', run: () => engine.pause() },
  { id: 'shuttleBack', name: { de: 'Rückwärts (J)', en: 'Shuttle back (J)' }, cat: 'play', key: 'J', run: () => { engine.pause(); engine.seek(store.time - 1); } },
  { id: 'shuttleStop', name: { de: 'Stopp (K)', en: 'Stop (K)' }, cat: 'play', key: 'K', run: () => engine.pause() },
  { id: 'shuttleFwd', name: { de: 'Vorwärts (L), mehrfach = schneller', en: 'Forward (L), repeat = faster' }, cat: 'play', key: 'L', run: () => { if (engine.playing) engine.setRate(Math.min(8, engine.rate * 2)); else { engine.setRate(1); engine.play(); } } },
  { id: 'prevFrame', name: { de: 'Frame zurück', en: 'Previous frame' }, cat: 'play', key: 'ArrowLeft', run: () => engine.step(-1) },
  { id: 'nextFrame', name: { de: 'Frame vor', en: 'Next frame' }, cat: 'play', key: 'ArrowRight', run: () => engine.step(1) },
  { id: 'prev10', name: { de: '10 Frames zurück', en: 'Back 10 frames' }, cat: 'play', key: 'Shift+ArrowLeft', run: () => engine.step(-10) },
  { id: 'next10', name: { de: '10 Frames vor', en: 'Forward 10 frames' }, cat: 'play', key: 'Shift+ArrowRight', run: () => engine.step(10) },
  { id: 'prevEdit', name: { de: 'Vorheriger Schnitt', en: 'Previous edit' }, cat: 'play', key: 'ArrowUp', run: () => { const pts = editPoints().filter((t) => t < store.time - 1e-3); engine.pause(); engine.seek(pts.length ? pts[pts.length - 1] : 0); } },
  { id: 'nextEdit', name: { de: 'Nächster Schnitt', en: 'Next edit' }, cat: 'play', key: 'ArrowDown', run: () => { const pts = editPoints().filter((t) => t > store.time + 1e-3); engine.pause(); if (pts.length) engine.seek(pts[0]); } },
  { id: 'goStart', name: { de: 'Zum Anfang', en: 'Go to start' }, cat: 'play', key: 'Home', run: () => { engine.pause(); engine.seek(0); } },
  { id: 'goEnd', name: { de: 'Zum Ende', en: 'Go to end' }, cat: 'play', key: 'End', run: () => { engine.pause(); engine.seek(store.duration()); } },
  { id: 'seek', name: { de: 'Zu Zeit springen', en: 'Seek to time' }, cat: 'play', args: '{ t: Sekunden }', run: ({ t }) => { engine.seek(+t || 0); return store.time; } },
  { id: 'toggleLoop', name: { de: 'Loop In/Out', en: 'Loop in/out' }, cat: 'play', key: 'Ctrl+L', run: () => { engine.loopRange = !engine.loopRange; bus.emit('loop', engine.loopRange); toast('Loop ' + (engine.loopRange ? 'an' : 'aus')); } },
  { id: 'markIn', name: { de: 'In-Punkt setzen', en: 'Mark in' }, cat: 'play', key: 'I', run: () => store.edit('In', (p) => { p.inPoint = frame(store.time); if (p.outPoint != null && p.outPoint <= p.inPoint) p.outPoint = null; }) },
  { id: 'markOut', name: { de: 'Out-Punkt setzen', en: 'Mark out' }, cat: 'play', key: 'O', run: () => store.edit('Out', (p) => { p.outPoint = frame(store.time); if (p.inPoint != null && p.inPoint >= p.outPoint) p.inPoint = null; }) },
  { id: 'clearInOut', name: { de: 'In/Out löschen', en: 'Clear in/out' }, cat: 'play', key: 'Alt+X', run: () => store.edit('In/Out', (p) => { p.inPoint = null; p.outPoint = null; }) },
  { id: 'markClip', name: { de: 'In/Out auf Clip', en: 'Mark clip' }, cat: 'play', key: 'X', run: () => { const c = needSel()[0]; store.edit('In/Out', (p) => { p.inPoint = c.start; p.outPoint = clipEnd(c); }); } },

  // ---------------------------------------------------------------- edit
  { id: 'undo', name: { de: 'Rückgängig', en: 'Undo' }, cat: 'edit', key: 'Ctrl+Z', run: () => { const l = store.undo(); if (l) toast(L('Rückgängig: ', 'Undo: ') + l); } },
  { id: 'redo', name: { de: 'Wiederholen', en: 'Redo' }, cat: 'edit', key: 'Ctrl+Y,Ctrl+Shift+Z', run: () => { const l = store.redo(); if (l) toast(L('Wiederholt: ', 'Redo: ') + l); } },
  { id: 'selectAll', name: { de: 'Alles auswählen', en: 'Select all' }, cat: 'edit', key: 'Ctrl+A', run: () => store.select(store.p.clips.map((c) => c.id)) },
  { id: 'deselect', name: { de: 'Auswahl aufheben', en: 'Deselect' }, cat: 'edit', key: 'Escape', run: () => { store.select([]); } },
  { id: 'selectClips', name: { de: 'Clips auswählen (API)', en: 'Select clips (API)' }, cat: 'edit', hidden: true, args: '{ ids: [] }', run: ({ ids }) => { store.select(ids || []); return [...store.selection]; } },
  { id: 'selectForward', name: { de: 'Alles ab Playhead auswählen', en: 'Select forward' }, cat: 'edit', key: 'Ctrl+Shift+A', run: () => store.select(store.p.clips.filter((c) => c.start >= store.time - 1e-3).map((c) => c.id)) },
  { id: 'copy', name: { de: 'Kopieren', en: 'Copy' }, cat: 'edit', key: 'Ctrl+C', run: () => { const s = needSel(); const t0 = Math.min(...s.map((c) => c.start)); clipboard = { t0, clips: deepClone(s), transitions: deepClone(store.p.transitions.filter((t) => s.some((c) => c.id === t.a) && s.some((c) => c.id === t.b))) }; toast(L(`${s.length} Clip(s) kopiert`, `${s.length} clip(s) copied`)); } },
  { id: 'cut', name: { de: 'Ausschneiden', en: 'Cut' }, cat: 'edit', key: 'Ctrl+X', run: async () => { await run('copy'); await run('delete'); } },
  { id: 'paste', name: { de: 'Einfügen', en: 'Paste' }, cat: 'edit', key: 'Ctrl+V', run: () => {
    if (!clipboard) return;
    store.edit('Einfügen', (p) => {
      const dt = frame(store.time) - clipboard.t0; const map = new Map(); const links = new Map(); const out = [];
      for (const c0 of clipboard.clips) {
        const c = deepClone(c0); const old = c.id; c.id = uid('clp'); map.set(old, c.id); c.start += dt;
        if (!p.tracks.find((t) => t.id === c.trackId)) c.trackId = p.tracks.find((t) => t.kind === (c.type === 'audio' ? 'audio' : 'video')).id;
        if (c.linkId) { if (!links.has(c.linkId)) links.set(c.linkId, uid('lnk')); c.linkId = links.get(c.linkId); }
        clearRange(p, c.trackId, c.start, clipEnd(c)); p.clips.push(c); out.push(c.id);
      }
      for (const t of clipboard.transitions) p.transitions.push({ ...deepClone(t), id: uid('tr'), a: map.get(t.a), b: map.get(t.b) });
      store.select(out);
    });
  } },
  { id: 'duplicate', name: { de: 'Duplizieren', en: 'Duplicate' }, cat: 'edit', key: 'Ctrl+D', run: () => {
    const s = needSel();
    store.edit('Duplizieren', (p) => {
      const end = Math.max(...s.map(clipEnd)), t0 = Math.min(...s.map((c) => c.start)); const links = new Map(); const out = [];
      for (const c0 of s) { const c = deepClone(c0); c.id = uid('clp'); c.start = end + (c0.start - t0); if (c.linkId) { if (!links.has(c.linkId)) links.set(c.linkId, uid('lnk')); c.linkId = links.get(c.linkId); } clearRange(p, c.trackId, c.start, clipEnd(c)); p.clips.push(c); out.push(c.id); }
      store.select(out);
    });
  } },
  { id: 'delete', name: { de: 'Löschen', en: 'Delete' }, cat: 'edit', key: 'Delete,Backspace', run: () => {
    if (store.selTransition) { store.edit('Übergang löschen', (p) => { p.transitions = p.transitions.filter((t) => t.id !== store.selTransition); }); return; }
    const s = needSel();
    store.edit('Löschen', (p) => { for (const c of s) removeClip(p, c.id, false); if (settings.magnet) rippleTrack(p, p.tracks.find((t) => t.kind === 'video').id); dropBrokenTransitions(p); });
  } },
  { id: 'rippleDelete', name: { de: 'Ripple-Löschen', en: 'Ripple delete' }, cat: 'edit', key: 'Shift+Delete', run: () => {
    const s = needSel();
    store.edit('Ripple-Löschen', (p) => {
      const ranges = s.map((c) => [c.start, clipEnd(c), c.trackId]).sort((a, b) => b[0] - a[0]);
      for (const c of s) removeClip(p, c.id, false);
      for (const [a, b, tid] of ranges) {
        const tracks = new Set([tid, ...s.filter((c) => c.start === a).map((c) => c.trackId)]);
        const blocked = p.clips.some((c) => !tracks.has(c.trackId) && c.start < b && clipEnd(c) > a);
        for (const c of p.clips) if ((tracks.has(c.trackId) || !blocked) && c.start >= b - 1e-4) c.start -= b - a;
      }
      dropBrokenTransitions(p);
    });
  } },
  { id: 'closeGaps', name: { de: 'Alle Lücken schließen', en: 'Close all gaps' }, cat: 'edit', run: () => store.edit('Lücken schließen', (p) => { for (const t of p.tracks) rippleTrack(p, t.id); dropBrokenTransitions(p); }) },
  { id: 'liftRange', name: { de: 'In/Out herausheben', en: 'Lift in/out' }, cat: 'edit', key: ';', run: () => { const p = store.p; if (p.inPoint == null || p.outPoint == null) throw new Error('In/Out fehlt'); store.edit('Herausheben', (pp) => { for (const t of pp.tracks) if (!t.locked) clearRange(pp, t.id, pp.inPoint, pp.outPoint); }); } },
  { id: 'extractRange', name: { de: 'In/Out extrahieren (Ripple)', en: 'Extract in/out' }, cat: 'edit', key: "'", run: () => { const p = store.p; if (p.inPoint == null || p.outPoint == null) throw new Error('In/Out fehlt'); store.edit('Extrahieren', (pp) => { rippleDeleteRange(pp, pp.inPoint, pp.outPoint); pp.outPoint = null; }); } },

  // ---------------------------------------------------------------- clip
  { id: 'split', name: { de: 'Teilen am Playhead', en: 'Split at playhead' }, cat: 'clip', key: 'S,Ctrl+K', run: () => {
    // cut exactly at the playhead: selected clips if they lie under it, otherwise every clip under it
    const t = frame(store.time); const s = sel().filter((c) => c.start < t - 1e-4 && clipEnd(c) > t + 1e-4);
    store.edit('Schneiden', (p) => {
      const ids = s.length ? new Set(s.flatMap((c) => [c.id, ...store.linked(c).map((l) => l.id)])) : null;
      const r = splitAt(p, t, ids);
      if (!r.length) toast(L('Am Playhead liegt kein Clip zum Schneiden', 'No clip under the playhead to cut'));
      else store.select(r.map((c) => c.id));
    });
  } },
  { id: 'splitAll', name: { de: 'Alle Spuren teilen', en: 'Split all tracks' }, cat: 'clip', key: 'Ctrl+Shift+K', run: () => store.edit('Teilen', (p) => splitAt(p, frame(store.time))) },
  { id: 'splitAt', name: { de: 'Teilen bei Zeit (API)', en: 'Split at time (API)' }, cat: 'clip', hidden: true, args: '{ t, ids? }', run: ({ t, ids }) => store.edit('Teilen', (p) => splitAt(p, frame(+t), ids ? new Set(ids) : null).map((c) => c.id)) },
  { id: 'trimStart', name: { de: 'Anfang bis Playhead trimmen', en: 'Trim start to playhead' }, cat: 'clip', key: 'Q', run: () => trimToPlayhead('start') },
  { id: 'trimEnd', name: { de: 'Ende ab Playhead trimmen', en: 'Trim end to playhead' }, cat: 'clip', key: 'W', run: () => trimToPlayhead('end') },
  { id: 'nudgeLeft', name: { de: 'Clip 1 Frame nach links', en: 'Nudge left' }, cat: 'clip', key: 'Alt+ArrowLeft', run: () => nudge(-1) },
  { id: 'nudgeRight', name: { de: 'Clip 1 Frame nach rechts', en: 'Nudge right' }, cat: 'clip', key: 'Alt+ArrowRight', run: () => nudge(1) },
  { id: 'moveUp', name: { de: 'Clip eine Spur hoch', en: 'Move clip up' }, cat: 'clip', key: 'Alt+ArrowUp', run: () => moveTrack(1) },
  { id: 'moveDown', name: { de: 'Clip eine Spur runter', en: 'Move clip down' }, cat: 'clip', key: 'Alt+ArrowDown', run: () => moveTrack(-1) },
  { id: 'setSpeed', name: { de: 'Geschwindigkeit setzen', en: 'Set speed' }, cat: 'clip', args: '{ speed }', run: ({ speed }) => { const s = needSel(); store.edit('Geschwindigkeit', (p) => { for (const c of s) if (c.type !== 'text' && c.type !== 'solid') setClipSpeed(p, c, +speed); fixOverlaps(p, s); }); } },
  { id: 'setRamp', name: { de: 'Speed-Ramp setzen (API)', en: 'Set speed ramp (API)' }, cat: 'clip', hidden: true, args: '{ ramp: [{u,v}] }', run: ({ ramp }) => { const s = needSel(); store.edit('Speed Ramp', (p) => { for (const c of s) setClipRamp(p, c, ramp); fixOverlaps(p, s); }); } },
  { id: 'velocityPreset', name: { de: 'Velocity-Preset anwenden', en: 'Apply velocity preset' }, cat: 'clip', args: '{ preset }', run: ({ preset }) => {
    const s = needSel().filter((c) => c.type === 'video' || c.type === 'audio');
    const v = VELOCITY_PRESETS[preset];
    store.edit('Velocity', (p) => { for (const c of s) setClipRamp(p, c, v ? v.ramp : null); fixOverlaps(p, s); });
    if (v?.fx) store.edit('Velocity FX', () => { for (const c of s) if (c.type === 'video' && !c.effects.some((f) => f.type === 'motionblur')) c.effects.push({ id: uid('fx'), type: 'motionblur', enabled: true, params: defaultParams('motionblur') }); });
  } },
  { id: 'reverse', name: { de: 'Rückwärts abspielen', en: 'Reverse' }, cat: 'clip', key: 'Ctrl+R', run: () => { const s = needSel(); store.edit('Rückwärts', () => { for (const c of s) if (c.type === 'video' || c.type === 'audio') c.reverse = !c.reverse; }); } },
  { id: 'freezeFrame', name: { de: 'Standbild (Freeze Frame)', en: 'Freeze frame' }, cat: 'clip', key: 'Shift+F', run: () => {
    const t = frame(store.time);
    const c = sel().find((x) => x.type === 'video' && x.start <= t && clipEnd(x) > t) || store.p.clips.find((x) => x.type === 'video' && x.start <= t && clipEnd(x) > t);
    if (!c) throw new Error(L('Kein Videoclip am Playhead', 'No video clip at playhead'));
    store.edit('Standbild', (p) => {
      const src = sourceTime(c, t - c.start); const fd = 2;
      splitAt(p, t, new Set([c.id, ...store.linked(c).map((l) => l.id)]));
      for (const o of p.clips) if ((o.trackId === c.trackId || (c.linkId && o.linkId === c.linkId)) && o.start >= t - 1e-4 && o.id !== c.id) o.start += fd;
      const f = newClip({ ...deepClone(c), id: uid('clp'), start: t, dur: fd, in: src, freeze: true, linkId: null, ramp: null, speed: 1, reverse: false, name: c.name + ' (Standbild)' });
      p.clips.push(f); store.select([f.id]);
    });
  } },
  { id: 'link', name: { de: 'Clips verknüpfen', en: 'Link clips' }, cat: 'clip', key: 'Ctrl+Shift+L', run: () => { const s = needSel(); const id = uid('lnk'); store.edit('Verknüpfen', () => s.forEach((c) => (c.linkId = id))); } },
  { id: 'unlink', name: { de: 'Verknüpfung lösen / Audio trennen', en: 'Unlink / detach audio' }, cat: 'clip', key: 'Ctrl+Shift+U', run: () => { const s = needSel(); store.edit('Lösen', () => s.flatMap((c) => [c, ...store.linked(c)]).forEach((c) => (c.linkId = null))); } },
  { id: 'toggleClipEnabled', name: { de: 'Clip (de)aktivieren', en: 'Enable/disable clip' }, cat: 'clip', key: 'Shift+E', run: () => { const s = needSel(); store.edit('Aktivieren', () => s.forEach((c) => (c.muted = !c.muted))); } },
  { id: 'fadeInOut', name: { de: 'Ein-/Ausblenden (0,5s)', en: 'Fade in/out (0.5s)' }, cat: 'clip', run: ({ dur = 0.5 } = {}) => { const s = needSel(); store.edit('Fade', () => s.forEach((c) => { c.fadeIn = Math.min(dur, c.dur / 2); c.fadeOut = Math.min(dur, c.dur / 2); })); } },
  { id: 'fillFrame', name: { de: 'Bild füllen (Crop)', en: 'Fill frame' }, cat: 'clip', run: () => { const s = needSel(); store.edit('Füllen', () => s.forEach((c) => { const m = store.media(c.mediaId); if (!m || !m.width) return; const P = store.p.settings; const fit = Math.min(P.width / m.width, P.height / m.height); const fill = Math.max(P.width / m.width, P.height / m.height); c.transform.scale = fill / fit; })); } },
  { id: 'fitFrame', name: { de: 'Bild einpassen', en: 'Fit frame' }, cat: 'clip', run: () => { const s = needSel(); store.edit('Einpassen', () => s.forEach((c) => { c.transform.scale = 1; c.transform.x = 0; c.transform.y = 0; })); } },
  { id: 'resetTransform', name: { de: 'Transformation zurücksetzen', en: 'Reset transform' }, cat: 'clip', run: () => { const s = needSel(); store.edit('Reset', () => s.forEach((c) => { for (const k of ['x', 'y', 'rotation', 'rotX', 'rotY', 'cropL', 'cropR', 'cropT', 'cropB']) c.transform[k] = 0; c.transform.scale = 1; c.transform.opacity = 1; c.transform.scaleX = 1; c.transform.scaleY = 1; })); } },
  { id: 'setClipProps', name: { de: 'Clip-Eigenschaften setzen (API)', en: 'Set clip properties (API)' }, cat: 'clip', hidden: true, args: '{ id, props:{start,dur,in,volume,fadeIn,fadeOut,blend,name,muted,color}, transform:{}, text:{}, audio:{} }', run: ({ id, props = {}, transform = {}, text = {}, audio = {}, solid }) => store.edit('Eigenschaften', (p) => {
    const c = p.clips.find((x) => x.id === (id || store.primaryClip()?.id)); if (!c) throw new Error('Clip nicht gefunden');
    const allowed = ['start', 'dur', 'in', 'volume', 'fadeIn', 'fadeOut', 'blend', 'name', 'muted', 'color', 'trackId', 'speed', 'reverse'];
    for (const k of allowed) if (props[k] !== undefined) c[k] = props[k];
    Object.assign(c.transform, transform); if (c.text) Object.assign(c.text, text); Object.assign(c.audio, audio); if (solid) c.solid = Object.assign(c.solid || {}, solid);
    return c.id;
  }) },
  { id: 'createProxy', name: { de: 'Proxy erstellen', en: 'Create proxy' }, cat: 'clip', run: () => { const ms = new Set(sel().map((c) => c.mediaId).filter(Boolean)); for (const id of ms) { const m = store.media(id); if (m?.type === 'video') createProxy(m); } } },

  // ---------------------------------------------------------------- effects / transitions / presets
  { id: 'applyEffect', name: { de: 'Effekt anwenden', en: 'Apply effect' }, cat: 'fx', args: '{ type, params?, clipIds? }', run: ({ type, params, clipIds }) => {
    if (!EFFECTS[type]) throw new Error('Unbekannter Effekt ' + type);
    const s = clipIds ? clipIds.map((i) => store.clip(i)).filter(Boolean) : needSel();
    const targets = s.filter((c) => c.type !== 'audio');
    if (!targets.length) throw new Error(L('Effekte gehen nur auf Video/Bild/Text', 'Effects apply to visual clips'));
    store.edit('Effekt', () => targets.forEach((c) => c.effects.push({ id: uid('fx'), type, enabled: true, params: Object.assign(defaultParams(type), params || {}) })));
    bus.emit('inspect', targets[0].id, 'effects');
    return targets.map((c) => c.id);
  } },
  { id: 'removeEffect', name: { de: 'Effekt entfernen (API)', en: 'Remove effect (API)' }, cat: 'fx', hidden: true, args: '{ clipId, fxId }', run: ({ clipId, fxId }) => store.edit('Effekt entfernen', () => { const c = store.clip(clipId); if (c) c.effects = c.effects.filter((f) => f.id !== fxId); }) },
  { id: 'setEffectParam', name: { de: 'Effekt-Parameter (API)', en: 'Set effect param (API)' }, cat: 'fx', hidden: true, args: '{ clipId, fxId, key, value }', run: ({ clipId, fxId, key, value }) => store.edit('Effekt', () => { const f = store.clip(clipId)?.effects.find((x) => x.id === fxId); if (!f) throw new Error('Effekt nicht gefunden'); f.params[key] = value; }) },
  { id: 'addAdjustmentWithEffect', name: { de: 'Einstellungsebene mit Effekt', en: 'Adjustment layer with effect' }, cat: 'fx', hidden: true, run: ({ type, t = store.time, dur = 3 }) => store.edit('Einstellungsebene', (p) => { const c = addSolidClip(p, frame(t), '#000000', dur, 'adjust'); c.effects.push({ id: uid('fx'), type, enabled: true, params: defaultParams(type) }); store.select([c.id]); }) },
  { id: 'addTransition', name: { de: 'Übergang hinzufügen', en: 'Add transition' }, cat: 'fx', key: 'Ctrl+T', args: '{ type?, a?, b?, dur? }', run: ({ type = settings.defaultTransition || 'dissolve', a, b, dur } = {}) => {
    if (!TRANSITIONS[type]) throw new Error('Unbekannter Übergang ' + type);
    const P = store.p; let pairs = [];
    if (a && b) pairs = [[store.clip(a), store.clip(b)]];
    else {
      const s = sel().filter((c) => c.type !== 'audio');
      const pool = s.length ? s : P.clips.filter((c) => c.type !== 'audio' && (Math.abs(c.start - store.time) < 0.6 || Math.abs(clipEnd(c) - store.time) < 0.6));
      for (const c of pool) {
        const fused = P.transitions.find((t) => t.a === c.id); const next = fused ? store.clip(fused.b) : P.clips.find((o) => o.trackId === c.trackId && Math.abs(o.start - clipEnd(c)) < 1.5 / store.fps);
        if (next) pairs.push([c, next]);
        if (!s.length || (!next && s.length === 1)) { const prev = P.clips.find((o) => o.trackId === c.trackId && Math.abs(clipEnd(o) - c.start) < 1.5 / store.fps); if (prev) pairs.push([prev, c]); }
      }
    }
    pairs = pairs.filter(([x, y]) => x && y);
    if (!pairs.length) throw new Error(L('Kein Schnitt zwischen zwei Clips gefunden', 'No cut between two clips found'));
    store.edit('Übergang', (p) => {
      for (const [x, y] of pairs) {
        // fuse the two clips: B slides under A by the transition length
        let ex = p.transitions.find((t) => t.a === x.id && t.b === y.id);
        if (!ex) { ex = { id: uid('tr'), a: x.id, b: y.id, type, dur: 0, overlap: false, params: { intensity: 1, dir: 0 } }; p.transitions.push(ex); }
        ex.type = type;
        if (!ex.overlap && Math.abs(clipEnd(x) - y.start) > 1e-3) { const d0 = clipEnd(x) - y.start; for (const o of p.clips) if (o.trackId === y.trackId && o.start >= y.start - 1e-4) o.start += d0; }
        setTransitionOverlap(p, ex, dur || ex.dur || settings.defaultTransitionDur || 1);
        store.selTransition = ex.id;
      }
    });
    bus.emit('selection');
  } },
  { id: 'setTransitionDur', name: { de: 'Übergangslänge setzen (API)', en: 'Set transition length (API)' }, cat: 'fx', hidden: true, args: '{ id, dur }', run: ({ id, dur }) => store.edit('Übergangslänge', (p) => { const tr = p.transitions.find((t) => t.id === (id || store.selTransition)); if (!tr) throw new Error('Übergang?'); const d = setTransitionOverlap(p, tr, +dur); if (settings.magnet) rippleTrack(p, p.tracks.find((t) => t.kind === 'video').id); return d; }) },
  { id: 'setClipTransition', name: { de: 'Start-/End-Übergang setzen', en: 'Set intro/outro transition' }, cat: 'fx', args: '{ edge:"in"|"out"|"both", type, dur?, clipIds? }', run: ({ edge = 'in', type = 'dissolve', dur, clipIds } = {}) => {
    if (type && type !== 'none' && !TRANSITIONS[type]) throw new Error('Unbekannter Übergang ' + type);
    const s = clipIds ? clipIds.map((i) => store.clip(i)).filter(Boolean) : needSel();
    store.edit('Clip-Übergang', () => s.filter((c) => c.type !== 'audio').forEach((c) => {
      const d = Math.min(dur || settings.defaultTransitionDur, c.dur / 2);
      const v = type === 'none' ? null : { type, dur: d, params: { intensity: 1, dir: 0 } };
      if (edge === 'in' || edge === 'both') c.tIn = v ? { ...v } : null;
      if (edge === 'out' || edge === 'both') c.tOut = v ? { ...v } : null;
    }));
  } },
  { id: 'introFadeBlack', name: { de: 'Start: aus Schwarz', en: 'Intro: from black' }, cat: 'fx', run: () => run('setClipTransition', { edge: 'in', type: 'dipblack', dur: 0.8 }) },
  { id: 'outroFadeBlack', name: { de: 'Ende: zu Schwarz', en: 'Outro: to black' }, cat: 'fx', run: () => run('setClipTransition', { edge: 'out', type: 'dipblack', dur: 0.8 }) },
  { id: 'transitionsAll', name: { de: 'Übergang auf alle Schnitte', en: 'Transition on all cuts' }, cat: 'fx', args: '{ type? }', run: ({ type = 'dissolve', dur } = {}) => store.edit('Übergänge', (p) => {
    for (const tr of p.tracks.filter((t) => t.kind === 'video')) { const cs = p.clips.filter((c) => c.trackId === tr.id).sort((a, b) => a.start - b.start); for (let i = 0; i < cs.length - 1; i++) if (Math.abs(cs[i + 1].start - clipEnd(cs[i])) < 1.5 / store.fps && !p.transitions.some((t) => t.a === cs[i].id)) p.transitions.push({ id: uid('tr'), a: cs[i].id, b: cs[i + 1].id, type, dur: Math.min(dur || settings.defaultTransitionDur, cs[i].dur, cs[i + 1].dur), params: { intensity: 1, dir: 0 } }); }
  }) },
  { id: 'applyPreset', name: { de: 'Preset anwenden', en: 'Apply preset' }, cat: 'fx', args: '{ id }', run: ({ id }) => {
    const pr = [...BUILTIN_PRESETS, ...Object.values(userPresets).flat()].find((x) => x.id === id);
    if (!pr) throw new Error('Preset nicht gefunden');
    if (['color', 'realism', 'cinematic'].includes(pr.kind) && pr.effects) return run('applyFilter', { id });
    const s = needSel();
    store.edit('Preset', (p) => {
      for (const c of s) {
        if (pr.effects && c.type !== 'audio') for (const f of pr.effects) c.effects.push({ id: uid('fx'), type: f.type, enabled: true, params: Object.assign(defaultParams(f.type), deepClone(f.params || {})) });
        if (pr.text && c.type === 'text') Object.assign(c.text, deepClone(pr.text));
        if (pr.transform && c.type !== 'audio') Object.assign(c.transform, deepClone(pr.transform));
        if (pr.ramp && c.type !== 'text') setClipRamp(p, c, pr.ramp);
        if (pr.audio && c.type === 'audio') Object.assign(c.audio, deepClone(pr.audio));
      }
      fixOverlaps(p, s);
    });
  } },
  { id: 'applyFilter', name: { de: 'Filter setzen (ersetzt den vorherigen)', en: 'Set filter (replaces previous)' }, cat: 'fx', args: '{ id|null }', run: ({ id } = {}) => {
    const pr = id ? [...BUILTIN_PRESETS, ...Object.values(userPresets).flat()].find((x) => x.id === id) : null;
    if (id && !pr) throw new Error('Filter nicht gefunden');
    const s = needSel().filter((c) => c.type !== 'audio');
    store.edit(pr ? 'Filter: ' + pr.name : 'Filter entfernen', () => {
      for (const c of s) {
        c.effects = c.effects.filter((f) => !f.fromFilter);
        c.filter = pr ? pr.id : null; if (c.filterAmt === undefined) c.filterAmt = 1;
        if (pr?.effects) c.effects.push(...pr.effects.map((f) => ({ id: uid('fx'), type: f.type, enabled: true, fromFilter: pr.id, params: Object.assign(defaultParams(f.type), deepClone(f.params || {})) })));
      }
    });
  } },
  { id: 'savePresetFromClip', name: { de: 'Effekte als Preset speichern', en: 'Save effects as preset' }, cat: 'fx', run: async () => {
    const c = needSel()[0]; const name = await promptBox(L('Preset-Name', 'Preset name'), c.name + ' Look'); if (!name) return;
    savePreset(c.type === 'text' ? 'text' : 'effects', { id: uid('up'), name, effects: deepClone(c.effects.map((f) => ({ type: f.type, params: f.params }))), text: c.type === 'text' ? deepClone(c.text) : undefined, ramp: c.ramp ? deepClone(c.ramp) : undefined });
    toast(L('Preset gespeichert', 'Preset saved'), 'ok');
  } },
  { id: 'copyEffects', name: { de: 'Effekte kopieren', en: 'Copy effects' }, cat: 'fx', key: 'Ctrl+Alt+C', run: () => { const c = needSel()[0]; window.__fxClip = deepClone({ effects: c.effects, transform: c.transform }); toast(L('Effekte kopiert', 'Effects copied')); } },
  { id: 'pasteEffects', name: { de: 'Effekte einfügen', en: 'Paste effects' }, cat: 'fx', key: 'Ctrl+Alt+V', run: () => { const s = needSel(); const src = window.__fxClip; if (!src) return; store.edit('Effekte einfügen', () => s.forEach((c) => { if (c.type === 'audio') return; c.effects.push(...deepClone(src.effects).map((f) => ({ ...f, id: uid('fx') }))); })); } },

  // ---------------------------------------------------------------- insert
  { id: 'addText', name: { de: 'Text hinzufügen', en: 'Add text' }, cat: 'insert', key: 'T', args: '{ content?, t?, dur?, style? }', run: ({ content, t, dur = 3, style = {} } = {}) => store.edit('Text', (p) => { const c = addTextClip(p, frame(t ?? store.time), { ...(content ? { content } : {}), ...style }, dur); store.select([c.id]); bus.emit('inspect', c.id, 'text'); return c.id; }) },
  { id: 'addSolid', name: { de: 'Farbfläche hinzufügen', en: 'Add color matte' }, cat: 'insert', run: ({ color = '#000000', gradient = '', t, dur = 3 } = {}) => store.edit('Farbfläche', (p) => { const c = addSolidClip(p, frame(t ?? store.time), color, dur, 'solid', gradient); store.select([c.id]); return c.id; }) },
  { id: 'addAdjustment', name: { de: 'Einstellungsebene', en: 'Adjustment layer' }, cat: 'insert', key: 'Ctrl+Shift+J', run: ({ t, dur = 3 } = {}) => store.edit('Einstellungsebene', (p) => { const c = addSolidClip(p, frame(t ?? store.time), '#000', dur, 'adjust'); store.select([c.id]); return c.id; }) },
  { id: 'addShape', name: { de: 'Form / Grafik hinzufügen', en: 'Add shape / graphic' }, cat: 'insert', key: 'Shift+G', args: '{ kind?, t?, dur?, shape? }', run: ({ kind = 'rect', t, dur = 3, shape = {} } = {}) => store.edit('Form', (p) => { const c = addShapeClip(p, frame(t ?? store.time), { kind, ...shape }, dur); store.select([c.id]); bus.emit('inspect', c.id, 'shape'); return c.id; }) },
  { id: 'addSticker', name: { de: 'Sticker (Emoji) hinzufügen', en: 'Add sticker (emoji)' }, cat: 'insert', args: '{ emoji, t? }', run: ({ emoji = '🔥', t, loop = 'pulse' } = {}) => store.edit('Sticker', (p) => { const c = addTextClip(p, frame(t ?? store.time), { content: emoji, font: 'Segoe UI Emoji', size: 220, weight: 400, shadow: 0.3, anim: 'pop', animOut: 'pop', loop }, 2); c.name = 'Sticker ' + emoji; store.select([c.id]); return c.id; }) },
  { id: 'addOverlay', name: { de: 'Overlay hinzufügen (Feuer, Regen, …)', en: 'Add overlay (fire, rain, …)' }, cat: 'insert', args: '{ type, params?, t?, dur? }', run: ({ type = 'rain', params = {}, t, dur = 5 } = {}) => store.edit('Overlay', (p) => { const c = addSolidClip(p, frame(t ?? store.time), '#000', dur, 'adjust'); c.name = 'Overlay: ' + (EFFECTS[type]?.name?.de || type); c.effects.push({ id: uid('fx'), type, enabled: true, params: Object.assign(defaultParams(type), params) }); store.select([c.id]); return c.id; }) },
  { id: 'addParticles', name: { de: 'Partikel-Emitter hinzufügen', en: 'Add particle emitter' }, cat: 'insert', args: '{ preset? }', run: async ({ preset = 'fireworks', t, dur = 4 } = {}) => { const { EMITTER_PRESETS } = await import('../render/effects3.js'); const pr = EMITTER_PRESETS[preset] || EMITTER_PRESETS.fireworks; return run('addOverlay', { type: 'emitter', params: { ...pr.p }, t, dur }); } },
  { id: 'addCamera', name: { de: '3D-Kamera hinzufügen', en: 'Add 3D camera' }, cat: 'insert', args: '{ t?, dur?, preset? }', run: ({ t, dur, preset = 'dollyIn' } = {}) => {
    const t0 = frame(t ?? 0), d = dur || Math.max(3, store.duration() - t0);
    const id = store.edit('3D-Kamera', (p) => {
      const tr = freeVideoTrack(p, t0, t0 + d, 1);
      const c = newClip({ trackId: tr.id, type: 'camera', name: '🎥 3D-Kamera', start: t0, dur: d, cam: { x: 0, y: 0, dolly: 0, rx: 0, ry: 0, rz: 0, persp: 1.6 } });
      p.clips.push(c);
      // make every visual clip below a 3D layer so the camera has something to move
      for (const o of p.clips) if (['video', 'image', 'text', 'shape', 'solid', 'compound'].includes(o.type) && o.start < t0 + d && o.start + o.dur > t0) o.layer3d = true;
      store.select([c.id]); return c.id;
    });
    return run('cameraPreset', { preset, id }).then(() => id);
  } },
  { id: 'cameraPreset', name: { de: 'Kamerafahrt (Preset)', en: 'Camera move (preset)' }, cat: 'insert', hidden: true, args: '{ preset, id? }', run: ({ preset = 'dollyIn', id } = {}) => {
    const c = id ? store.clip(id) : store.p.clips.find((x) => x.type === 'camera'); if (!c) throw new Error(L('Keine 3D-Kamera', 'No 3D camera'));
    const D = c.dur, k = (a, b, e = 'easeInOut') => ({ kf: [{ t: 0, v: a, e }, { t: D, v: b, e }] });
    const P = { orbit: { ry: k(-25, 25), dolly: k(-200, -200) }, dollyIn: { dolly: k(-400, 350) }, dollyOut: { dolly: k(350, -400) }, crane: { y: k(260, -220), rx: k(14, -6) }, panLR: { x: k(-350, 350), ry: k(8, -8) }, tiltDown: { rx: k(-18, 10), y: k(-120, 80) }, vertigo: { dolly: k(-500, 300), persp: k(3.2, 0.9) }, roll: { rz: k(-8, 8), dolly: k(-100, 150) } }[preset];
    if (!P) throw new Error('Preset?');
    store.edit('Kamerafahrt', () => { c.cam = { x: 0, y: 0, dolly: 0, rx: 0, ry: 0, rz: 0, persp: 1.6, ...P }; });
  } },
  { id: 'parallaxLayers', name: { de: 'Auswahl als Parallax-Ebenen (3D-Tiefe verteilen)', en: 'Selection as parallax layers' }, cat: 'insert', run: () => {
    const s = needSel().filter((c) => c.type !== 'audio' && c.type !== 'camera');
    const vt = store.p.tracks.filter((t) => t.kind === 'video');
    s.sort((a, b) => vt.findIndex((t) => t.id === a.trackId) - vt.findIndex((t) => t.id === b.trackId));
    store.edit('Parallax', () => s.forEach((c, i) => { c.layer3d = true; const z = -1200 + (i / Math.max(1, s.length - 1)) * 1200; c.transform.z = z; const d = store.p.settings.height * 1.6; c.transform.scale = (typeof c.transform.scale === 'number' ? c.transform.scale : 1) * ((d - z) / d); }));
    if (!store.p.clips.some((c) => c.type === 'camera')) return run('addCamera', { preset: 'panLR' });
  } },
  ...[['tl', 'oben links', 'top left', -1, -1], ['tr', 'oben rechts', 'top right', 1, -1], ['bl', 'unten links', 'bottom left', -1, 1], ['br', 'unten rechts', 'bottom right', 1, 1], ['c', 'Mitte (klein)', 'center (small)', 0, 0]].map(([k, de, en, sx, sy]) => ({
    id: 'pip:' + k, name: { de: 'Bild-im-Bild ' + de, en: 'Picture-in-picture ' + en }, cat: 'clip', run: () => {
      const s = needSel().filter((c) => c.type !== 'audio'); const P = store.p.settings;
      store.edit('Bild-im-Bild', () => s.forEach((c) => { const sc = 0.32; c.transform.scale = sc; c.transform.x = sx * (P.width / 2 - P.width * sc / 2 - P.width * 0.03); c.transform.y = sy * (P.height / 2 - P.height * sc / 2 - P.height * 0.04);
        if (!c.effects.some((f) => f.type === 'roundcorners')) c.effects.push({ id: uid('fx'), type: 'roundcorners', enabled: true, params: { radius: 0.04 } });
        if (!c.effects.some((f) => f.type === 'dropshadow')) c.effects.push({ id: uid('fx'), type: 'dropshadow', enabled: true, params: defaultParams('dropshadow') }); }));
    } })),
  { id: 'splitScreen2', name: { de: 'Split-Screen (2 Clips nebeneinander)', en: 'Split screen (2 clips side by side)' }, cat: 'clip', run: () => {
    const s = store.selectedClips().filter((c) => c.type === 'video' || c.type === 'image');
    if (s.length < 2) throw new Error(L('Zwei Clips auf verschiedenen Spuren auswählen (Strg+Klick)', 'Select two clips on different tracks (Ctrl+click)'));
    const P = store.p.settings; const vert = P.height > P.width;
    store.edit('Split-Screen', () => s.slice(0, 2).forEach((c, i) => { const m = store.media(c.mediaId); const fit = Math.min(P.width / m.width, P.height / m.height); const fill = vert ? (P.height / 2) / (m.height * fit) : (P.width / 2) / (m.width * fit);
      c.transform.scale = Math.max(fill, vert ? P.width / (m.width * fit) : P.height / (m.height * fit)); c.transform.x = vert ? 0 : (i ? 1 : -1) * P.width / 4; c.transform.y = vert ? (i ? 1 : -1) * P.height / 4 : 0;
      c.transform.cropL = 0; c.transform.cropR = 0; c.transform.cropT = 0; c.transform.cropB = 0;
      if (!vert) { const visible = (P.width / 2) / (m.width * fit * c.transform.scale); const cut = Math.max(0, (1 - visible) / 2); c.transform.cropL = cut; c.transform.cropR = cut; c.transform.x = (i ? 1 : -1) * P.width / 4; }
      else { const visible = (P.height / 2) / (m.height * fit * c.transform.scale); const cut = Math.max(0, (1 - visible) / 2); c.transform.cropT = cut; c.transform.cropB = cut; } }));
  } },
  { id: 'snapshotToTimeline', name: { de: 'Standbild als Foto in Timeline', en: 'Snapshot frame as photo on timeline' }, cat: 'clip', key: 'Ctrl+Shift+F', run: async () => {
    const { exportStill } = await import('./exporter.js'); const path = require('path'); const { paths: pp } = await import('../core/settings.js');
    const f = await exportStill(path.join(pp.velox, 'Standbilder', `Snapshot_${Date.now()}.png`)); if (!f) return;
    const { importFiles, placeMedia: pm } = await import('../core/media.js'); const [m] = await importFiles([f]);
    store.edit('Snapshot', (p) => { const tr = freeVideoTrack(p, store.time, store.time + 3, 1); const cs = pm(p, m, frame(store.time), { videoTrackId: tr.id }); store.select(cs.map((c) => c.id)); });
  } },
  { id: 'addMarker', name: { de: 'Marker setzen', en: 'Add marker' }, cat: 'insert', key: 'M', args: '{ t?, name?, color? }', run: ({ t, name = '', color = '#ffb547' } = {}) => store.edit('Marker', (p) => { p.markers.push({ id: uid('mk'), t: frame(t ?? store.time), name, color }); }) },
  { id: 'clearMarkers', name: { de: 'Alle Marker löschen', en: 'Clear markers' }, cat: 'insert', run: () => store.edit('Marker', (p) => { p.markers = []; }) },
  { id: 'addVideoTrack', name: { de: 'Videospur hinzufügen', en: 'Add video track' }, cat: 'insert', run: () => store.edit('Spur', (p) => { const vt = p.tracks.filter((t) => t.kind === 'video'); const i = p.tracks.indexOf(vt[vt.length - 1]); p.tracks.splice(i + 1, 0, newTrack(p, 'video')); }) },
  { id: 'addAudioTrack', name: { de: 'Audiospur hinzufügen', en: 'Add audio track' }, cat: 'insert', run: () => store.edit('Spur', (p) => { p.tracks.push(newTrack(p, 'audio')); }) },

  { id: 'formatLandscape', name: { de: 'Format: Horizontal 16:9', en: 'Format: landscape 16:9' }, cat: 'file', run: () => setOrientation('h') },
  { id: 'formatVertical', name: { de: 'Format: Vertikal 9:16 (TikTok)', en: 'Format: vertical 9:16 (TikTok)' }, cat: 'file', key: 'Ctrl+Alt+T', run: () => setOrientation('v') },
  { id: 'formatSquare', name: { de: 'Format: Quadratisch 1:1', en: 'Format: square 1:1' }, cat: 'file', run: () => setOrientation('s') },
  { id: 'setProjectSettings', name: { de: 'Projekteinstellungen setzen (API)', en: 'Set project settings (API)' }, cat: 'file', hidden: true, args: '{ width?, height?, fps?, bg?, name? }', run: ({ width, height, fps, bg, name } = {}) => store.edit('Projekteinstellungen', (p) => { if (width) p.settings.width = Math.round(width / 2) * 2; if (height) p.settings.height = Math.round(height / 2) * 2; if (fps) p.settings.fps = +fps; if (bg) p.settings.bg = bg; if (name) p.name = name; return p.settings; }) },
  { id: 'clearTimeline', name: { de: 'Timeline leeren', en: 'Clear timeline' }, cat: 'edit', run: () => store.edit('Timeline leeren', (p) => { p.clips = []; p.transitions = []; p.markers = []; p.inPoint = null; p.outPoint = null; store.selection.clear(); }) },
  // ---------------------------------------------------------------- timeline view / tools
  { id: 'toolSelect', name: { de: 'Auswahl-Werkzeug', en: 'Selection tool' }, cat: 'tools', key: 'V', run: () => setTool('select') },
  { id: 'toolRazor', name: { de: 'Klinge (einmal an Mausposition schneiden)', en: 'Blade (one cut at mouse)' }, cat: 'tools', key: 'C', run: () => setTool(tl.tool === 'razor' ? 'select' : 'razor') },
  { id: 'openSpeed', name: { de: 'Tempo-Regler', en: 'Speed control' }, cat: 'clip', key: 'Ctrl+Shift+T', run: async () => { const { speedPopover } = await import('./timeline.js'); speedPopover(document.querySelector('#tl-toolbar .tl-btn') || document.body); } },
  { id: 'zoomIn', name: { de: 'Timeline hineinzoomen', en: 'Zoom in' }, cat: 'view', key: 'Plus,=', run: () => zoomBy(1.4) },
  { id: 'zoomOut', name: { de: 'Timeline herauszoomen', en: 'Zoom out' }, cat: 'view', key: '-', run: () => zoomBy(1 / 1.4) },
  { id: 'zoomFit', name: { de: 'Timeline einpassen', en: 'Zoom to fit' }, cat: 'view', key: 'Shift+Z', run: () => zoomFit() },
  { id: 'toggleSnap', name: { de: 'Einrasten an/aus', en: 'Toggle snapping' }, cat: 'view', key: 'N', run: () => { setSetting('snapping', !settings.snapping); buildToolbar(); toast(L('Einrasten ', 'Snapping ') + (settings.snapping ? 'an' : 'aus')); } },
  { id: 'toggleMagnet', name: { de: 'Magnetische Timeline an/aus', en: 'Toggle magnetic timeline' }, cat: 'view', key: 'Shift+M', run: () => { setSetting('magnet', !settings.magnet); buildToolbar(); toast(L('Magnet ', 'Magnet ') + (settings.magnet ? 'an' : 'aus')); } },
  { id: 'toggleLinkedSel', name: { de: 'Verknüpfte Auswahl an/aus', en: 'Toggle linked selection' }, cat: 'view', key: 'Ctrl+Shift+Y', run: () => { tl.linkedSel = !tl.linkedSel; buildToolbar(); } },
]);

function editPoints() {
  const s = new Set([0]); for (const c of store.p.clips) { s.add(c.start); s.add(clipEnd(c)); } for (const m of store.p.markers) s.add(m.t);
  return [...s].sort((a, b) => a - b);
}
function trimToPlayhead(side) {
  const t = frame(store.time);
  const targets = selOrUnderPlayhead().filter((c) => c.start < t && clipEnd(c) > t);
  if (!targets.length) return;
  store.edit('Trimmen', (p) => {
    for (const c of targets) {
      if (side === 'start') { const d = t - c.start; trimClipStart(p, c, d); if (settings.magnet) { for (const o of p.clips) if (o.trackId === c.trackId && o.start >= clipEnd(c) - 1e-4) o.start -= d; c.start -= d; } }
      else trimClipEnd(p, c, t - c.start);
    }
    if (settings.magnet) rippleTrack(p, p.tracks.find((x) => x.kind === 'video').id);
    dropBrokenTransitions(p);
  });
  if (side === 'start' && settings.magnet) engine.seek(targets[0].start);
}
function nudge(n) { const s = needSel(); store.edit('Verschieben', () => s.forEach((c) => (c.start = Math.max(0, c.start + n / store.fps)))); }
function moveTrack(dir) {
  const s = needSel();
  store.edit('Spur wechseln', (p) => {
    for (const c of s) {
      const kind = c.type === 'audio' ? 'audio' : 'video';
      const list = p.tracks.filter((t) => t.kind === kind);
      const i = list.findIndex((t) => t.id === c.trackId) + (kind === 'video' ? dir : -dir);
      if (i < 0) continue;
      if (i >= list.length) { const nt = newTrack(p, kind); if (kind === 'video') p.tracks.splice(p.tracks.indexOf(list[list.length - 1]) + 1, 0, nt); else p.tracks.push(nt); c.trackId = nt.id; }
      else { clearRange(p, list[i].id, c.start, clipEnd(c), new Set([c.id])); c.trackId = list[i].id; }
    }
    dropBrokenTransitions(p);
  });
}
// after speed changes clips grow/shrink: push following clips on same track (ripple) to avoid overlaps
function fixOverlaps(p, changed) {
  for (const c of changed) {
    const following = p.clips.filter((o) => o.trackId === c.trackId && o.id !== c.id && o.start > c.start).sort((a, b) => a.start - b.start);
    const next = following[0];
    if (next && next.start < clipEnd(c) - 1e-4) {
      const d = clipEnd(c) - next.start;
      const move = new Set(following.map((o) => o.id));
      for (const o of following) if (o.linkId) p.clips.forEach((x) => { if (x.linkId === o.linkId && !changed.includes(x)) move.add(x.id); });
      for (const o of p.clips) if (move.has(o.id)) o.start += d;
    } else if (settings.magnet && p.tracks.find((t) => t.kind === 'video')?.id === c.trackId) rippleTrack(p, c.trackId);
  }
  // keep linked audio aligned to video length
  for (const c of changed) for (const l of store.linked(c)) { if (l.speed !== c.speed || JSON.stringify(l.ramp) !== JSON.stringify(c.ramp)) { l.speed = c.speed; l.ramp = deepClone(c.ramp); l.dur = c.dur; l.start = c.start; } }
  dropBrokenTransitions(p);
}
export { fixOverlaps };

// change project aspect only; working size stays ~1080p (export picks the real resolution, up to 8K)
const ORIENT = { h: [1920, 1080], v: [1080, 1920], s: [1080, 1080], p: [1080, 1350], c: [2520, 1080] };
export function setOrientation(k) {
  const d = ORIENT[k]; if (!d) return;
  store.edit(L('Format ändern', 'Change format'), (p) => { p.settings.width = d[0]; p.settings.height = d[1]; p.settings.autoFormat = false; });
  toast(L('Format: ', 'Format: ') + d[0] + '×' + d[1] + L(' – Export bis 8K möglich', ' – export up to 8K'));
}
