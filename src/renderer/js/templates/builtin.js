// Built-in CapCut-style templates. Every template is a fixed structure of clip slots (exact lengths on a beat
// grid), speed ramps, effects, transitions, texts and a look. Music: the user picks a song (beat-sync) – we do not
// ship copyrighted tracks. Generated deterministically from style recipes so there are many distinct variants.

// tiny seeded rng → stable templates across starts
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const fx = (type, params = {}) => ({ type, params });

// beat patterns (beats per slot); repeated / mixed to fill a length
const PAT = {
  hype: [[1, 1, 1, 1, 0.5, 0.5, 1, 2], [1, 1, 2, 1, 1, 2], [0.5, 0.5, 1, 0.5, 0.5, 1, 2], [1, 0.5, 0.5, 1, 1, 0.5, 0.5, 2]],
  drop: [[4, 2, 2, 1, 1, 0.5, 0.5, 0.5, 0.5, 1, 1, 2], [4, 4, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 2]],
  medium: [[2, 2, 2, 2], [2, 2, 4, 2, 2], [2, 1, 1, 2, 2, 4]],
  slow: [[4, 4, 4, 4], [8, 4, 4, 8], [4, 8, 4]],
  cine: [[8, 8, 4, 4, 8], [8, 4, 4, 8, 8], [6, 6, 4, 8]],
};

// style recipes
const STYLES = [
  { key: 'car_velocity', cat: 'car', emoji: '🏎', name: ['Car Velocity', 'Velocity Drift', 'Turbo Velocity', 'Street Velocity', 'Velocity Phonk'], colors: ['#ff3d00', '#1a0500'], bpm: [130, 145, 150, 160], pat: 'hype', aspect: '9:16',
    ramps: ['velocityEdit', 'montage', 'bullet', 'speedUp', null], rampChance: 0.75, trans: ['flash', 'zoompunch', 'whippan', 'velocity', 'shake'], transEvery: 2, fx: [fx('motionblur'), fx('shake', { amp: 14, freq: 12 }), fx('zoompulse')], fxChance: 0.35, look: ['look_teal_orange', 'look_gta', 'game_impact'], intro: ['NEW BUILD', 'PURE SPEED', 'NO LIMITS'], outro: null },
  { key: 'car_night', cat: 'car', emoji: '🌃', name: ['Night Drive', 'Midnight Run', 'Neon Cruise', 'City Lights', 'After Dark'], colors: ['#7b2ff7', '#05010f'], bpm: [90, 100, 110], pat: 'medium', aspect: '9:16',
    ramps: ['smooth', 'slowEnd', null], rampChance: 0.5, trans: ['dissolve', 'lightleak', 'blur', 'flashblur'], transEvery: 1, fx: [fx('glow', { threshold: 0.6, intensity: 0.7 }), fx('anamorphic'), fx('bokehoverlay')], fxChance: 0.4, look: ['real_night', 'look_cyber', 'cine_dream'], intro: ['NIGHT DRIVE', 'MIDNIGHT'], outro: null },
  { key: 'car_rolling', cat: 'car', emoji: '🚗', name: ['Rolling Shots', 'Clean Rollers', 'Golden Hour Car', 'Showroom', 'Detail Walkaround'], colors: ['#ffb300', '#1a1000'], bpm: [95, 105, 115], pat: 'slow', aspect: '9:16',
    ramps: ['smooth', null, 'slowEnd'], rampChance: 0.4, trans: ['dissolve', 'slide', 'pushblur', 'lightleak'], transEvery: 1, fx: [fx('kenburns', { zoom: 0.1 }), fx('lensflare')], fxChance: 0.3, look: ['real_cine', 'look_film', 'look_summer'], intro: null, outro: ['@yourcar'] },
  { key: 'car_drift', cat: 'car', emoji: '💨', name: ['Drift King', 'Smoke Show', 'Sideways', 'Tandem Drift'], colors: ['#d0d0d0', '#111'], bpm: [140, 150, 160], pat: 'drop', aspect: '9:16',
    ramps: ['hero', 'velocityEdit', 'bullet', 'montage'], rampChance: 0.8, trans: ['zoompunch', 'flash', 'glitch', 'whippan'], transEvery: 2, fx: [fx('shake', { amp: 18, freq: 14 }), fx('smoke'), fx('rgbsplit')], fxChance: 0.4, look: ['look_bleach', 'game_impact', 'look_hdr_pop'], intro: ['DRIFT'], outro: null },
  { key: 'police', cat: 'blaulicht', emoji: '🚨', name: ['Blaulicht Einsatz', 'Einsatzfahrt', 'Code 3', 'Alarm!', 'Streife Nachts'], colors: ['#0050ff', '#ff0030'], bpm: [120, 128, 140], pat: 'hype', aspect: '9:16',
    ramps: ['velocityEdit', 'flashIn', null, 'smooth'], rampChance: 0.55, trans: ['flash', 'zoompunch', 'rgbsplit', 'whippan'], transEvery: 2, fx: [fx('strobe'), fx('glow', { threshold: 0.55, intensity: 0.8 }), fx('shake', { amp: 10, freq: 10 })], fxChance: 0.3, look: ['real_night', 'look_cold', 'look_gta'], intro: ['EINSATZ', 'ALARM'], outro: null },
  { key: 'cine_trailer', cat: 'cinematic', emoji: '🎬', name: ['Cinematic Trailer', 'Epic Trailer', 'Movie Intro', 'Coming Soon', 'Blockbuster'], colors: ['#c7a252', '#0a0804'], bpm: [80, 90, 100], pat: 'cine', aspect: '16:9',
    ramps: ['smooth', 'slowEnd', null], rampChance: 0.45, trans: ['dipblack', 'dissolve', 'lightleak', 'flare', 'filmroll'], transEvery: 1, fx: [fx('letterbox'), fx('lensflare'), fx('grain', { amount: 0.25 })], fxChance: 0.35, look: ['cine_239', 'look_teal_orange', 'real_cine'], intro: ['A FILM BY YOU', 'COMING SOON'], outro: ['THE END'] },
  { key: 'cine_slow', cat: 'cinematic', emoji: '🌫', name: ['Slow Cinematic', 'Moody Cinema', 'Rain Mood', 'Lonely Streets', 'Atmosphere'], colors: ['#4a6a80', '#05080b'], bpm: [70, 80, 90], pat: 'cine', aspect: '9:16',
    ramps: ['smooth', null, 'slowEnd'], rampChance: 0.5, trans: ['dissolve', 'blur', 'dipblack', 'smoke'], transEvery: 1, fx: [fx('rain'), fx('vignette', { amount: 0.5 }), fx('grain', { amount: 0.3 })], fxChance: 0.3, look: ['look_moody', 'look_cold', 'cine_dream'], intro: null, outro: null },
  { key: 'cine_film', cat: 'cinematic', emoji: '🎞', name: ['Film Look', 'Kodak Memories', '35mm', 'Super 8', 'Analog Days'], colors: ['#d98b3a', '#140a02'], bpm: [85, 95], pat: 'slow', aspect: '9:16',
    ramps: [null, 'smooth'], rampChance: 0.3, trans: ['dissolve', 'burn', 'lightleak', 'filmroll'], transEvery: 1, fx: [fx('scratches'), fx('grain', { amount: 0.4 }), fx('vhs')], fxChance: 0.4, look: ['look_film', 'look_vintage', 'cine_vhs'], intro: null, outro: null },
  { key: 'hype_flash', cat: 'hype', emoji: '⚡', name: ['Flash Hype', 'Beat Flash', 'White Flash', 'Strobe Edit', 'Flash Beat 2'], colors: ['#ffffff', '#222'], bpm: [120, 128, 140, 150], pat: 'hype', aspect: '9:16',
    ramps: ['flashIn', 'jumpcut', null], rampChance: 0.4, trans: ['flash', 'dipwhite', 'flashblur', 'zoompunch'], transEvery: 1, fx: [fx('strobe'), fx('zoompulse')], fxChance: 0.3, look: ['game_beat', 'look_hdr_pop'], intro: null, outro: null },
  { key: 'hype_glitch', cat: 'hype', emoji: '👾', name: ['Glitch Edit', 'Digital Chaos', 'Data Corrupt', 'Cyber Glitch'], colors: ['#00ffd0', '#ff00a8'], bpm: [128, 140, 150], pat: 'hype', aspect: '9:16',
    ramps: ['jumpcut', 'montage', null], rampChance: 0.45, trans: ['glitch', 'rgbsplit', 'datamosh', 'pixels'], transEvery: 1, fx: [fx('glitch'), fx('chromatic', { amount: 0.4 }), fx('scanjitter')], fxChance: 0.45, look: ['game_glitchy', 'look_cyber', 'look_matrix'], intro: ['GLITCH'], outro: null },
  { key: 'hype_drop', cat: 'hype', emoji: '💥', name: ['Beat Drop', 'Bass Drop', 'Build Up', 'Drop It', 'Hard Drop'], colors: ['#ff0066', '#16000a'], bpm: [140, 150, 160], pat: 'drop', aspect: '9:16',
    ramps: ['hero', 'velocityEdit', 'jumpcut', null], rampChance: 0.6, trans: ['zoompunch', 'flash', 'shake', 'spin'], transEvery: 1, fx: [fx('shake', { amp: 20, freq: 16 }), fx('zoompulse'), fx('rgbsplit')], fxChance: 0.45, look: ['game_impact', 'look_hdr_pop'], intro: null, outro: null },
  { key: 'define', cat: 'trend', emoji: '✨', name: ['DEFINE BEAUTY', 'Aesthetic', 'Soft Trend', 'Dreamy Trend', 'That Girl'], colors: ['#ffd6e8', '#2a1520'], bpm: [100, 110, 120], pat: 'medium', aspect: '9:16',
    ramps: ['smooth', null], rampChance: 0.35, trans: ['dipwhite', 'dissolve', 'blur', 'flashblur'], transEvery: 1, fx: [fx('glow', { threshold: 0.7, intensity: 0.6 }), fx('bokehoverlay')], fxChance: 0.35, look: ['cine_dream', 'look_summer'], intro: ['DEFINE BEAUTY'], outro: null },
  { key: 'gaming', cat: 'gaming', emoji: '🎮', name: ['Gaming Montage', 'Clip Montage', 'Highlights', 'Best Plays', 'Clutch Moments'], colors: ['#00e676', '#001a0b'], bpm: [130, 140, 150], pat: 'hype', aspect: '16:9',
    ramps: ['montage', 'bullet', 'hero', null], rampChance: 0.6, trans: ['flash', 'zoompunch', 'glitch', 'whippan'], transEvery: 2, fx: [fx('shake', { amp: 12, freq: 12 }), fx('rgbsplit'), fx('motionblur')], fxChance: 0.4, look: ['game_impact', 'game_neon', 'game_beat'], intro: ['HIGHLIGHTS'], outro: ['FOLLOW FOR MORE'] },
  { key: 'gta_rp', cat: 'gaming', emoji: '🕹', name: ['GTA RP Story', 'RP Moments', 'Server Trailer', 'Crime RP', 'RP Highlights'], colors: ['#3fae5a', '#06120a'], bpm: [95, 110, 125], pat: 'medium', aspect: '9:16',
    ramps: ['smooth', 'velocityEdit', null], rampChance: 0.45, trans: ['dissolve', 'flash', 'whippan', 'dipblack'], transEvery: 1, fx: [fx('letterbox'), fx('grain', { amount: 0.15 })], fxChance: 0.25, look: ['look_gta', 'real_cine', 'look_teal_orange'], intro: ['WELCOME TO THE CITY'], outro: ['JOIN NOW'] },
  { key: 'vlog', cat: 'story', emoji: '📷', name: ['Daily Vlog', 'Weekend Recap', 'Day in my Life', 'Summer Recap', 'Memories'], colors: ['#ffcc80', '#1e1406'], bpm: [100, 110, 120], pat: 'medium', aspect: '9:16',
    ramps: [null, 'smooth'], rampChance: 0.2, trans: ['slide', 'dissolve', 'push', 'zoomin'], transEvery: 1, fx: [fx('kenburns', { zoom: 0.08 })], fxChance: 0.3, look: ['look_summer', 'look_film'], intro: ['MY WEEKEND'], outro: null },
  { key: 'travel', cat: 'story', emoji: '✈', name: ['Travel Film', 'Wanderlust', 'Roadtrip', 'Holiday Recap', 'Explore'], colors: ['#29b6f6', '#021018'], bpm: [100, 115, 125], pat: 'medium', aspect: '9:16',
    ramps: ['speedUp', 'smooth', null], rampChance: 0.45, trans: ['whippan', 'zoomin', 'slide', 'dissolve'], transEvery: 1, fx: [fx('kenburns', { zoom: 0.1 }), fx('lensflare')], fxChance: 0.3, look: ['look_summer', 'look_teal_orange', 'real_photo'], intro: ['WANDERLUST'], outro: null },
  { key: 'sport', cat: 'sport', emoji: '🏀', name: ['Sport Hype', 'Training Motivation', 'Gym Edit', 'Match Day', 'Game Winner'], colors: ['#ff6d00', '#140800'], bpm: [130, 140, 150], pat: 'hype', aspect: '9:16',
    ramps: ['hero', 'bullet', 'velocityEdit', null], rampChance: 0.6, trans: ['zoompunch', 'flash', 'whippan', 'shake'], transEvery: 2, fx: [fx('shake', { amp: 12, freq: 12 }), fx('speedlines'), fx('zoompulse')], fxChance: 0.4, look: ['game_impact', 'look_bleach', 'look_hdr_pop'], intro: ['NO DAYS OFF'], outro: null },
  { key: 'party', cat: 'party', emoji: '🪩', name: ['Party Night', 'Club Edit', 'Festival', 'Rave', 'Weekend Vibes'], colors: ['#e040fb', '#12001a'], bpm: [124, 128, 132], pat: 'hype', aspect: '9:16',
    ramps: ['jumpcut', 'flashIn', null], rampChance: 0.4, trans: ['flash', 'rgbsplit', 'zoompunch', 'spin'], transEvery: 1, fx: [fx('strobe'), fx('neon'), fx('glow', { threshold: 0.6, intensity: 0.8 })], fxChance: 0.4, look: ['game_neon', 'look_cyber'], intro: ['PARTY TIME'], outro: null },
  { key: 'retro', cat: 'retro', emoji: '📼', name: ['VHS Retro', '90s Tape', 'Old School', 'Camcorder', 'Retro Wave'], colors: ['#ff7ab6', '#160a20'], bpm: [90, 100, 110], pat: 'medium', aspect: '9:16',
    ramps: [null, 'jumpcut'], rampChance: 0.25, trans: ['glitch', 'dipblack', 'filmroll', 'rgbsplit'], transEvery: 1, fx: [fx('vhs'), fx('scanlines'), fx('timestamp')], fxChance: 0.5, look: ['cine_vhs', 'look_vintage'], intro: ['PLAY ▶'], outro: null },
  { key: 'bw', cat: 'retro', emoji: '🖤', name: ['Black & White', 'Noir', 'Monochrome', 'Grey Mood'], colors: ['#ffffff', '#000000'], bpm: [80, 90, 100], pat: 'slow', aspect: '9:16',
    ramps: ['smooth', null], rampChance: 0.35, trans: ['dipblack', 'dissolve', 'blur', 'flash'], transEvery: 1, fx: [fx('grain', { amount: 0.35 }), fx('vignette', { amount: 0.6 })], fxChance: 0.4, look: ['look_noir'], intro: null, outro: null },
  { key: 'fashion', cat: 'trend', emoji: '👟', name: ['Outfit Check', 'Fit Check', 'Drip Edit', 'Sneaker Drop'], colors: ['#c6ff00', '#111800'], bpm: [120, 128, 140], pat: 'hype', aspect: '9:16',
    ramps: ['jumpcut', null, 'flashIn'], rampChance: 0.35, trans: ['zoompunch', 'swipe', 'flash', 'split'], transEvery: 1, fx: [fx('zoompulse'), fx('rgbsplit')], fxChance: 0.3, look: ['look_hdr_pop', 'look_bleach'], intro: ['FIT CHECK'], outro: null },
  { key: 'countdown', cat: 'trend', emoji: '🔢', name: ['Top 5 Countdown', 'Ranking', 'Best Of 5'], colors: ['#ffd600', '#141100'], bpm: [110, 120], pat: 'slow', aspect: '9:16', slots: 5,
    ramps: [null, 'smooth'], rampChance: 0.2, trans: ['zoompunch', 'flash', 'swipe'], transEvery: 1, fx: [], fxChance: 0, look: ['look_hdr_pop'], intro: null, outro: null, numbered: true },
  { key: 'wedding', cat: 'story', emoji: '💍', name: ['Love Story', 'Wedding Film', 'Together', 'Anniversary'], colors: ['#f8bbd0', '#1a0d12'], bpm: [70, 80, 90], pat: 'cine', aspect: '16:9',
    ramps: ['smooth', null], rampChance: 0.35, trans: ['dissolve', 'lightleak', 'dipwhite', 'blur'], transEvery: 1, fx: [fx('bokehoverlay'), fx('glow', { threshold: 0.7, intensity: 0.5 })], fxChance: 0.35, look: ['cine_dream', 'look_film'], intro: ['OUR STORY'], outro: null },
  { key: 'action', cat: 'cinematic', emoji: '🔥', name: ['Action Cut', 'Chase Scene', 'Shootout', 'Heist'], colors: ['#ff5722', '#150500'], bpm: [140, 150, 160], pat: 'drop', aspect: '16:9',
    ramps: ['hero', 'bullet', 'velocityEdit', null], rampChance: 0.6, trans: ['flash', 'whippan', 'zoompunch', 'shake'], transEvery: 1, fx: [fx('shake', { amp: 16, freq: 14 }), fx('letterbox'), fx('sparks')], fxChance: 0.35, look: ['cine_action', 'look_teal_orange'], intro: null, outro: null },
];
export const TEMPLATE_CATS = { all: { de: 'Alle', en: 'All' }, car: { de: 'Car Edits', en: 'Car edits' }, cinematic: { de: 'Cinematic', en: 'Cinematic' }, hype: { de: 'Hype / Beat', en: 'Hype / beat' }, blaulicht: { de: 'Blaulicht', en: 'Emergency' }, gaming: { de: 'Gaming / RP', en: 'Gaming / RP' }, trend: { de: 'Trends', en: 'Trends' }, story: { de: 'Story / Vlog', en: 'Story / vlog' }, sport: { de: 'Sport', en: 'Sport' }, party: { de: 'Party', en: 'Party' }, retro: { de: 'Retro', en: 'Retro' }, mine: { de: 'Meine', en: 'Mine' } };

function build(st, vi, seed) {
  const r = rng(seed);
  const bpm = st.bpm[vi % st.bpm.length]; const beat = 60 / bpm;
  const pats = PAT[st.pat]; const base = pats[vi % pats.length];
  const targetSec = st.slots ? null : [12, 15, 18, 22, 10][vi % 5] * (st.pat === 'cine' ? 1.6 : 1);
  const beatsList = [];
  if (st.slots) for (let i = 0; i < st.slots; i++) beatsList.push(8);
  else { let t = 0, k = 0; while (t < targetSec || beatsList.length < 4) { const b = base[k % base.length] * (k >= base.length && r() < 0.25 ? (r() < 0.5 ? 0.5 : 2) : 1); beatsList.push(Math.max(0.5, b)); t += Math.max(0.5, b) * beat; k++; if (beatsList.length >= 22) break; } }
  const slots = beatsList.map((b, i) => {
    const ramp = r() < st.rampChance ? pick(r, st.ramps) : null;
    const f = st.fx.length && r() < st.fxChance ? [JSON.parse(JSON.stringify(pick(r, st.fx)))] : [];
    return { dur: +(b * beat).toFixed(3), beats: b, ramp: b * beat < 0.45 ? null : ramp, fx: f, zoom: 1 };
  });
  const trans = [];
  for (let i = 0; i < slots.length - 1; i++) if ((i + 1) % st.transEvery === 0 || slots[i + 1].beats >= 4) trans.push({ after: i, type: pick(r, st.trans), dur: +Math.min(0.6, Math.max(0.15, beat / 2), slots[i].dur * 0.5, slots[i + 1].dur * 0.5).toFixed(3) });
  const texts = [];
  const tStyle = st.cat === 'cinematic' || st.key === 'wedding' ? 'txt_cine' : 'txt_tiktok';
  if (st.intro && r() < 0.85) texts.push({ t: 0, dur: Math.min(2.5, slots[0].dur + (slots[1]?.dur || 0)), content: pick(r, st.intro), preset: tStyle });
  const total = slots.reduce((s, x) => s + x.dur, 0);
  if (st.outro) texts.push({ t: Math.max(0, total - 2), dur: 2, content: pick(r, st.outro), preset: tStyle });
  if (st.numbered) { let t = 0; slots.forEach((s, i) => { texts.push({ t, dur: Math.min(1.5, s.dur), content: '#' + (slots.length - i), preset: 'txt_tiktok' }); t += s.dur; }); }
  return { bpm, slots, trans, texts, look: pick(r, st.look), total };
}

export const BUILTIN_TEMPLATES = (() => {
  const out = [];
  STYLES.forEach((st, si) => {
    const n = st.name.length;
    for (let vi = 0; vi < n; vi++) for (const asp of [st.aspect, st.aspect === '9:16' ? '16:9' : '9:16'].slice(0, vi % 2 === 0 ? 2 : 1)) {
      const seed = (si + 1) * 1000 + vi * 17 + (asp === st.aspect ? 0 : 7);
      const b = build(st, vi, seed);
      out.push({ id: `b_${st.key}_${vi}_${asp.replace(':', 'x')}`, builtin: true, name: st.name[vi] + (asp !== st.aspect ? (asp === '16:9' ? ' (Quer)' : ' (Hoch)') : ''), cat: st.cat, emoji: st.emoji, colors: st.colors, aspect: asp, music: null, ...b });
    }
  });
  return out;
})();
