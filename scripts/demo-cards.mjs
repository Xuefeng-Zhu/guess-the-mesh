// Renders the demo video's title/end cards, background and caption overlays as PNGs (HTML -> Playwright).
//   CHROME=/path/to/chrome node scripts/demo-cards.mjs <outDir>
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.argv[2] ?? 'docs/demo/build');
fs.mkdirSync(OUT, { recursive: true });
const font = (f) => new globalThis.URL(`../node_modules/${f}`, import.meta.url).href;
const css = `
@font-face { font-family: Brico; src: url(${font('@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2')}); font-weight: 200 800; }
@font-face { font-family: Mono; src: url(${font('@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2')}); font-weight: 700; }
* { margin: 0; box-sizing: border-box; }
html, body { width: 1920px; height: 1080px; font-family: Brico, sans-serif; color: #fff; }
.bg { width: 1920px; height: 1080px; background: radial-gradient(1200px 700px at 20% 10%, #3b1d6e 0%, transparent 60%), radial-gradient(900px 600px at 90% 90%, #5a1f4f 0%, transparent 60%), #140c26; }
.card { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 28px; }
.logo { font-size: 120px; font-weight: 800; letter-spacing: -3px; }
.logo span { background: #ffbe0b; color: #140c26; padding: 0 22px; border-radius: 22px; font-size: 64px; vertical-align: middle; margin: 0 14px; }
.sub { font-size: 50px; font-weight: 500; opacity: .92; }
.sub b { color: #ffbe0b; }
.chips { display: flex; gap: 18px; margin-top: 20px; }
.chip { font-family: Mono; font-size: 26px; padding: 12px 22px; border-radius: 999px; border: 2px solid rgba(255,255,255,.25); }
.cap { position: absolute; left: 0; right: 0; bottom: 0; height: 150px; display: flex; align-items: center; justify-content: center; }
.pill { display: flex; align-items: center; gap: 22px; background: rgba(12,6,26,.86); border: 2px solid rgba(255,255,255,.14); border-radius: 26px; padding: 18px 34px; max-width: 1820px; }
.step { font-family: Mono; font-size: 24px; color: #140c26; background: #ffbe0b; border-radius: 12px; padding: 6px 14px; white-space: nowrap; }
.txt { font-size: 38px; font-weight: 600; line-height: 1.15; }
.txt em { font-style: normal; color: #00d1ff; }
.lbl { position: absolute; font-family: Mono; font-size: 20px; color: rgba(255,255,255,.6); letter-spacing: 2px; }
`;

const CAPTIONS = {
  lobby: ['1', 'Host opens a room on the TV / laptop. Friends scan the QR code and join from their phones.'],
  prompt: ['2', 'Dana secretly types a prompt on her phone and picks a Lux3D style.'],
  gen: ['3', 'Real <em>Lux3D text-to-3D</em> (G1-Turbo) sculpts it live &middot; <em>sped up 10x</em>'],
  reveal: ['4', 'The Lux3D model is revealed: voxels &rarr; clay &rarr; full colour &middot; <em>sped up 4x</em>'],
  guesses: ['4', 'Friends guess on their phones: near misses get a hint, faster = more points.'],
  round2: ['5', 'Round 2: Fay queued her prompt during round 1, so it was already sculpted.'],
  round2b: ['5', 'Instant reveal. Now Dana&rsquo;s phone is guessing &middot; <em>sped up 4x</em>'],
  gallery: ['6', 'Gallery: every Lux3D model with the wrong guesses, plus GLB download.'],
  solo: ['7', 'Solo / Daily Mesh: 12 pre-generated Lux3D models, playable alone anytime.'],
};

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const render = async (name, body, transparent = false) => {
  const html = path.join(OUT, '_card.html');
  fs.writeFileSync(html, `<html><head><style>${css}</style></head><body${transparent ? ' style="background:transparent"' : ''}>${body}</body></html>`);
  await page.goto(`file://${html}`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), omitBackground: transparent });
};

await render('bg', `<div class="bg"></div>`);
await render(
  'title',
  `<div class="bg card"><div class="logo">Guess<span>the</span>Mesh</div><div class="sub">3D Pictionary powered by <b>Aholo Lux3D</b></div>
   <div class="chips"><div class="chip">real footage</div><div class="chip">live text-to-3D</div><div class="chip">#Manycorehackathon</div></div></div>`,
);
await render(
  'end',
  `<div class="bg card"><div class="logo">Guess<span>the</span>Mesh</div><div class="sub">Built with <b>Aholo Lux3D</b> text-to-3D (G1-Turbo)</div>
   <div class="chips"><div class="chip">github link TBD</div><div class="chip">#Manycorehackathon</div></div></div>`,
);
for (const [k, [n, t]] of Object.entries(CAPTIONS)) {
  await render(`cap-${k}`, `<div class="cap"><div class="pill"><div class="step">STEP ${n}</div><div class="txt">${t}</div></div></div>`, true);
}
await render('labels', `<div class="lbl" style="left:40px;top:878px">HOST SCREEN (TV / LAPTOP)</div><div class="lbl" style="left:1500px;top:890px">DANA'S PHONE</div>`, true);
fs.rmSync(path.join(OUT, '_card.html'));
await browser.close();
console.log('cards ->', OUT);
