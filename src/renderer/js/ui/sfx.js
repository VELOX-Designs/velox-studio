// Extended, procedurally generated sound-effect library (FFmpeg lavfi synthesis – no downloads, royalty-free).
// [id, name, category, ffmpeg-input-and-filter args]
const E = (expr, d, af = '') => `-f lavfi -i "aevalsrc=${expr}:d=${d}"` + (af ? ` -af "${af}"` : '');
const N = (c, d, af) => `-f lavfi -i "anoisesrc=d=${d}:c=${c}:a=0.9" -af "${af}"`;

export const SFX_CATS = { trans: 'Übergänge / Whoosh', impact: 'Impacts & Hits', ui: 'UI & Social Media', atmo: 'Atmo & Umgebung', action: 'Action / Gaming / Polizei', comedy: 'Comedy', music: 'Musik-Stinger' };

export const SFX2 = [
  // transitions
  ['whoosh_fast', 'Whoosh schnell', 'trans', N('pink', 0.45, 'bandpass=f=1800:width_type=o:w=2,afade=t=in:d=0.2:curve=exp,afade=t=out:st=0.22:d=0.23,volume=2.2')],
  ['whoosh_deep', 'Whoosh tief', 'trans', N('brown', 1.2, 'lowpass=f=600,afade=t=in:d=0.6:curve=exp,afade=t=out:st=0.6:d=0.6,volume=3')],
  ['swish', 'Swish', 'trans', N('white', 0.35, 'highpass=f=2500,afade=t=in:d=0.15,afade=t=out:st=0.15:d=0.2,volume=1.6')],
  ['swipe_air', 'Luft-Swipe', 'trans', N('pink', 0.6, 'bandpass=f=900:width_type=o:w=3,vibrato=f=9:d=0.5,afade=t=in:d=0.3:curve=exp,afade=t=out:st=0.3:d=0.3,volume=2')],
  ['reverse_cymbal', 'Rückwärts-Becken', 'trans', N('white', 2.0, 'highpass=f=4000,afade=t=in:d=1.9:curve=exp,afade=t=out:st=1.95:d=0.05,volume=1.8')],
  ['tape_rewind', 'Band-Rückspulen', 'trans', E('0.5*sin(2*PI*t*(800+3000*t))*(0.5+0.5*sin(2*PI*30*t))', 1.0, 'afade=t=out:st=0.8:d=0.2')],
  ['sweep_up', 'Sweep hoch', 'trans', E('0.5*sin(2*PI*t*(100+900*t*t))', 1.5, 'afade=t=in:d=0.2,afade=t=out:st=1.35:d=0.15')],
  ['sweep_down', 'Sweep runter', 'trans', E('0.5*sin(2*PI*t*(1600-900*t))', 1.4, 'afade=t=out:st=1.1:d=0.3')],
  ['trans_hit', 'Übergangs-Hit', 'trans', E('0.9*sin(2*PI*t*(90-40*t))*exp(-5*t)+0.3*(random(0)-0.5)*exp(-25*t)', 1.0, 'alimiter')],
  ['glitch_whoosh', 'Glitch-Whoosh', 'trans', N('pink', 0.6, 'bandpass=f=1500:width_type=o:w=2,acrusher=bits=6:mix=0.6,apulsator=hz=18,afade=t=in:d=0.3,afade=t=out:st=0.3:d=0.3,volume=2')],
  // impacts
  ['punch', 'Schlag', 'impact', E('0.9*sin(2*PI*t*(150-120*t))*exp(-18*t)+0.5*(random(0)-0.5)*exp(-60*t)', 0.4, 'lowpass=f=3000,alimiter')],
  ['slam', 'Tür-Knall', 'impact', E('0.9*sin(2*PI*60*t)*exp(-9*t)+0.6*(random(0)-0.5)*exp(-35*t)', 0.8, 'lowpass=f=2500,alimiter')],
  ['thud', 'Dumpfer Aufprall', 'impact', E('sin(2*PI*t*(70-30*t))*exp(-12*t)', 0.6, 'volume=2,alimiter')],
  ['cine_boom', 'Kino-Boom', 'impact', E('sin(2*PI*t*(45-15*t))*exp(-1.6*t)+0.3*(random(0)-0.5)*exp(-6*t)', 3.0, 'lowpass=f=900,aecho=0.8:0.6:120:0.3,volume=2.2,alimiter')],
  ['braam', 'BRAAM (Trailer)', 'impact', E('0.35*(sin(2*PI*55*t)+sin(2*PI*55.6*t)+0.6*sin(2*PI*110.4*t)+0.4*sin(2*PI*82.5*t))*(1-exp(-30*t))*exp(-0.7*t)', 3.0, 'acrusher=bits=10:mix=0.3,lowpass=f=1800,volume=2,alimiter')],
  ['sub_drop2', 'Sub-Drop', 'impact', E('sin(2*PI*t*(90*exp(-1.5*t)+28))*exp(-0.6*t)', 2.5, 'volume=2.5,alimiter')],
  ['metal_hit', 'Metall-Schlag', 'impact', E('0.4*(sin(2*PI*523*t)+sin(2*PI*1187*t)+0.6*sin(2*PI*2311*t))*exp(-4*t)', 1.6, 'alimiter')],
  ['glass_tap', 'Glas-Tick', 'impact', E('0.5*sin(2*PI*3200*t)*exp(-30*t)+0.3*sin(2*PI*4700*t)*exp(-40*t)', 0.4)],
  ['kick', 'Kick-Drum', 'impact', E('sin(2*PI*t*(55+120*exp(-30*t)))*exp(-8*t)', 0.6, 'volume=2,alimiter')],
  ['clap', 'Klatschen', 'impact', N('white', 0.25, 'bandpass=f=1600:width_type=o:w=1.5,afade=t=out:d=0.25:curve=exp,volume=3')],
  // ui / social
  ['notify', 'Benachrichtigung', 'ui', E('0.4*sin(2*PI*880*t)*exp(-6*t)*lt(t\\,0.25)+0.4*sin(2*PI*1320*(t-0.12))*exp(-6*(t-0.12))*gt(t\\,0.12)', 0.7)],
  ['success', 'Erfolg', 'ui', E('0.35*(sin(2*PI*660*t)*lt(t\\,0.12)+sin(2*PI*880*t)*between(t\\,0.12\\,0.24)+sin(2*PI*1320*t)*gt(t\\,0.24))*exp(-2*t)', 0.9)],
  ['error', 'Fehler-Buzz', 'ui', E('0.4*sgn(sin(2*PI*140*t))*lt(mod(t\\,0.18)\\,0.12)', 0.5, 'lowpass=f=1500')],
  ['level_up', 'Level-Up', 'ui', E('0.35*sgn(sin(2*PI*(440+440*floor(t*12)/3)*t))*exp(-1.5*t)', 0.9, 'lowpass=f=4000')],
  ['coin', 'Münze', 'ui', E('0.35*sgn(sin(2*PI*(988*lt(t\\,0.08)+1319*gte(t\\,0.08))*t))*exp(-5*t)', 0.6, 'lowpass=f=5000')],
  ['pop_soft', 'Pop weich', 'ui', E('sin(2*PI*t*(600-3000*t))*exp(-25*t)', 0.2, 'volume=1.5')],
  ['bubble', 'Blubb', 'ui', E('0.6*sin(2*PI*t*(300+1500*t))*exp(-20*t)', 0.3)],
  ['typing', 'Tippen', 'ui', E('0.6*(random(0)-0.5)*exp(-120*mod(t\\,0.11+0.04*sin(t*7)))', 2.0, 'bandpass=f=3000:width_type=o:w=2,volume=2')],
  ['mouse_click', 'Maus-Klick', 'ui', E('0.8*(random(0)-0.5)*exp(-300*t)+0.4*sin(2*PI*2500*t)*exp(-200*t)', 0.08)],
  ['like', 'Like / Herz', 'ui', E('0.35*(sin(2*PI*1046*t)+sin(2*PI*1568*t))*exp(-7*t)', 0.6)],
  ['beep2', 'Doppel-Piep', 'ui', E('0.4*sin(2*PI*1200*t)*(lt(t\\,0.09)+between(t\\,0.15\\,0.24))', 0.3)],
  ['camera2', 'Foto-Auslöser', 'ui', E('0.8*(random(0)-0.5)*(exp(-80*t)+0.7*exp(-80*abs(t-0.09))*gt(t\\,0.09))', 0.3, 'highpass=f=1500')],
  // atmo
  ['wind', 'Wind', 'atmo', N('brown', 6, 'lowpass=f=700,apulsator=hz=0.2:amount=0.6,afade=t=in:d=1,afade=t=out:st=5:d=1,volume=2.5')],
  ['rain', 'Regen', 'atmo', N('white', 6, 'lowpass=f=6000,highpass=f=400,afade=t=in:d=0.8,afade=t=out:st=5.2:d=0.8,volume=0.7')],
  ['thunder', 'Donner', 'atmo', E('(random(0)-0.5)*exp(-0.9*t)*(0.6+0.4*sin(2*PI*3*t))', 4.0, 'lowpass=f=400,volume=4,alimiter')],
  ['static', 'Rauschen (TV)', 'atmo', N('white', 2, 'volume=0.5,afade=t=in:d=0.05,afade=t=out:st=1.9:d=0.1')],
  ['vinyl', 'Vinyl-Knistern', 'atmo', E('0.6*(random(0)-0.5)*gt(random(1)\\,0.998)+0.02*(random(2)-0.5)', 6.0, 'lowpass=f=5000')],
  ['heart_fast', 'Herzschlag schnell', 'atmo', E('sin(2*PI*50*t)*(exp(-25*mod(t\\,0.5))+0.7*exp(-25*mod(t-0.14\\,0.5))*gt(mod(t\\,0.5)\\,0.14))', 3.0, 'volume=3')],
  ['clock_fast', 'Uhr schnell', 'atmo', E('sin(2*PI*2800*mod(t\\,0.5))*exp(-220*mod(t\\,0.5))', 4.0)],
  ['ocean', 'Meer / Wellen', 'atmo', N('pink', 8, 'lowpass=f=1200,apulsator=hz=0.12:amount=0.9,afade=t=in:d=1.5,afade=t=out:st=6.5:d=1.5,volume=1.6')],
  ['drone_dark', 'Spannungs-Drone', 'atmo', E('0.25*(sin(2*PI*55*t)+sin(2*PI*58.27*t)+0.5*sin(2*PI*110*t+sin(2*PI*0.3*t)))', 6.0, 'lowpass=f=800,afade=t=in:d=1.5,afade=t=out:st=4.5:d=1.5')],
  // action / gaming / police
  ['laser', 'Laser', 'action', E('0.5*sgn(sin(2*PI*t*(2400-6000*t)))*exp(-6*t)', 0.35, 'lowpass=f=6000')],
  ['laser_down', 'Laser tief', 'action', E('0.5*sin(2*PI*t*(1200-1500*t))*exp(-4*t)', 0.6)],
  ['explosion', 'Explosion', 'action', E('(random(0)-0.5)*exp(-2.2*t)+0.8*sin(2*PI*t*(60-25*t))*exp(-3*t)', 2.5, 'lowpass=f=1800,volume=3,alimiter')],
  ['gunshot', 'Schuss (synthetisch)', 'action', E('(random(0)-0.5)*exp(-28*t)+0.6*sin(2*PI*t*(180-150*t))*exp(-20*t)', 0.7, 'lowpass=f=4500,aecho=0.6:0.5:60:0.25,volume=2.5,alimiter')],
  ['reload', 'Nachladen', 'action', E('0.7*(random(0)-0.5)*(exp(-150*t)+exp(-150*abs(t-0.25))*gt(t\\,0.25))', 0.5, 'bandpass=f=2500:width_type=o:w=2,volume=2.5')],
  ['alarm', 'Alarm', 'action', E('0.4*sgn(sin(2*PI*(700+300*sgn(sin(2*PI*2*t)))*t))', 3.0, 'lowpass=f=3000')],
  ['martinhorn', 'Martinhorn (Tatü-Tata)', 'action', E('0.35*(sin(2*PI*(440*lt(mod(t\\,1.4)\\,0.7)+587*gte(mod(t\\,1.4)\\,0.7))*t)+0.35*sin(4*PI*(440*lt(mod(t\\,1.4)\\,0.7)+587*gte(mod(t\\,1.4)\\,0.7))*t))', 4.2, 'lowpass=f=4000,acompressor')],
  ['siren_us', 'Sirene (Wail)', 'action', E('0.5*sin(2*PI*(700+500*sin(2*PI*0.25*t))*t)', 6.0, 'lowpass=f=4000')],
  ['radio_beep', 'Funk-Piep (Roger)', 'action', E('0.4*sin(2*PI*1750*t)*lt(t\\,0.18)', 0.25, 'highpass=f=500')],
  ['radio_burst', 'Funk-Rauschen', 'action', N('white', 0.6, 'bandpass=f=2000:width_type=o:w=1.5,afade=t=in:d=0.02,afade=t=out:st=0.5:d=0.1,volume=1.4')],
  ['engine_rev', 'Motor aufheulen', 'action', E('0.4*sgn(sin(2*PI*(40+90*t*(1-0.3*t))*t))*(0.6+0.4*sin(2*PI*20*t))', 2.5, 'lowpass=f=1500,afade=t=out:st=2.1:d=0.4')],
  ['tire_screech', 'Reifenquietschen', 'action', N('white', 1.6, 'bandpass=f=2600:width_type=q:w=6,vibrato=f=12:d=0.3,afade=t=in:d=0.1,afade=t=out:st=1.2:d=0.4,volume=4')],
  ['heli', 'Hubschrauber', 'action', N('brown', 5, 'lowpass=f=900,apulsator=hz=6:amount=1,afade=t=in:d=1,afade=t=out:st=4:d=1,volume=4')],
  // comedy
  ['boing', 'Boing', 'comedy', E('0.6*sin(2*PI*t*(180+120*sin(2*PI*14*t)*exp(-3*t)))*exp(-3*t)', 1.0)],
  ['scratch', 'Platten-Scratch', 'comedy', N('white', 0.6, 'bandpass=f=1200:width_type=o:w=2,vibrato=f=7:d=0.9,afade=t=out:st=0.45:d=0.15,volume=3')],
  ['slide_up', 'Flöte hoch', 'comedy', E('0.4*sin(2*PI*t*(400+1200*t))', 0.9, 'afade=t=out:st=0.75:d=0.15')],
  ['slide_down', 'Flöte runter', 'comedy', E('0.4*sin(2*PI*t*(1500-1300*t))', 0.9, 'afade=t=out:st=0.75:d=0.15')],
  ['fail', 'Fail-Posaune', 'comedy', E('0.3*sgn(sin(2*PI*(311*lt(t\\,0.4)+294*between(t\\,0.4\\,0.8)+277*between(t\\,0.8\\,1.2)+262*gt(t\\,1.2))*t*(1+0.01*sin(2*PI*6*t))))*exp(-0.4*t)', 2.2, 'lowpass=f=1800')],
  ['rimshot', 'Ba-Dum-Tss', 'comedy', E('sin(2*PI*180*t)*exp(-20*t)+sin(2*PI*120*(t-0.18))*exp(-20*(t-0.18))*gt(t\\,0.18)+0.5*(random(0)-0.5)*exp(-6*(t-0.36))*gt(t\\,0.36)', 1.4, 'volume=1.6,alimiter')],
  ['cartoon_run', 'Cartoon-Rennen', 'comedy', E('0.4*sin(2*PI*(300+200*sgn(sin(2*PI*16*t)))*t)', 1.2, 'afade=t=out:st=1:d=0.2')],
  // music stingers
  ['riser_long', 'Riser lang (8s)', 'music', E('0.25*sin(2*PI*t*(100+60*t*t))*(t/8)+0.15*(random(0)-0.5)*(t/8)^2', 8.0, 'highpass=f=120,afade=t=out:st=7.9:d=0.1')],
  ['drop_hit', 'Drop-Hit', 'music', E('sin(2*PI*t*(60+200*exp(-20*t)))*exp(-2*t)+0.4*(random(0)-0.5)*exp(-10*t)', 2.0, 'volume=2,alimiter')],
  ['stinger_dark', 'Stinger dunkel', 'music', E('0.3*(sin(2*PI*110*t)+sin(2*PI*130.8*t)+sin(2*PI*164.8*t))*exp(-1.2*t)', 3.0, 'aecho=0.8:0.7:200:0.3')],
  ['stinger_bright', 'Stinger hell', 'music', E('0.3*(sin(2*PI*523*t)+sin(2*PI*659*t)+sin(2*PI*784*t))*exp(-1.5*t)', 2.5, 'aecho=0.8:0.7:150:0.3')],
  ['bass_wobble', 'Dubstep-Wobble', 'music', E('0.5*sgn(sin(2*PI*55*t))*(0.5+0.5*sin(2*PI*4*t))', 2.0, 'lowpass=f=900,afade=t=out:st=1.8:d=0.2')],
];
