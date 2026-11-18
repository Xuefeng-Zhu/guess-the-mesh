// Records raw footage for the demo video: host screen (laptop) + one real phone page + two socket bots.
// Start the server with stretched timings (e.g. REVEAL_MS=200000 ROUND_MS=240000 ROUND_END_MS=24000
// PROMPT_TIMEOUT_MS=3600000), then:
//   DEMO_URL=http://localhost:3200 CHROME=/path/to/chrome node scripts/record-demo.mjs
// Output: docs/demo/raw/{host-*.webm, phone-*.webm, gallery.webm, solo.webm, timeline.json}
import { chromium, devices } from 'playwright';
import { io } from 'socket.io-client';
import fs from 'node:fs';
import path from 'node:path';

const URL = process.env.DEMO_URL ?? 'http://localhost:3200';
const RAW = new globalThis.URL('../docs/demo/raw/', import.meta.url).pathname;
const FX = process.env.DEMO_LOWFX ? '?lowfx' : '';
const ONLY = process.env.DEMO_ONLY ?? 'all'; // all | game | extras
fs.mkdirSync(RAW, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const call = (s, ev, p = {}) => new Promise((res) => s.emit(ev, p, res));

const ROUND0 = { prompt: 'a raccoon DJ with headphones', style: 'cartoon' };
const ROUND1 = { prompt: 'a robot chef with a frying pan', style: 'cartoon' };
// Bot guesses for round 0 (phone is the prompter), as fractions of the reveal.
const R0_GUESSES = [
  { at: 0.1, bot: 'Eli', text: 'a cat with headphones' },
  { at: 0.2, bot: 'Fay', text: 'a teddy bear' },
  { at: 0.3, bot: 'Fay', text: 'a dog with headphones' },
  { at: 0.5, bot: 'Fay', text: 'a raccoon DJ' },
  { at: 0.86, bot: 'Eli', text: 'raccoon dj with headphones' },
];

const timeline = { events: [], videos: {} };
const T = () => Date.now();
const mark = (name, extra = {}) => {
  timeline.events.push({ name, t: T(), ...extra });
  log('◆', name, JSON.stringify(extra));
};
const saveTimeline = () => fs.writeFileSync(path.join(RAW, `timeline-${ONLY}.json`), JSON.stringify(timeline, null, 2));

const browser = await chromium.launch({
  executablePath: process.env.CHROME,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

async function newRecorded(name, ctxOpts, size) {
  const ctx = await browser.newContext({ ...ctxOpts, recordVideo: { dir: RAW, size } });
  const t0 = T();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => log(name, 'pageerror', e.message));
  page.setDefaultTimeout(15000);
  return { ctx, page, t0, name };
}
async function finishVideo(rec, file) {
  const v = rec.page.video();
  await rec.ctx.close();
  const p = await v.path();
  const dest = path.join(RAW, file);
  fs.renameSync(p, dest);
  timeline.videos[file] = { t0: rec.t0 };
  log('saved', file);
}

async function game() {
  for (let attempt = 1; attempt <= 25; attempt++) {
    const host = await newRecorded('host', { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }, { width: 1280, height: 720 });
    const phone = await newRecorded('phone', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, { width: 390, height: 844 });
    timeline.events = [];
    await host.page.goto(`${URL}/host${FX}`);
    await host.page.waitForSelector('.code span');
    const code = (await host.page.locator('.code').innerText()).replace(/\s/g, '');
    mark('lobby', { code });
    await phone.page.goto(`${URL}/play?code=${code}`);
    await sleep(1200);
    await phone.page.locator('input:not(.code-input)').pressSequentially('Dana', { delay: 140 });
    await sleep(500);
    await phone.page.click('text=Join ▶');
    await phone.page.waitForSelector('.phone-top');
    mark('phone-joined');

    let lastState = null;
    const bots = [];
    for (const name of ['Eli', 'Fay']) {
      await sleep(1500);
      const s = io(URL, { transports: ['websocket'] });
      const r = await call(s, 'player:join', { code, name });
      const bot = { name, s, me: null, id: r.playerId };
      s.on('me', (m) => (bot.me = m));
      s.on('state', (st) => (lastState = st));
      bots.push(bot);
      mark('bot-joined', { bot: name });
    }
    await sleep(3000);
    await host.page.click('text=Start game ▶');
    mark('start');
    await sleep(1500);
    const st0 = lastState;
    const prompter = st0?.players.find((p) => p.id === st0.prompterId)?.name;
    log('attempt', attempt, 'first prompter', prompter);
    if (prompter !== 'Dana') {
      bots.forEach((b) => b.s.close());
      await host.ctx.close();
      await phone.ctx.close();
      for (const f of fs.readdirSync(RAW)) if (f.endsWith('.webm') && !/^(host|phone|gallery|solo)/.test(f)) fs.rmSync(path.join(RAW, f));
      continue;
    }

    // Round 0: the phone prompts through the real UI.
    await phone.page.waitForSelector('textarea');
    await sleep(1500);
    mark('compose');
    await phone.page.locator('textarea').pressSequentially(ROUND0.prompt, { delay: 90 });
    await sleep(600);
    await phone.page.click('text=Cartoon');
    await sleep(900);
    await phone.page.click('text=Sculpt it ✨');
    mark('submitted', { prompt: ROUND0.prompt, style: ROUND0.style });

    const queued = new Set();
    const done = new Set();
    let revealAt = { 0: 0, 1: 0 };
    let phoneStep = 0;
    const deadline = T() + 15 * 60_000;
    let lastPhase = '';
    while (T() < deadline) {
      await sleep(250);
      const st = lastState;
      if (!st) continue;
      const tag = `${st.phase}#${st.round}`;
      if (tag !== lastPhase) {
        lastPhase = tag;
        mark(`phase:${tag}`, st.job ? { job: st.job.status, stage: st.job.stage } : {});
        if (st.phase === 'revealing') revealAt[st.round] = T();
      }
      if (st.job && st.phase === 'generating') {
        const k = `stage:${st.round}:${st.job.stage}`;
        if (!done.has(k)) { done.add(k); mark(k); }
      }
      // pipelining: next prompter queues during the reveal
      if (st.phase === 'revealing' && st.round === 0) {
        for (const b of bots) if (b.me?.canQueue && !queued.has(b.name)) {
          queued.add(b.name);
          call(b.s, 'player:prompt', ROUND1).then((r) => mark('queued-early', { bot: b.name, ok: r.ok, err: r.error }));
        }
        const p = (T() - revealAt[0]) / st.revealMs;
        for (const g of R0_GUESSES) {
          const k = `g0:${g.text}`;
          if (p >= g.at && !done.has(k)) {
            done.add(k);
            const b = bots.find((x) => x.name === g.bot);
            call(b.s, 'player:guess', { text: g.text }).then((r) => mark('guess', { bot: g.bot, text: g.text, verdict: r.verdict ?? r.error }));
          }
        }
      }
      if (st.phase === 'revealing' && st.round === 1) {
        const p = (T() - revealAt[1]) / st.revealMs;
        const guessBot = bots.find((b) => b.id !== st.prompterId);
        const phoneGuess = async (text) => {
          await phone.page.locator('.guess-form input').pressSequentially(text, { delay: 220 });
          await sleep(300);
          await phone.page.press('.guess-form input', 'Enter');
          mark('phone-guess', { text });
        };
        if (phoneStep === 0 && p > 0.08) { phoneStep = 1; await phoneGuess('a toaster with arms'); }
        else if (phoneStep === 1 && p > 0.16) { phoneStep = 2; await phoneGuess('a robot'); }
        else if (phoneStep === 2 && p > 0.24 && !done.has('g1bot')) {
          done.add('g1bot');
          call(guessBot.s, 'player:guess', { text: 'robot cook' }).then((r) => mark('guess', { bot: guessBot.name, text: 'robot cook', verdict: r.verdict ?? r.error }));
        } else if (phoneStep === 2 && p > 0.3) { phoneStep = 3; await phoneGuess('robot chef'); }
        else if (phoneStep === 3 && p > 0.42 && !done.has('g1bot2')) {
          done.add('g1bot2');
          call(guessBot.s, 'player:guess', { text: 'a robot chef with a pan' }).then((r) => mark('guess', { bot: guessBot.name, text: 'a robot chef with a pan', verdict: r.verdict ?? r.error }));
        }
      }
      if (st.phase === 'prompting' && st.round === 2) { await sleep(2500); mark('end-game-footage'); break; }
    }
    bots.forEach((b) => b.s.close());
    await finishVideo(host, 'host-game.webm');
    await finishVideo(phone, 'phone-game.webm');
    saveTimeline();
    return;
  }
  throw new Error('could not get Dana as first prompter');
}

async function extras() {
  const g = await newRecorded('gallery', { viewport: { width: 1280, height: 720 } }, { width: 1280, height: 720 });
  await g.page.goto(`${URL}/gallery${FX}`);
  mark('gallery');
  await sleep(9000);
  await g.page.locator('text=a raccoon DJ with headphones').last().click().catch((e) => log('gallery click failed', e.message));
  mark('gallery-click');
  await sleep(9000);
  await finishVideo(g, 'gallery.webm');

  const s = await newRecorded('solo', { viewport: { width: 1280, height: 720 } }, { width: 1280, height: 720 });
  const daily = await (await fetch(`${URL}/api/daily`)).json();
  const manifest = JSON.parse(fs.readFileSync(new globalThis.URL('../assets/daily/manifest.json', import.meta.url), 'utf8'));
  const answers = daily.puzzles.map((p) => manifest.puzzles.find((m) => m.id === p.id));
  mark('solo', { puzzles: answers.map((a) => a.prompt) });
  await s.page.goto(`${URL}/solo${FX}`);
  const guess = async (text) => {
    await s.page.locator('.guess-form input').pressSequentially(text, { delay: 80 });
    await sleep(250);
    await s.page.press('.guess-form input', 'Enter');
    mark('solo-guess', { text });
  };
  await sleep(7000);
  await guess('a hat');
  await sleep(3500);
  await guess(answers[0].prompt.replace(/^an? /, ''));
  await sleep(5000);
  await s.page.click('button.primary:has-text("Next")').catch(async () => s.page.locator('.answer-card button.primary').first().click());
  mark('solo-next');
  await sleep(9000);
  await guess(answers[1].prompt.replace(/^an? /, ''));
  await sleep(5000);
  await finishVideo(s, 'solo.webm');
}

try {
  if (ONLY !== 'extras') await game();
  if (ONLY !== 'game') await extras();
} finally {
  saveTimeline();
  await browser.close();
}
process.exit(0);
