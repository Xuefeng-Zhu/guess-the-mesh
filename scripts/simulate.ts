// Headless end-to-end check: 1 host + 3 phone players play a full game over Socket.io.
// Usage: start the server (mock mode is fine), then  SIM_URL=http://localhost:3000 npm run simulate
import { io, type Socket } from 'socket.io-client';
import type { PlayerView, RoomState } from '../server/src/shared';

const URL = process.env.SIM_URL ?? 'http://localhost:3000';
const ROUNDS_TO_CHECK = Number(process.env.SIM_ROUNDS ?? 2);
const log = (...a: unknown[]) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = <T = any>(s: Socket, ev: string, p: unknown = {}) => new Promise<T>((res) => s.emit(ev, p, res));

const PROMPTS: Record<string, { prompt: string; style: string; wrong: string; close: string; right: string }> = {
  Ava: { prompt: 'a rubber duck pirate captain', style: 'cartoon', wrong: 'banana boat', close: 'a duck', right: 'rubber duck pirate' },
  Ben: { prompt: 'a toy car with rocket boosters', style: 'cyberpunk', wrong: 'a shoe', close: 'toy truck', right: 'toy car with rockets' },
  Cy: { prompt: 'a sleepy fox in a scarf', style: 'anime', wrong: 'a cat', close: 'a fox', right: 'sleepy fox scarf' },
};

async function main() {
  const host = io(URL, { transports: ['websocket'] });
  const created = await call<{ ok: boolean; code: string }>(host, 'host:create');
  if (!created.ok) throw new Error('create failed');
  const code = created.code;
  log('room', code);

  let state: RoomState | null = null;
  const phases: string[] = [];
  let sawEarlyQueue = false;
  let sawSculptingWithQueuePosition = false;
  host.on('state', (s: RoomState) => {
    state = s;
    const tag = `${s.phase}#${s.round}`;
    if (phases.at(-1) !== tag) {
      phases.push(tag);
      log('host phase ->', tag, s.job ? `job=${s.job.status}/${s.job.stage}` : '', s.nextJob ? `next=${s.nextJob.status}` : '');
    }
    if (s.phase === 'revealing' && s.nextJob) sawEarlyQueue = true;
    if (s.job?.status === 'generating') sawSculptingWithQueuePosition = true;
  });

  const players: { name: string; sock: Socket; me: PlayerView | null; busy: boolean; guessedRound: number }[] = [];
  for (const name of Object.keys(PROMPTS)) {
    const sock = io(URL, { transports: ['websocket'] });
    const r = await call<{ ok: boolean; playerId: string; error?: string }>(sock, 'player:join', { code, name });
    if (!r.ok) throw new Error(`join ${name}: ${r.error}`);
    const p = { name, sock, me: null as PlayerView | null, busy: false, guessedRound: -1 };
    sock.on('me', (m: PlayerView) => (p.me = m));
    players.push(p);
    log('joined', name);
  }
  await sleep(300);
  const started = await call<{ ok: boolean; error?: string }>(host, 'host:start', { roundsPerPlayer: 1 });
  if (!started.ok) throw new Error(`start: ${started.error}`);

  const deadline = Date.now() + 110_000;
  while (Date.now() < deadline) {
    await sleep(250);
    const s = state as RoomState | null;
    if (!s) continue;
    if (s.phase === 'gameOver' || (s.history.length >= ROUNDS_TO_CHECK && s.phase !== 'roundEnd' && ROUNDS_TO_CHECK < s.totalRounds)) break;
    for (const p of players) {
      const me = p.me;
      if (!me || p.busy) continue;
      const plan = PROMPTS[p.name];
      if (me.mustPrompt || (me.canQueue && (s.phase === 'generating' || s.phase === 'revealing'))) {
        p.busy = true;
        const r = await call(p.sock, 'player:prompt', { prompt: plan.prompt, style: plan.style });
        log(`${p.name} ${me.mustPrompt ? 'prompts' : 'QUEUES EARLY'}: "${plan.prompt}" ->`, r.ok ? 'ok' : r.error);
        p.busy = false;
      } else if (s.phase === 'revealing' && !me.isPrompter && p.guessedRound !== s.round) {
        p.busy = true;
        p.guessedRound = s.round;
        const target = PROMPTS[players.find((x) => x.me && s.prompterId === x.me.playerId)!.name];
        (async () => {
          for (const g of [target.wrong, target.close, target.right]) {
            await sleep(700 + Math.random() * 500);
            const r = await call(p.sock, 'player:guess', { text: g });
            log(`  ${p.name} guesses "${g}" ->`, r.verdict ?? r.error, r.points ? `+${r.points}` : '');
            if (r.verdict === 'correct') break;
          }
          p.busy = false;
        })();
      }
    }
  }

  const s = state as unknown as RoomState;
  const gallery = await fetch(`${URL}/api/gallery`).then((r) => r.json());
  const firstModel = s.history[0] ? await fetch(`${URL}${s.history[0].modelUrl}?download=1`) : null;
  const report = {
    code,
    finalPhase: s.phase,
    roundsPlayed: s.history.length,
    totalRounds: s.totalRounds,
    rounds: s.history.map((h) => ({ prompt: h.prompt, style: h.style, correct: h.correct.length, prompterPoints: h.prompterPoints, funniestMiss: h.funniestMiss })),
    scores: Object.fromEntries(s.players.map((p) => [p.name, p.score])),
    earlyQueueObserved: sawEarlyQueue,
    generatingObserved: sawSculptingWithQueuePosition,
    galleryCount: gallery.items.length,
    galleryWrongGuessesSample: gallery.items[0]?.wrongGuesses,
    modelDownload: firstModel ? `${firstModel.status} ${firstModel.headers.get('content-disposition')}` : null,
    phases,
  };
  console.log(JSON.stringify(report, null, 2));
  const ok =
    s.history.length >= ROUNDS_TO_CHECK &&
    s.history.slice(0, ROUNDS_TO_CHECK).every((h) => h.correct.length === 2) &&
    firstModel?.status === 200 &&
    sawEarlyQueue;
  log(ok ? 'SIMULATION PASSED' : 'SIMULATION FAILED');
  host.close();
  players.forEach((p) => p.sock.close());
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
