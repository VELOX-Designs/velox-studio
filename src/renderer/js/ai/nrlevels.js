// Neural Rendering presets shared by photo + video mode
import { L } from '../core/i18n.js';
export const NR_LEVELS = [
  { id: 'natural', s: 0.12, name: { de: 'Natürlich', en: 'Natural' }, hint: { de: 'Feiner Realismus – Formen bleiben fast exakt gleich', en: 'Subtle realism – shapes stay almost identical' } },
  { id: 'gta', s: 0.18, name: { de: 'GTA', en: 'GTA' }, hint: { de: 'Für GTA/FiveM: echte Haut, Lack, Asphalt – ohne dass es kippt', en: 'For GTA/FiveM: real skin, paint, asphalt – without going over the top' } },
  { id: 'strong', s: 0.26, name: { de: 'Stark', en: 'Strong' }, hint: { de: 'Deutlich realer – KI malt Details neu', en: 'Clearly more real – AI repaints details' } },
  { id: 'ultra', s: 0.36, name: { de: 'Ultra', en: 'Ultra' }, hint: { de: 'Maximum – KI erfindet viel neu, kann vom Original abweichen', en: 'Maximum – AI re-invents a lot, may drift from the original' } },
];
export const NR_SCENES = [
  { id: 'all', name: { de: 'Alles', en: 'Everything' }, p: 'photorealistic real-life photograph, natural lighting, realistic materials and textures, realistic skin, sharp focus, high detail, 35mm photo' },
  { id: 'people', name: { de: 'Personen', en: 'People' }, p: 'photorealistic photo of real people, realistic skin pores, natural hair, realistic clothing fabric, natural lighting, 85mm portrait photo, high detail' },
  { id: 'cars', name: { de: 'Autos', en: 'Cars' }, p: 'photorealistic photo of a real car, glossy car paint reflections, realistic tires and rims, real asphalt road, natural lighting, automotive photography, high detail' },
  { id: 'city', name: { de: 'Stadt & Umgebung', en: 'City & scenery' }, p: 'photorealistic real-life street photo, realistic buildings, real asphalt and concrete, realistic vegetation, natural light, high detail, 35mm photo' },
  { id: 'night', name: { de: 'Nacht', en: 'Night' }, p: 'photorealistic night photograph, realistic street lights, wet asphalt reflections, realistic shadows, cinematic, high detail, real life' },
  { id: 'police', name: { de: 'Blaulicht', en: 'Emergency' }, p: 'photorealistic photo of real german emergency vehicles, realistic blue lights, reflective markings, real street, natural lighting, high detail, press photo' },
];
export const levelName = (l) => L(l.name.de, l.name.en);
