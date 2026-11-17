// Solo / Daily Mesh: pre-generated puzzles, answers stay on the server.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { judgeGuess } from './judge.js';
import { guessPoints, localSimilarity, verdictFor, wordHint } from './scoring.js';
import type { DailyPuzzle, Style } from './shared.js';

export interface Puzzle {
  id: string;
  prompt: string;
  aliases: string[];
  style: Style;
  file: string; // relative to assets/
}

export const SOLO_ROUND_MS = 45_000;

const manifestFile = path.join(config.assetsDir, 'daily', 'manifest.json');
function load(): Puzzle[] {
  try {
    return JSON.parse(fs.readFileSync(manifestFile, 'utf8')).puzzles as Puzzle[];
  } catch {
    return [];
  }
}
let puzzles = load();
export const reloadPuzzles = () => (puzzles = load());

const EPOCH = Date.UTC(2026, 10, 1); // Daily Mesh #1 = 2026-11-01
export function dailyNumber(now = Date.now()) {
  return Math.floor((now - EPOCH) / 86_400_000) + 1;
}

const toPublic = (p: Puzzle, i: number): DailyPuzzle => ({
  id: p.id,
  modelUrl: `/api/puzzle/${encodeURIComponent(p.id)}/model.glb`,
  style: p.style,
  wordHint: wordHint(p.prompt),
  number: i,
});

/** Today's 3 puzzles (rotates daily), the same for everyone. */
export function todaysPuzzles(): { number: number; puzzles: DailyPuzzle[] } {
  const n = dailyNumber();
  const out: DailyPuzzle[] = [];
  for (let i = 0; i < Math.min(3, puzzles.length); i++) out.push(toPublic(puzzles[(n * 3 + i) % puzzles.length], i + 1));
  return { number: n, puzzles: out };
}

export function soloPuzzles(count = 5): DailyPuzzle[] {
  const shuffled = [...puzzles].sort(() => Math.random() - 0.5).slice(0, count);
  return shuffled.map((p, i) => toPublic(p, i + 1));
}

export function puzzleFile(id: string): string | null {
  const p = puzzles.find((x) => x.id === id);
  if (!p) return null;
  const f = path.resolve(config.assetsDir, p.file);
  return f.startsWith(config.assetsDir) && fs.existsSync(f) ? f : null;
}

export async function guessPuzzle(id: string, text: string, elapsedMs: number) {
  const p = puzzles.find((x) => x.id === id);
  if (!p) return null;
  // best of the prompt and its aliases
  let best = await judgeGuess(text, p.prompt);
  for (const a of p.aliases) {
    const s = localSimilarity(text, a);
    if (s > best.similarity) best = { verdict: verdictFor(s), similarity: s, judge: 'local' };
  }
  const correct = best.verdict === 'correct';
  return {
    verdict: best.verdict,
    similarity: Math.round(best.similarity * 100) / 100,
    points: correct ? guessPoints(Math.max(0, elapsedMs), SOLO_ROUND_MS) : 0,
    answer: correct ? p.prompt : undefined,
  };
}

export function answerOf(id: string) {
  return puzzles.find((x) => x.id === id)?.prompt ?? null;
}
