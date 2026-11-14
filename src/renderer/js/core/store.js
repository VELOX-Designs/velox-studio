// Local effect / transition / preset store. Packs install presets into the user library.
import { userPresets, savePreset, paths } from './settings.js';
import { uid } from './util.js';
const fs = require('fs');
const path = require('path');

const fx = (type, params = {}) => ({ type, params });
export const STORE_PACKS = [
  { id: 'pack_gta_cine', name: 'GTA Cinematic Pack', icon: '🚓', color: '#3d6bd6', desc: { de: 'Looks für Rockstar-Editor-Clips: Sunset, Night City, Bodycam, Heli-Cam', en: 'Looks for Rockstar Editor clips' },
    items: [
      { kind: 'color', name: 'Night City', effects: [fx('realism', { preset: 4, strength: 0.8 }), fx('color', { temperature: -0.2, contrast: 0.2 }), fx('glow', { threshold: 0.65, radius: 35, intensity: 0.8 })] },
      { kind: 'effects', name: 'Bodycam', effects: [fx('fisheye', { amount: 0.45 }), fx('color', { saturation: -0.3, contrast: 0.2 }), fx('shake', { amp: 8, freq: 6 }), fx('grain', { amount: 0.35 }), fx('vignette', { amount: 0.5 })] },
      { kind: 'effects', name: 'Heli-Cam', effects: [fx('bw', { contrast: 0.35, tintC: '#d8ffd8' }), fx('scanlines', { amount: 0.2 }), fx('grain', { amount: 0.4 }), fx('shake', { amp: 4, freq: 2 })] },
      { kind: 'color', name: 'Vinewood Gold', effects: [fx('color', { temperature: 0.4, saturation: 0.15, highlights: -0.15 }), fx('lensflare', { intensity: 0.6 })] },
    ] },
  { id: 'pack_velocity', name: 'Velocity Edit Pack', icon: '⚡', color: '#ffb547', desc: { de: 'Shake, Impact, Flash und RGB-Kombos für Velocity-Edits', en: 'Shake, impact, flash and RGB combos for velocity edits' },
    items: [
      { kind: 'effects', name: 'Hard Impact', effects: [fx('shake', { amp: 30, freq: 18, rot: 4 }), fx('rgbsplit', { amount: 14 }), fx('strobe', { rate: 1, amount: 0.6 })] },
      { kind: 'effects', name: 'Smooth Velocity', effects: [fx('motionblur', { shutter: 540, samples: 16 }), fx('zoompulse', { amount: 0.08, bpm: 100 })] },
      { kind: 'effects', name: 'Chroma Hit', effects: [fx('chromatic', { amount: 0.6 }), fx('zoomblur', { strength: 0.15 })] },
      { kind: 'effects', name: 'Flash Pulse', effects: [fx('strobe', { rate: 2, amount: 0.5 }), fx('glow', { threshold: 0.5, intensity: 1 })] },
    ] },
  { id: 'pack_film', name: 'Film Emulation Pack', icon: '🎞', color: '#a0763a', desc: { de: 'Analoge Filmlooks mit Korn, Halation und Gate Weave', en: 'Analog film looks with grain and halation' },
    items: [
      { kind: 'color', name: 'Portra Warm', effects: [fx('color', { temperature: 0.15, saturation: -0.05, fade: 0.1 }), fx('curves', { master: [[0, 0.04], [0.3, 0.27], [0.7, 0.75], [1, 0.97]] }), fx('grain', { amount: 0.3 })] },
      { kind: 'color', name: 'Cine 500T', effects: [fx('color', { temperature: -0.15, tint: 0.05, contrast: 0.1 }), fx('glow', { threshold: 0.75, radius: 20, intensity: 0.7, tintC: '#ff7a4d' }), fx('grain', { amount: 0.4 })] },
      { kind: 'color', name: 'Super 8', effects: [fx('color', { temperature: 0.3, saturation: -0.2, contrast: 0.15, fade: 0.2 }), fx('grain', { amount: 0.6, size: 2 }), fx('vignette', { amount: 0.6 }), fx('wiggle', { rot: 0.3, freq: 3 })] },
    ] },
  { id: 'pack_social', name: 'Social Media Pack', icon: '📱', color: '#b8569e', desc: { de: 'Caption-Stile & Looks für TikTok, Reels, Shorts', en: 'Caption styles & looks for TikTok, Reels, Shorts' },
    items: [
      { kind: 'text', name: 'Hormozi Caption', text: { size: 92, weight: 900, color: '#ffffff', stroke: 7, strokeColor: '#000000', anim: 'words', upper: true, shadow: 0.6 } },
      { kind: 'text', name: 'Yellow Pop', text: { size: 88, weight: 900, color: '#ffe14d', stroke: 6, anim: 'letterPop', upper: true } },
      { kind: 'text', name: 'Clean Minimal', text: { size: 64, weight: 500, color: '#ffffff', anim: 'fade', animOut: 'fade' } },
      { kind: 'color', name: 'Insta Bright', effects: [fx('color', { exposure: 0.2, vibrance: 0.35, contrast: 0.08 })] },
    ] },
];

const file = () => path.join(paths.userData, 'presets', 'installed-packs.json');
export function installedPacks() { try { return new Set(JSON.parse(fs.readFileSync(file(), 'utf8'))); } catch { return new Set(); } }
export function installPack(id) {
  const pk = STORE_PACKS.find((p) => p.id === id); if (!pk) return;
  for (const it of pk.items) savePreset(it.kind, { id: uid('pk'), name: it.name, effects: it.effects, text: it.text, pack: id });
  const s = installedPacks(); s.add(id); fs.writeFileSync(file(), JSON.stringify([...s]));
}
