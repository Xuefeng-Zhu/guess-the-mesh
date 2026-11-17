// In-memory rooms + the multiplayer game loop over Socket.io.
import { nanoid, customAlphabet } from 'nanoid';
import type { Server, Socket } from 'socket.io';
import { config } from './config.js';
import { judgeGuess } from './judge.js';
import { enqueue, providerName, queuePosition } from './lux3d.js';
import { randomPrompt } from './prompts.js';
import { guessPoints, wordHint } from './scoring.js';
import { addEntry, modelPath, modelUrl, updateEntry } from './store.js';
import {
  STYLES,
  type FeedItem,
  type JobStatus,
  type Phase,
  type PlayerView,
  type PublicJob,
  type RoomState,
  type RoundSummary,
  type Style,
} from './shared.js';

const roomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ', 4);
const COLORS = ['#FF4D6D', '#3A86FF', '#FFBE0B', '#06D6A0', '#8338EC', '#FB5607', '#00B4D8', '#EF476F', '#7CB518', '#F15BB5'];
const EMOJI = ['🦊', '🐙', '🦄', '🐸', '🐼', '🦖', '🐝', '🐳', '🦉', '🐯', '🐧', '🦦'];

interface Player {
  id: string;
  name: string;
  color: string;
  emoji: string;
  score: number;
  sockets: Set<string>;
  lastGuessAt: number;
}

interface Job {
  id: string; // also the model / gallery id
  round: number;
  prompterId: string;
  prompt: string;
  style: Style;
  status: JobStatus;
  stage: PublicJob['stage'];
  createdAt: number;
  startedAt?: number;
  error?: string;
  auto: boolean;
}

interface Room {
  code: string;
  hostKey: string;
  players: Map<string, Player>;
  order: string[];
  phase: Phase;
  round: number;
  totalRounds: number;
  jobs: Map<number, Job>;
  revealStart: number | null;
  roundEndsAt: number | null;
  phaseEndsAt: number | null;
  feed: FeedItem[];
  guesses: Map<string, { text: string; verdict: 'correct' | 'close' | 'miss'; points?: number }[]>;
  correct: Map<string, { points: number; ms: number }>;
  prompterPoints: number;
  history: RoundSummary[];
  timer: NodeJS.Timeout | null;
  promptErrors: Map<string, string>;
  lastActivity: number;
}

const rooms = new Map<string, Room>();
let io: Server;

const EXPECTED_MS = () => (providerName() === 'mock' ? config.mockDelayMs : config.lux3dVersion === 'G1' ? 120_000 : 60_000);

function newRoom(): Room {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const room: Room = {
    code,
    hostKey: nanoid(16),
    players: new Map(),
    order: [],
    phase: 'lobby',
    round: 0,
    totalRounds: 0,
    jobs: new Map(),
    revealStart: null,
    roundEndsAt: null,
    phaseEndsAt: null,
    feed: [],
    guesses: new Map(),
    correct: new Map(),
    prompterPoints: 0,
    history: [],
    timer: null,
    promptErrors: new Map(),
    lastActivity: Date.now(),
  };
  rooms.set(code, room);
  return room;
}

const prompterOf = (room: Room, r: number) => (room.order.length ? room.order[r % room.order.length] : null);
const connected = (p: Player) => p.sockets.size > 0;

function publicJob(job: Job | undefined): PublicJob | null {
  if (!job) return null;
  return {
    round: job.round,
    prompterId: job.prompterId,
    status: job.status,
    stage: job.stage,
    style: job.style,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    expectedMs: EXPECTED_MS(),
    queuePosition: job.status === 'queued' ? queuePosition(job.id) : undefined,
    provider: providerName(),
    error: job.error,
  };
}

function publicState(room: Room): RoomState {
  const job = room.jobs.get(room.round);
  const revealing = room.phase === 'revealing' || room.phase === 'roundEnd';
  return {
    code: room.code,
    phase: room.phase,
    serverNow: Date.now(),
    players: [...room.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      emoji: p.emoji,
      score: p.score,
      connected: connected(p),
      guessedThisRound: room.correct.has(p.id),
    })),
    round: room.round,
    totalRounds: room.totalRounds,
    prompterId: room.phase === 'lobby' ? null : prompterOf(room, room.round),
    nextPrompterId: room.round + 1 < room.totalRounds ? prompterOf(room, room.round + 1) : null,
    job: publicJob(job),
    nextJob: publicJob(room.jobs.get(room.round + 1)),
    modelUrl: revealing && job ? modelUrl(job.id) : null,
    revealStart: room.revealStart,
    revealMs: config.revealMs,
    roundMs: config.roundMs,
    roundEndsAt: room.roundEndsAt,
    wordHint: revealing && job ? wordHint(job.prompt) : null,
    feed: room.feed.slice(-30),
    lastRound: room.phase === 'roundEnd' || room.phase === 'gameOver' ? room.history.at(-1) ?? null : null,
    history: room.history,
    provider: providerName(),
    phaseEndsAt: room.phaseEndsAt,
  };
}

function playerView(room: Room, p: Player): PlayerView {
  const isPrompter = room.phase !== 'lobby' && room.phase !== 'gameOver' && prompterOf(room, room.round) === p.id;
  const nextRound = room.round + 1;
  const isNextPrompter = room.phase !== 'lobby' && room.phase !== 'gameOver' && nextRound < room.totalRounds && prompterOf(room, nextRound) === p.id;
  const mine = [...room.jobs.values()].find((j) => j.prompterId === p.id && j.round >= room.round && (j.round > room.round || room.phase === 'generating' || room.phase === 'prompting'));
  return {
    playerId: p.id,
    isPrompter,
    isNextPrompter,
    mustPrompt: isPrompter && room.phase === 'prompting' && !room.jobs.has(room.round),
    canQueue: isNextPrompter && !room.jobs.has(nextRound),
    myQueuedPrompt: mine ? { prompt: mine.prompt, style: mine.style, status: mine.status } : null,
    myGuesses: room.guesses.get(p.id) ?? [],
    promptError: room.promptErrors.get(p.id),
  };
}

function emit(room: Room) {
  room.lastActivity = Date.now();
  io.to(room.code).emit('state', publicState(room));
  for (const p of room.players.values()) io.to(`p:${room.code}:${p.id}`).emit('me', playerView(room, p));
}

function setTimer(room: Room, ms: number, fn: () => void) {
  if (room.timer) clearTimeout(room.timer);
  room.timer = setTimeout(() => {
    room.timer = null;
    fn();
  }, ms);
}

// ---------- game flow ----------
function startGame(room: Room, roundsPerPlayer = 1) {
  const ids = [...room.players.values()].filter(connected).map((p) => p.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  room.order = ids;
  room.totalRounds = ids.length * Math.max(1, Math.min(3, roundsPerPlayer));
  room.history = [];
  room.jobs.clear();
  room.promptErrors.clear();
  for (const p of room.players.values()) p.score = 0;
  enterRound(room, 0);
}

function enterRound(room: Room, r: number) {
  room.round = r;
  room.feed = [];
  room.guesses.clear();
  room.correct.clear();
  room.prompterPoints = 0;
  room.revealStart = null;
  room.roundEndsAt = null;
  room.phaseEndsAt = null;
  const job = room.jobs.get(r);
  if (!job) {
    room.phase = 'prompting';
    room.phaseEndsAt = Date.now() + config.promptTimeoutMs;
    setTimer(room, config.promptTimeoutMs, () => autoPrompt(room));
  } else if (job.status === 'ready') {
    startReveal(room);
    return;
  } else {
    room.phase = 'generating';
    if (room.timer) clearTimeout(room.timer);
  }
  emit(room);
}

function autoPrompt(room: Room) {
  if (room.phase !== 'prompting' || room.jobs.has(room.round)) return;
  const pid = prompterOf(room, room.round);
  if (pid) submitPrompt(room, pid, randomPrompt(), 'cartoon', true);
}

function submitPrompt(room: Room, playerId: string, prompt: string, style: Style, auto = false): string | null {
  prompt = prompt.trim().replace(/\s+/g, ' ').slice(0, 120);
  if (prompt.length < 3) return 'Prompt is too short';
  if (!STYLES.includes(style)) style = 'cartoon';
  let target: number | null = null;
  if (room.phase === 'prompting' && prompterOf(room, room.round) === playerId && !room.jobs.has(room.round)) target = room.round;
  else if (
    room.phase !== 'lobby' &&
    room.phase !== 'gameOver' &&
    room.round + 1 < room.totalRounds &&
    prompterOf(room, room.round + 1) === playerId &&
    !room.jobs.has(room.round + 1)
  )
    target = room.round + 1;
  if (target === null) return "It isn't your turn to prompt";

  const job: Job = {
    id: nanoid(10),
    round: target,
    prompterId: playerId,
    prompt,
    style,
    status: 'queued',
    stage: 'queued',
    createdAt: Date.now(),
    auto,
  };
  room.jobs.set(target, job);
  room.promptErrors.delete(playerId);
  if (target === room.round) {
    room.phase = 'generating';
    room.phaseEndsAt = null;
    if (room.timer) clearTimeout(room.timer);
  }
  emit(room);

  enqueue(job.id, { prompt, style, outFile: modelPath(job.id) }, (s) => {
    job.status = 'generating';
    job.stage = s.stage;
    job.startedAt ??= Date.now();
    emit(room);
  })
    .then((res) => {
      job.status = 'ready';
      job.stage = 'done';
      const prompter = room.players.get(playerId);
      addEntry({
        id: job.id,
        prompt,
        style,
        prompter: prompter?.name ?? 'someone',
        roomCode: room.code,
        createdAt: Date.now(),
        provider: res.provider,
        taskId: res.taskId,
        generationMs: res.ms,
        modelUrl: modelUrl(job.id),
        wrongGuesses: [],
        solvedBy: [],
      });
      if (rooms.get(room.code) !== room) return;
      if (room.phase === 'generating' && room.round === job.round) startReveal(room);
      else emit(room);
    })
    .catch((err: Error) => {
      console.error('[gen] failed', err.message);
      if (room.jobs.get(job.round) === job) room.jobs.delete(job.round);
      room.promptErrors.set(playerId, `Lux3D couldn't sculpt that one (${err.message.slice(0, 80)}). Try another prompt!`);
      if (room.phase === 'generating' && room.round === job.round) {
        room.phase = 'prompting';
        room.phaseEndsAt = Date.now() + config.promptTimeoutMs;
        setTimer(room, config.promptTimeoutMs, () => autoPrompt(room));
      }
      emit(room);
    });
  return null;
}

function startReveal(room: Room) {
  room.phase = 'revealing';
  room.revealStart = Date.now();
  room.roundEndsAt = room.revealStart + config.roundMs;
  room.phaseEndsAt = room.roundEndsAt;
  setTimer(room, config.roundMs, () => endRound(room));
  emit(room);
}

function guessers(room: Room) {
  const pid = prompterOf(room, room.round);
  return [...room.players.values()].filter((p) => p.id !== pid && connected(p));
}

async function handleGuess(room: Room, playerId: string, raw: string) {
  const text = raw.trim().slice(0, 80);
  const p = room.players.get(playerId);
  const job = room.jobs.get(room.round);
  if (!p || !job || room.phase !== 'revealing' || !text) return { ok: false, error: 'Not guessing right now' };
  if (prompterOf(room, room.round) === playerId) return { ok: false, error: "You're the prompter!" };
  if (room.correct.has(playerId)) return { ok: false, error: 'You already got it' };
  if (Date.now() - p.lastGuessAt < 600) return { ok: false, error: 'Slow down!' };
  p.lastGuessAt = Date.now();

  const res = await judgeGuess(text, job.prompt);
  if (room.phase !== 'revealing' || room.jobs.get(room.round) !== job || room.correct.has(playerId)) return { ok: false };
  const list = room.guesses.get(playerId) ?? [];
  const item: FeedItem = { id: nanoid(6), playerId, name: p.name, color: p.color, text, verdict: res.verdict, at: Date.now() };
  if (res.verdict === 'correct') {
    const ms = Date.now() - (room.revealStart ?? Date.now());
    const pts = guessPoints(ms, config.roundMs);
    p.score += pts;
    const prompter = room.players.get(job.prompterId);
    const bonus = room.correct.size === 0 ? 100 : 50;
    if (prompter) prompter.score += bonus;
    room.prompterPoints += bonus;
    room.correct.set(playerId, { points: pts, ms });
    item.text = null;
    item.points = pts;
    list.push({ text, verdict: 'correct', points: pts });
    updateEntry(job.id, (e) => e.solvedBy.push(p.name));
  } else {
    list.push({ text, verdict: res.verdict });
    updateEntry(job.id, (e) => {
      if (e.wrongGuesses.length < 60 && !e.wrongGuesses.includes(text)) e.wrongGuesses.push(text);
    });
  }
  room.guesses.set(playerId, list);
  room.feed.push(item);
  const remaining = guessers(room).filter((g) => !room.correct.has(g.id));
  if (res.verdict === 'correct' && remaining.length === 0) {
    room.phaseEndsAt = Date.now() + 2000;
    setTimer(room, 2000, () => endRound(room));
  }
  emit(room);
  return { ok: true, verdict: res.verdict, points: item.points };
}

function endRound(room: Room) {
  if (room.phase !== 'revealing') return;
  const job = room.jobs.get(room.round)!;
  const misses = room.feed.filter((f) => f.verdict !== 'correct' && f.text).map((f) => f.text!);
  room.history.push({
    round: room.round,
    prompt: job.prompt,
    style: job.style,
    prompterId: job.prompterId,
    modelId: job.id,
    modelUrl: modelUrl(job.id),
    correct: [...room.correct.entries()].map(([playerId, v]) => ({ playerId, ...v })),
    prompterPoints: room.prompterPoints,
    funniestMiss: misses.sort((a, b) => b.length - a.length)[0],
  });
  room.phase = 'roundEnd';
  room.phaseEndsAt = Date.now() + config.roundEndMs;
  setTimer(room, config.roundEndMs, () => {
    if (room.round + 1 < room.totalRounds) enterRound(room, room.round + 1);
    else {
      room.phase = 'gameOver';
      room.phaseEndsAt = null;
      emit(room);
    }
  });
  emit(room);
}

function skip(room: Room) {
  if (room.phase === 'prompting') autoPrompt(room);
  else if (room.phase === 'revealing') endRound(room);
  else if (room.phase === 'roundEnd') {
    if (room.timer) clearTimeout(room.timer);
    if (room.round + 1 < room.totalRounds) enterRound(room, room.round + 1);
    else {
      room.phase = 'gameOver';
      emit(room);
    }
  }
}

// ---------- sockets ----------
type Ack = (r: any) => void;
const safeAck = (ack: unknown): Ack => (typeof ack === 'function' ? (ack as Ack) : () => {});

export function attachRooms(server: Server) {
  io = server;
  setInterval(() => {
    const cutoff = Date.now() - 3 * 3600_000;
    for (const [code, r] of rooms) if (r.lastActivity < cutoff) {
      if (r.timer) clearTimeout(r.timer);
      rooms.delete(code);
    }
  }, 10 * 60_000).unref();

  io.on('connection', (socket: Socket) => {
    let room: Room | null = null;
    let playerId: string | null = null;
    let isHost = false;

    const getRoom = (code: unknown) => rooms.get(String(code ?? '').toUpperCase().trim());

    socket.on('host:create', (_: unknown, ackRaw: unknown) => {
      const ack = safeAck(ackRaw);
      room = newRoom();
      isHost = true;
      socket.join(room.code);
      ack({ ok: true, code: room.code, hostKey: room.hostKey });
      emit(room);
    });

    socket.on('host:attach', (d: any, ackRaw: unknown) => {
      const ack = safeAck(ackRaw);
      const r = getRoom(d?.code);
      if (!r || r.hostKey !== d?.hostKey) return ack({ ok: false, error: 'Room not found' });
      room = r;
      isHost = true;
      socket.join(r.code);
      ack({ ok: true, code: r.code });
      emit(r);
    });

    socket.on('host:start', (d: any, ackRaw: unknown) => {
      const ack = safeAck(ackRaw);
      if (!room || !isHost) return ack({ ok: false, error: 'Not host' });
      const n = [...room.players.values()].filter(connected).length;
      if (n < 2) return ack({ ok: false, error: 'Need at least 2 players' });
      if (room.phase !== 'lobby' && room.phase !== 'gameOver') return ack({ ok: false, error: 'Already playing' });
      startGame(room, Number(d?.roundsPerPlayer) || 1);
      ack({ ok: true });
    });

    socket.on('host:skip', (_: unknown, ackRaw: unknown) => {
      if (room && isHost) skip(room);
      safeAck(ackRaw)({ ok: true });
    });

    socket.on('host:lobby', (_: unknown, ackRaw: unknown) => {
      if (room && isHost) {
        if (room.timer) clearTimeout(room.timer);
        room.phase = 'lobby';
        room.jobs.clear();
        room.history = [];
        room.feed = [];
        room.phaseEndsAt = null;
        emit(room);
      }
      safeAck(ackRaw)({ ok: true });
    });

    socket.on('player:join', (d: any, ackRaw: unknown) => {
      const ack = safeAck(ackRaw);
      const r = getRoom(d?.code);
      if (!r) return ack({ ok: false, error: 'No room with that code' });
      let p = d?.playerId ? r.players.get(String(d.playerId)) : undefined;
      if (!p) {
        const name = String(d?.name ?? '').trim().slice(0, 16);
        if (!name) return ack({ ok: false, error: 'Pick a name' });
        if (r.players.size >= 10) return ack({ ok: false, error: 'Room is full' });
        if ([...r.players.values()].some((x) => x.name.toLowerCase() === name.toLowerCase()))
          return ack({ ok: false, error: 'Name taken' });
        const i = r.players.size;
        p = { id: nanoid(8), name, color: COLORS[i % COLORS.length], emoji: EMOJI[i % EMOJI.length], score: 0, sockets: new Set(), lastGuessAt: 0 };
        r.players.set(p.id, p);
      }
      room = r;
      playerId = p.id;
      p.sockets.add(socket.id);
      socket.join(r.code);
      socket.join(`p:${r.code}:${p.id}`);
      ack({ ok: true, playerId: p.id, code: r.code });
      emit(r);
    });

    socket.on('player:prompt', (d: any, ackRaw: unknown) => {
      const ack = safeAck(ackRaw);
      if (!room || !playerId) return ack({ ok: false, error: 'Join a room first' });
      const err = submitPrompt(room, playerId, String(d?.prompt ?? ''), d?.style as Style);
      ack(err ? { ok: false, error: err } : { ok: true });
    });

    socket.on('player:guess', async (d: any, ackRaw: unknown) => {
      const ack = safeAck(ackRaw);
      if (!room || !playerId) return ack({ ok: false, error: 'Join a room first' });
      ack(await handleGuess(room, playerId, String(d?.text ?? '')));
    });

    socket.on('inspire', (_: unknown, ackRaw: unknown) => safeAck(ackRaw)({ prompt: randomPrompt() }));

    socket.on('disconnect', () => {
      if (room && playerId) {
        room.players.get(playerId)?.sockets.delete(socket.id);
        const r = room;
        emit(r);
        // If everyone still connected has guessed, don't make them wait.
        if (r.phase === 'revealing' && r.correct.size > 0 && guessers(r).every((g) => r.correct.has(g.id))) endRound(r);
      }
    });
  });
}

export const roomCount = () => rooms.size;
