// Checks the critters' pixel art (src/lib/critters/sprites.ts), so a broken
// drawing fails the build instead of rendering as a smear:
//   - every frame of a critter has the same width and height, 6 to 18 px
//   - every row of a frame is that width
//   - every pixel character is in the palette, and every palette key is used
//   - every colour is a theme token or a 'light:#rrggbb|dark:#rrggbb' pair
//   - every variant key replaces a key the base palette has
//   - the tiger's climb cycle names its frames and rises a whole 1 to 4 px a frame
//   - every seasonal critter, Andrew and every bug is drawn, with the frames its way of moving needs
import { CAST, VARIANTS, GLYPHS, CLIMB, SEASONAL, FRIENDS, BUGS } from '../src/lib/critters/sprites.ts';

const TOKENS = new Set(['fg', 'muted', 'accent', 'bg', 'sunk']);
const PAIR = /^light:#[0-9a-f]{6}\|dark:#[0-9a-f]{6}$/i;
const errors = [];

function checkPalette(name, palette) {
  for (const [key, value] of Object.entries(palette)) {
    if (key.length !== 1 || key === '.') errors.push(`${name}: palette key "${key}" must be one character other than "."`);
    if (!TOKENS.has(value) && !PAIR.test(value)) errors.push(`${name}: colour "${value}" for "${key}" is neither a token nor a light|dark pair`);
  }
}

function checkFrames(name, { palette, frames }, sizeRange) {
  checkPalette(name, palette);
  const used = new Set();
  let size;
  for (const [frame, rows] of Object.entries(frames)) {
    const w = rows[0]?.length ?? 0;
    const h = rows.length;
    if (sizeRange) {
      size ??= `${w}x${h}`;
      if (`${w}x${h}` !== size) errors.push(`${name}.${frame}: ${w}x${h}, but its other frames are ${size}`);
      if (h < sizeRange[0] || h > sizeRange[1] || w < sizeRange[0] || w > sizeRange[1]) errors.push(`${name}.${frame}: ${w}x${h} is outside ${sizeRange.join(' to ')} px`);
    }
    rows.forEach((row, y) => {
      if (row.length !== w) errors.push(`${name}.${frame} row ${y}: ${row.length} px wide, not ${w}`);
      for (const ch of row) {
        if (ch === '.') continue;
        used.add(ch);
        if (!(ch in palette)) errors.push(`${name}.${frame} row ${y}: "${ch}" is not in the palette`);
      }
    });
  }
  for (const key of Object.keys(palette)) if (!used.has(key)) errors.push(`${name}: palette key "${key}" is never drawn`);
}

let frames = 0;
for (const [name, critter] of Object.entries(CAST)) {
  checkFrames(name, critter, [6, 18]);
  frames += Object.keys(critter.frames).length;
}
checkFrames('glyphs', GLYPHS);
for (const [name, v] of Object.entries(VARIANTS)) {
  checkPalette(`variant ${name}`, v.palette);
  for (const key of Object.keys(v.palette)) if (!(key in (CAST[name]?.palette ?? {}))) errors.push(`variant ${name}: "${key}" is not in the ${name} palette`);
}

for (const f of CLIMB.cycle) if (!(f in CAST.tiger.frames)) errors.push(`climb cycle: "${f}" is not a tiger frame`);
if (!Number.isInteger(CLIMB.rise) || CLIMB.rise < 1 || CLIMB.rise > 4) errors.push(`climb rise: ${CLIMB.rise} should be a whole 1 to 4 px`);

const NEEDS = { float: ['hem0', 'happy', 'sleep'], walk: ['walk1', 'walk2', 'sit', 'sit2', 'happy', 'sleep'], hop: ['hop1', 'hop2', 'sit', 'sit2', 'happy', 'sleep'], flutter: ['fly1', 'fly2', 'rest', 'rest2', 'happy', 'sleep'] };
for (const [name, { style }] of Object.entries({ ...SEASONAL, ...FRIENDS })) {
  if (!CAST[name]) errors.push(`${name}: not drawn`);
  else for (const f of NEEDS[style]) if (!(f in CAST[name].frames)) errors.push(`${name}: a ${style} critter needs a "${f}" frame`);
}
for (const name of Object.keys(BUGS)) {
  if (!CAST[name]) errors.push(`${name}: not drawn`);
  else for (const f of ['rest', 'walkA', 'walkB', 'flyA', 'flyB']) if (!(f in CAST[name].frames)) errors.push(`${name}: a bug needs a "${f}" frame`);
}

for (const e of errors) console.error(`error ${e}`);
console.log(`check-sprites: ${errors.length} error(s); ${Object.keys(CAST).length} critters, ${frames} frames`);
process.exit(errors.length ? 1 : 0);
