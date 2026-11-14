// Example VELOX Studio plugin. Copy this folder, change the code, install via Store → "Plugin installieren".
exports.activate = (api) => {
  // 1) a GPU effect: params become uniforms u_<k>; write `vec4 fx(vec2 uv)`
  api.defineEffect('pl_thermal', {
    name: { de: 'Wärmebildkamera', en: 'Thermal camera' }, cat: 'stylize',
    params: [{ k: 'mix', de: 'Stärke', en: 'Amount', type: 'range', min: 0, max: 1, def: 1, step: 0.01 }],
    glsl: `vec3 heat(float t){ return clamp(vec3(1.5*t-0.2, 1.5*t-0.6, 1.0-abs(2.0*t-0.6)*1.5)*vec3(1.2,1.1,1.0), 0.0, 1.0); }
      vec4 fx(vec2 uv){ vec4 s = unpm(tex(uv)); vec3 h = heat(luma(s.rgb)); return pm(vec4(mix(s.rgb, h, u_mix), s.a)); }`,
  });
  // 2) a transition: write `vec4 tr(vec2 uv, float p)` using A(uv), Bt(uv)
  api.defineTransition('pl_heartzoom', {
    name: { de: 'Herz-Zoom', en: 'Heart zoom' }, cat: 'mask',
    glsl: `vec4 tr(vec2 uv, float p){ vec2 q = (uv-0.5)*asp(); q /= max(p*2.0, 0.001); q.y += 0.1; q.x = abs(q.x); float d = length(vec2(q.x, q.y - sqrt(q.x)*0.6)) - 0.4; return d < 0.0 ? Bt(uv) : A(uv); }`,
  });
  // 3) a command (shows up in menus/palette, can get a shortcut, callable by the AI API)
  api.registerCommand({
    id: 'pl_allRed', name: { de: 'Plugin: Alles rot einfärben', en: 'Plugin: tint everything red' }, cat: 'plugins',
    run: () => api.run('addAdjustment', { t: 0, dur: Math.max(1, api.store.duration()) }).then(() => api.run('applyEffect', { type: 'duotone', params: { dark: '#200000', light: '#ff4040' } })),
  });
};
