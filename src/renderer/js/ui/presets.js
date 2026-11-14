// Built-in preset library: color looks, cinematic stacks, velocity curves, text styles,
// social media / gaming templates. User presets are stored separately (settings.js).

export const VELOCITY_PRESETS = {
  montage: { name: 'Montage', ramp: [{ u: 0, v: 3 }, { u: 0.35, v: 3 }, { u: 0.45, v: 0.3 }, { u: 0.7, v: 0.3 }, { u: 0.8, v: 3 }, { u: 1, v: 3 }], fx: true },
  hero: { name: 'Hero', ramp: [{ u: 0, v: 1 }, { u: 0.3, v: 1 }, { u: 0.4, v: 0.15 }, { u: 0.75, v: 0.15 }, { u: 0.85, v: 1.5 }, { u: 1, v: 1.5 }] },
  bullet: { name: 'Bullet', ramp: [{ u: 0, v: 4 }, { u: 0.4, v: 4 }, { u: 0.5, v: 0.1 }, { u: 0.6, v: 0.1 }, { u: 0.7, v: 4 }, { u: 1, v: 4 }], fx: true },
  jumpcut: { name: 'Jump Cut', ramp: [{ u: 0, v: 1 }, { u: 0.25, v: 1 }, { u: 0.26, v: 6 }, { u: 0.5, v: 6 }, { u: 0.51, v: 1 }, { u: 0.75, v: 1 }, { u: 0.76, v: 6 }, { u: 1, v: 6 }] },
  flashIn: { name: 'Flash In', ramp: [{ u: 0, v: 6 }, { u: 0.35, v: 2 }, { u: 0.6, v: 1 }, { u: 1, v: 1 }], fx: true },
  flashOut: { name: 'Flash Out', ramp: [{ u: 0, v: 1 }, { u: 0.4, v: 1 }, { u: 0.65, v: 2 }, { u: 1, v: 6 }], fx: true },
  smooth: { name: 'Smooth', ramp: [{ u: 0, v: 0.5 }, { u: 0.5, v: 1.6 }, { u: 1, v: 0.5 }] },
  velocityEdit: { name: 'Velocity Edit', ramp: [{ u: 0, v: 0.35 }, { u: 0.4, v: 0.35 }, { u: 0.5, v: 5 }, { u: 0.6, v: 5 }, { u: 0.7, v: 0.35 }, { u: 1, v: 0.35 }], fx: true },
  slowEnd: { name: 'Slow-Mo Ende', ramp: [{ u: 0, v: 1 }, { u: 0.6, v: 1 }, { u: 0.75, v: 0.2 }, { u: 1, v: 0.2 }] },
  speedUp: { name: 'Beschleunigen', ramp: [{ u: 0, v: 0.5 }, { u: 1, v: 4 }] },
};

const fx = (type, params = {}) => ({ type, params });
export const BUILTIN_PRESETS = [
  // ---------------- color looks
  { id: 'look_teal_orange', kind: 'color', name: 'Teal & Orange', effects: [fx('color', { contrast: 0.15, saturation: 0.1, temperature: 0.1 }), fx('wheels', { lift: '#5e8f99', gain: '#c79a6b', mix: 0.8 }), fx('vignette', { amount: 0.3 })] },
  { id: 'look_bleach', kind: 'color', name: 'Bleach Bypass', effects: [fx('color', { contrast: 0.35, saturation: -0.45, highlights: -0.1 }), fx('grain', { amount: 0.2 })] },
  { id: 'look_film', kind: 'color', name: 'Kodak Film', effects: [fx('color', { contrast: 0.12, saturation: 0.08, temperature: 0.12, fade: 0.12 }), fx('curves', { master: [[0, 0.05], [0.25, 0.22], [0.75, 0.8], [1, 0.96]] }), fx('grain', { amount: 0.3 }), fx('vignette', { amount: 0.35 })] },
  { id: 'look_moody', kind: 'color', name: 'Moody Dark', effects: [fx('color', { exposure: -0.25, contrast: 0.25, saturation: -0.25, shadows: -0.2, temperature: -0.12 }), fx('vignette', { amount: 0.55 })] },
  { id: 'look_cyber', kind: 'color', name: 'Cyberpunk', effects: [fx('color', { contrast: 0.2, saturation: 0.35, tint: 0.25, temperature: -0.2 }), fx('glow', { threshold: 0.6, radius: 30, intensity: 0.9, tintC: '#ff4fd8' }), fx('chromatic', { amount: 0.25 })] },
  { id: 'look_vintage', kind: 'color', name: 'Vintage 70s', effects: [fx('color', { temperature: 0.3, saturation: -0.15, fade: 0.25, contrast: -0.05 }), fx('grain', { amount: 0.45 }), fx('vignette', { amount: 0.45 })] },
  { id: 'look_noir', kind: 'color', name: 'Film Noir', effects: [fx('bw', { contrast: 0.45 }), fx('grain', { amount: 0.35 }), fx('vignette', { amount: 0.6 })] },
  { id: 'look_summer', kind: 'color', name: 'Summer Vibes', effects: [fx('color', { exposure: 0.15, saturation: 0.25, vibrance: 0.3, temperature: 0.2 }), fx('lightleak', { intensity: 0.35 })] },
  { id: 'look_cold', kind: 'color', name: 'Cold Blue', effects: [fx('color', { temperature: -0.4, saturation: -0.1, contrast: 0.15 })] },
  { id: 'look_matrix', kind: 'color', name: 'Matrix Green', effects: [fx('color', { tint: -0.35, saturation: -0.2, contrast: 0.25 }), fx('vignette', { amount: 0.4 })] },
  { id: 'look_gta', kind: 'color', name: 'GTA Sunset', effects: [fx('color', { temperature: 0.35, saturation: 0.2, contrast: 0.2, highlights: -0.2 }), fx('wheels', { gain: '#d29a63', lift: '#5a5f86', mix: 0.7 }), fx('glow', { threshold: 0.7, radius: 40, intensity: 0.6 })] },
  { id: 'look_hdr_pop', kind: 'color', name: 'HDR Pop', effects: [fx('hdr', { amount: 0.7 }), fx('color', { vibrance: 0.3 })] },
  // ---------------- realism
  { id: 'real_photo', kind: 'realism', name: 'Fotoreal (GTA → Real)', effects: [fx('realism', { preset: 1, strength: 0.9 }), fx('superres', { amount: 0.5, denoise: 0.25 })] },
  { id: 'real_cine', kind: 'realism', name: 'Realism Cinematic', effects: [fx('realism', { preset: 2, strength: 0.85, bloom: 0.45 }), fx('letterbox', {})] },
  { id: 'real_nextgen', kind: 'realism', name: 'Next-Gen Remaster', effects: [fx('realism', { preset: 3, strength: 0.9, lighting: 0.8, detail: 1.1 })] },
  { id: 'real_night', kind: 'realism', name: 'Nacht-Realismus', effects: [fx('realism', { preset: 4, strength: 0.85, bloom: 0.6, grain: 0.4 })] },
  // ---------------- cinematic
  { id: 'cine_239', kind: 'cinematic', name: 'Cinema 2.39 + Grain', effects: [fx('letterbox', { ratio: 0 }), fx('grain', { amount: 0.25 }), fx('vignette', { amount: 0.35 })] },
  { id: 'cine_dream', kind: 'cinematic', name: 'Dreamy Glow', effects: [fx('glow', { threshold: 0.45, radius: 50, intensity: 0.8 }), fx('color', { fade: 0.15, saturation: -0.1 })] },
  { id: 'cine_action', kind: 'cinematic', name: 'Action Shake', effects: [fx('shake', { amp: 18, freq: 10 }), fx('motionblur', {}), fx('color', { contrast: 0.2, saturation: -0.1 })] },
  { id: 'cine_vhs', kind: 'cinematic', name: 'VHS Tape', effects: [fx('vhs', { amount: 0.7 }), fx('scanlines', { amount: 0.25 })] },
  { id: 'cine_flare', kind: 'cinematic', name: 'Anamorphic Flare', effects: [fx('lensflare', { intensity: 0.8 }), fx('letterbox', {})] },
  // ---------------- gaming edits
  { id: 'game_impact', kind: 'gaming', name: 'Impact Frame', effects: [fx('zoompulse', { amount: 0.15, bpm: 120 }), fx('rgbsplit', { amount: 10 }), fx('shake', { amp: 12, freq: 14 })] },
  { id: 'game_glitchy', kind: 'gaming', name: 'Glitch Montage', effects: [fx('glitch', { amount: 0.35 }), fx('rgbsplit', { amount: 6 }), fx('color', { contrast: 0.2 })] },
  { id: 'game_beat', kind: 'gaming', name: 'Beat Zoom 128', effects: [fx('zoompulse', { amount: 0.1, bpm: 128 }), fx('strobe', { rate: 2.13, amount: 0.25 })] },
  { id: 'game_neon', kind: 'gaming', name: 'Neon Outline', effects: [fx('neon', { colorA: '#00e5ff' }), fx('color', { saturation: 0.3 })] },
  { id: 'game_slowmo', kind: 'gaming', name: 'Slowmo Highlight', ramp: VELOCITY_PRESETS.hero.ramp, effects: [fx('motionblur', {}), fx('vignette', { amount: 0.4 })] },
  // ---------------- text styles
  { id: 'txt_title', kind: 'text', name: 'Titel Bold', text: { size: 150, weight: 900, color: '#ffffff', shadow: 0.6, anim: 'pop', upper: true } },
  { id: 'txt_neon', kind: 'text', name: 'Neon', text: { size: 130, weight: 700, color: '#ffffff', glow: 40, glowColor: '#ff2bd6', anim: 'fade', loop: 'pulse' } },
  { id: 'txt_sub', kind: 'text', name: 'Untertitel', text: { size: 64, weight: 700, color: '#ffffff', stroke: 4, strokeColor: '#000000', shadow: 0.3 } },
  { id: 'txt_tiktok', kind: 'text', name: 'TikTok Caption', text: { size: 78, weight: 900, color: '#ffffff', stroke: 6, strokeColor: '#000000', anim: 'words', upper: true } },
  { id: 'txt_gradient', kind: 'text', name: 'Gradient', text: { size: 140, weight: 900, color: '#7c5cff', color2: '#22d3ee', anim: 'slideUp' } },
  { id: 'txt_type', kind: 'text', name: 'Schreibmaschine', text: { font: 'Consolas', size: 80, weight: 400, color: '#e8ffe8', anim: 'typewriter', animDur: 1.5 } },
  { id: 'txt_3d', kind: 'text', name: '3D Extrude', text: { size: 160, weight: 900, color: '#ffd23f', extrude: 14, extrudeColor: '#a3470c', anim: 'letterDrop' } },
  { id: 'txt_box', kind: 'text', name: 'Lower Third', text: { size: 56, weight: 700, color: '#111111', bg: '#ffffff', bgPad: 18, bgRadius: 8, anim: 'slideLeft', animOut: 'fade' } },
  { id: 'txt_glitch', kind: 'text', name: 'Glitch Text', text: { size: 140, weight: 900, color: '#ffffff', anim: 'glitchIn', loop: 'shake' } },
  { id: 'txt_karaoke', kind: 'text', name: 'Karaoke', text: { size: 80, weight: 800, color: '#ffe14d', anim: 'karaoke', animDur: 2.5, stroke: 4 } },
  { id: 'txt_rainbow', kind: 'text', name: 'Rainbow Wave', text: { size: 130, weight: 900, loop: 'wave', anim: 'letterPop' } },
  { id: 'txt_cine', kind: 'text', name: 'Cinematic Titel', text: { font: 'Georgia', size: 110, weight: 400, letter: 24, color: '#f2efe6', anim: 'spread', animDur: 2, animOut: 'fade', upper: true } },
  // ---------------- audio
  { id: 'aud_voice', kind: 'audio', name: 'Stimme verbessern', audio: { voice: true, denoise: 0.5, eqHigh: 2 } },
  { id: 'aud_music_duck', kind: 'audio', name: 'Musik (Ducking)', audio: { duck: true } },
  { id: 'aud_radio', kind: 'audio', name: 'Funk / Radio', audio: { eqLow: -15, eqHigh: -10, eqMid: 8 } },
  { id: 'aud_hall', kind: 'audio', name: 'Halle', audio: { reverb: 0.6 } },
  { id: 'aud_echo', kind: 'audio', name: 'Echo', audio: { echo: 0.5 } },
];

// project templates (social media / gaming formats)
export const PROJECT_TEMPLATES = [
  { id: 'yt4k', name: 'YouTube 4K', w: 3840, h: 2160, fps: 60, sub: '3840×2160 · 60' },
  { id: 'yt1080', name: 'YouTube 1080p', w: 1920, h: 1080, fps: 30, sub: '1920×1080 · 30' },
  { id: 'yt1080_60', name: 'Gaming 1080p60', w: 1920, h: 1080, fps: 60, sub: '1920×1080 · 60' },
  { id: 'tiktok', name: 'TikTok / Reels / Shorts', w: 1080, h: 1920, fps: 30, sub: '1080×1920 · 30' },
  { id: 'tiktok60', name: 'TikTok 60fps', w: 1080, h: 1920, fps: 60, sub: '1080×1920 · 60' },
  { id: 'tiktok4k', name: 'Vertikal 4K', w: 2160, h: 3840, fps: 30, sub: '2160×3840 · 30' },
  { id: 'insta_sq', name: 'Instagram Quadrat', w: 1080, h: 1080, fps: 30, sub: '1080×1080' },
  { id: 'insta_45', name: 'Instagram 4:5', w: 1080, h: 1350, fps: 30, sub: '1080×1350' },
  { id: 'cine', name: 'Cinema 2.39:1', w: 3840, h: 1608, fps: 24, sub: '3840×1608 · 24' },
  { id: 'qhd', name: '1440p QHD', w: 2560, h: 1440, fps: 60, sub: '2560×1440 · 60' },
  { id: 'hd720', name: '720p', w: 1280, h: 720, fps: 30, sub: '1280×720' },
  { id: '8k', name: '8K UHD', w: 7680, h: 4320, fps: 30, sub: '7680×4320 · 30' },
];
