import { config } from './config.js';
import { CORRECT_AT, CLOSE_AT, localSimilarity, verdictFor } from './scoring.js';
import type { GuessResult } from './shared.js';

/**
 * Score a guess. Local fuzzy matching always runs; when OPENROUTER_API_KEY is set,
 * guesses in the ambiguous band are sent to an LLM judge (2.5s timeout, falls back to local).
 */
export async function judgeGuess(guess: string, answer: string): Promise<GuessResult> {
  const sim = localSimilarity(guess, answer);
  if (!config.openrouterKey || sim >= CORRECT_AT || sim < CLOSE_AT * 0.5) {
    return { verdict: verdictFor(sim), similarity: sim, judge: 'local' };
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${config.openrouterKey}`,
        'Content-Type': 'application/json',
        'X-Title': 'Guess the Mesh',
      },
      body: JSON.stringify({
        model: config.openrouterModel,
        temperature: 0,
        max_tokens: 30,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You judge a 3D Pictionary game. Given the SECRET prompt used to generate a 3D model and a player GUESS, return JSON {"score": number} between 0 and 1 for how well the guess captures the main subject and key details. Same main object with a key detail = 0.8+. Main object only = 0.5-0.7. Related but wrong object = 0.3. Unrelated = 0.',
          },
          { role: 'user', content: `SECRET: ${answer}\nGUESS: ${guess}` },
        ],
      }),
    });
    clearTimeout(t);
    const j: any = await res.json();
    const score = Number(JSON.parse(j.choices?.[0]?.message?.content ?? '{}').score);
    if (Number.isFinite(score)) {
      const s = Math.max(sim, Math.min(1, score));
      return { verdict: verdictFor(s), similarity: s, judge: 'llm' };
    }
  } catch {
    /* fall through to local */
  }
  return { verdict: verdictFor(sim), similarity: sim, judge: 'local' };
}
