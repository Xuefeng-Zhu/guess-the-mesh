// Headless screenshots of a real game: host screen (laptop) + one phone (browser) + two socket bots.
// Usage: start the server (mock mode, e.g. REVEAL_MS=30000 ROUND_MS=40000), then
//   SHOT_URL=http://localhost:3000 node scripts/screenshots.mjs
import { chromium, devices } from 'playwright';
import { io } from 'socket.io-client';
import fs from 'node:fs';

const URL = process.env.SHOT_URL ?? 'http://localhost:3000';
const OUT = new globalThis.URL('../docs/screenshots/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const call = (s, ev, p = {}) => new Promise((res) => s.emit(ev, p, res));

const PROMPTS = {
  Dana: { prompt: 'a magic lantern for a ghost', style: 'fantasy' },
  Eli: { prompt: 'a retro boombox with tiny legs', style: 'cartoon' },
  Fay: { prompt: 'a toy car made of cheese', style: 'hand_painted' },
};

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const shot = async (page, name) => {
  await page.screenshot({ path: `${OUT}${name}.png` });
  log('📸', name);
};

// Home
const hostCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const host = await hostCtx.newPage();
host.on('pageerror', (e) => log('host pageerror', e.message));
await host.goto(`${URL}/`);
await sleep(1500);
await shot(host, '01-home');

// Host lobby
await host.goto(`${URL}/host`);
await host.waitForSelector('.code span');
const code = (await host.locator('.code').innerText()).replace(/\s/g, '');
log('room', code);

// Phone
const phoneCtx = await browser.newContext({ ...devices['iPhone 13'] });
const phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => log('phone pageerror', e.message));
await phone.goto(`${URL}/play?code=${code}`);
await phone.fill('input:not(.code-input)', 'Dana');
await shot(phone, '02-phone-join');
await phone.click('text=Join ▶');
await phone.waitForSelector('.phone-top');

// Bots
let lastState = null;
const bots = [];
for (const name of ['Eli', 'Fay']) {
  const s = io(URL, { transports: ['websocket'] });
  const r = await call(s, 'player:join', { code, name });
  const bot = { name, s, me: null, id: r.playerId, guessedRound: -1, prompted: new Set() };
  s.on('me', (m) => (bot.me = m));
  s.on('state', (st) => (lastState = st));
  bots.push(bot);
}
await sleep(1200);
await shot(host, '03-host-lobby');
await shot(phone, '04-phone-lobby');

await host.click('text=Start game ▶');
let captured = new Set();
const promptOf = (st) => {
  const p = st.players.find((x) => x.id === st.prompterId);
  return p ? PROMPTS[p.name].prompt : '';
};

const deadline = Date.now() + 240_000;
let roundSeen = -1;
let revealSeenAt = 0;
let phoneGuessStep = 0;
while (Date.now() < deadline) {
  await sleep(300);
  const st = lastState;
  if (!st) continue;
  if (st.phase === 'gameOver') break;

  // bots prompt when it's their turn
  for (const b of bots) {
    if (b.me?.mustPrompt && !b.prompted.has(st.round)) {
      b.prompted.add(st.round);
      setTimeout(() => call(b.s, 'player:prompt', PROMPTS[b.name]), 1500);
    }
  }

  // phone prompts via the real UI
  if (st.phase === 'prompting' && (await phone.locator('.composer').count()) > 0 && !captured.has('composer')) {
    await phone.fill('textarea', PROMPTS.Dana.prompt);
    await phone.click('text=Fantasy');
    await sleep(300);
    await shot(phone, '05-phone-prompt-composer');
    captured.add('composer');
    await phone.click('text=Sculpt it ✨');
  }

  if (st.phase === 'generating' && !captured.has('sculpt')) {
    await sleep(2000);
    await shot(host, '06-host-sculpting');
    captured.add('sculpt');
  }

  if (st.phase === 'revealing') {
    if (roundSeen !== st.round) {
      roundSeen = st.round;
      revealSeenAt = Date.now();
      phoneGuessStep = 0;
    }
    const t = Date.now() - revealSeenAt;
    const full = !captured.has('reveal-done');
    if (full) {
      if (t > 3500 && !captured.has('v')) { await shot(host, '07-host-reveal-voxels'); captured.add('v'); }
      if (t > 13500 && !captured.has('c')) { await shot(host, '08-host-reveal-clay'); captured.add('c'); }
      if (t > 22500 && !captured.has('p')) { await shot(host, '09-host-reveal-painting'); captured.add('p'); captured.add('reveal-done'); }
    }
    const phoneIsPrompter = st.players.find((p) => p.id === st.prompterId)?.name === 'Dana';
    if (!phoneIsPrompter && !captured.has('phone-guess')) {
      if (phoneGuessStep === 0 && t > 6000) {
        await phone.fill('.guess-form input', 'a haunted teapot');
        await phone.click('.guess-form button');
        phoneGuessStep = 1;
      } else if (phoneGuessStep === 1 && t > 9000) {
        await phone.fill('.guess-form input', 'a lantern');
        await phone.click('.guess-form button');
        phoneGuessStep = 2;
      } else if (phoneGuessStep === 2 && t > 10500) {
        await shot(phone, '10-phone-guessing');
        captured.add('phone-guess');
      }
    }
    const guessAt = full ? 24000 : 2500;
    for (const b of bots) {
      if (b.guessedRound !== st.round && st.prompterId !== b.id && t > guessAt) {
        b.guessedRound = st.round;
        call(b.s, 'player:guess', { text: 'a sandwich' }).then(() => sleep(900)).then(() => call(b.s, 'player:guess', { text: promptOf(st) }));
      }
    }
    if (!phoneIsPrompter && phoneGuessStep >= 2 && phoneGuessStep < 3 && t > guessAt + 1500) {
      phoneGuessStep = 3;
      await phone.fill('.guess-form input', promptOf(st)).catch(() => {});
      await phone.click('.guess-form button').catch(() => {});
    }
  }

  if (st.phase === 'roundEnd' && !captured.has('roundEnd')) {
    await sleep(700);
    await shot(host, '11-host-round-end');
    await shot(phone, '12-phone-round-end');
    captured.add('roundEnd');
  }
}
await sleep(1500);
await shot(host, '13-host-game-over');

const g = await hostCtx.newPage();
await g.goto(`${URL}/gallery`);
await sleep(5000);
await shot(g, '14-gallery');

const solo = await hostCtx.newPage();
await solo.goto(`${URL}/solo`);
await sleep(9000);
await solo.fill('.guess-form input', 'a speaker');
await solo.click('.guess-form button');
await sleep(800);
await shot(solo, '15-solo-daily-mesh');

log('captured', [...captured].join(','));
await browser.close();
bots.forEach((b) => b.s.close());
process.exit(0);
