// Types shared by the server and the React client.

export const STYLES = [
  'photorealistic',
  'cartoon',
  'anime',
  'hand_painted',
  'cyberpunk',
  'fantasy',
  'glass',
] as const;
export type Style = (typeof STYLES)[number];

export type Phase = 'lobby' | 'prompting' | 'generating' | 'revealing' | 'roundEnd' | 'gameOver';

export type JobStatus = 'queued' | 'generating' | 'ready' | 'failed';

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  emoji: string;
  score: number;
  connected: boolean;
  guessedThisRound: boolean;
}

export interface FeedItem {
  id: string;
  playerId: string;
  name: string;
  color: string;
  /** null when the guess was correct (we never leak the answer). */
  text: string | null;
  verdict: 'correct' | 'close' | 'miss';
  points?: number;
  at: number;
}

export interface PublicJob {
  round: number;
  prompterId: string;
  status: JobStatus;
  stage: 'queued' | 'submitted' | 'running' | 'downloading' | 'done' | 'failed';
  style: Style;
  createdAt: number;
  startedAt?: number;
  expectedMs: number;
  queuePosition?: number;
  provider: 'lux3d' | 'mock';
  error?: string;
}

export interface RoundSummary {
  round: number;
  prompt: string;
  style: Style;
  prompterId: string;
  modelId: string;
  modelUrl: string;
  correct: { playerId: string; points: number; ms: number }[];
  prompterPoints: number;
  funniestMiss?: string;
}

export interface RoomState {
  code: string;
  phase: Phase;
  serverNow: number;
  players: PublicPlayer[];
  round: number; // 0-based index of the current round
  totalRounds: number;
  prompterId: string | null;
  nextPrompterId: string | null;
  job: PublicJob | null; // job for the current round
  nextJob: PublicJob | null; // job queued early for the next round
  modelUrl: string | null; // set once revealing
  revealStart: number | null;
  revealMs: number;
  roundMs: number;
  roundEndsAt: number | null;
  wordHint: string | null; // e.g. "_ _____ _____" (word lengths)
  feed: FeedItem[];
  lastRound: RoundSummary | null;
  history: RoundSummary[];
  provider: 'lux3d' | 'mock';
  phaseEndsAt: number | null;
}

/** Extra, per-player data sent only to that player's phone. */
export interface PlayerView {
  playerId: string;
  isPrompter: boolean;
  isNextPrompter: boolean;
  mustPrompt: boolean; // current round is waiting on this player's prompt
  canQueue: boolean; // may submit next round's prompt early
  myQueuedPrompt: { prompt: string; style: Style; status: JobStatus } | null;
  myGuesses: { text: string; verdict: 'correct' | 'close' | 'miss'; points?: number }[];
  promptError?: string;
}

export interface GalleryEntry {
  id: string;
  prompt: string;
  style: Style;
  prompter: string;
  roomCode: string | null;
  createdAt: number;
  provider: 'lux3d' | 'mock';
  taskId: string | null;
  generationMs: number;
  modelUrl: string;
  wrongGuesses: string[];
  solvedBy: string[];
}

export interface DailyPuzzle {
  id: string;
  modelUrl: string;
  style: Style;
  wordHint: string;
  number: number;
}

export interface GuessResult {
  verdict: 'correct' | 'close' | 'miss';
  similarity: number;
  judge: 'local' | 'llm';
}
