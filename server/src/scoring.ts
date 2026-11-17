// Local guess scoring: normalisation, fuzzy word match, a small synonym table,
// and a weighted recall/precision score. Optional LLM judge lives in judge.ts.

const STOP = new Set(
  'a an the of with and or in on at to for from by wearing wears holding holds is are its it this that some very made into onto inside over under who which while sitting standing'.split(
    ' ',
  ),
);

// Groups of words that count as near-synonyms (partial credit 0.8).
const SYN_GROUPS: string[][] = [
  ['dog', 'puppy', 'pup', 'corgi', 'doggo', 'hound', 'pooch', 'shiba', 'poodle', 'terrier'],
  ['cat', 'kitten', 'kitty', 'feline'],
  ['car', 'auto', 'automobile', 'vehicle', 'truck'],
  ['bottle', 'flask', 'canteen'],
  ['lantern', 'lamp', 'light'],
  ['boombox', 'radio', 'stereo', 'speaker', 'cassette'],
  ['duck', 'duckling', 'bird', 'goose'],
  ['fox', 'wolf', 'coyote'],
  ['chair', 'seat', 'armchair', 'stool', 'throne'],
  ['crown', 'tiara', 'diadem'],
  ['hat', 'cap', 'beanie'],
  ['robot', 'android', 'droid', 'mech', 'bot'],
  ['dragon', 'wyvern', 'drake'],
  ['sleepy', 'tired', 'sleeping', 'drowsy', 'asleep'],
  ['big', 'giant', 'huge', 'large'],
  ['small', 'tiny', 'little', 'mini'],
  ['house', 'home', 'cottage', 'cabin', 'hut'],
  ['ship', 'boat', 'vessel'],
  ['sword', 'blade', 'katana'],
  ['avocado', 'guacamole'],
  ['mug', 'cup'],
  ['rocket', 'spaceship', 'spacecraft'],
  ['shoe', 'sneaker', 'boot'],
  ['burger', 'hamburger', 'cheeseburger'],
  ['bunny', 'rabbit', 'hare'],
  ['frog', 'toad'],
  ['penguin', 'bird'],
  ['cake', 'cupcake'],
  ['teapot', 'kettle'],
];
const SYN = new Map<string, Set<string>>();
for (const g of SYN_GROUPS) for (const w of g) {
  const s = SYN.get(w) ?? new Set<string>();
  g.forEach((x) => x !== w && s.add(x));
  SYN.set(w, s);
}

export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map(stem);
}

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** 1 exact/fuzzy, 0.8 synonym, else 0. */
export function wordSim(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen >= 4 && 1 - lev(a, b) / maxLen >= 0.75) return 0.95; // typo tolerance
  if (SYN.get(a)?.has(b)) return 0.8;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) return 0.85; // "boombox" vs "box"-ish
  return 0;
}

/** Similarity in [0,1] between a guess and the secret prompt. */
export function localSimilarity(guess: string, answer: string): number {
  const g = tokens(guess);
  const a = tokens(answer);
  if (!g.length || !a.length) return 0;
  if (g.join(' ') === a.join(' ')) return 1;
  const best = (w: string, pool: string[]) => pool.reduce((m, x) => Math.max(m, wordSim(w, x)), 0);
  const recall = a.reduce((s, w) => s + best(w, g), 0) / a.length;
  const precision = g.reduce((s, w) => s + best(w, a), 0) / g.length;
  let sim = 0.7 * recall + 0.3 * precision;
  // Short prompts ("a rubber duck"): naming the head noun exactly is enough.
  if (a.length <= 2 && best(a[a.length - 1], g) >= 0.95) sim = Math.max(sim, 0.7);
  return Math.min(1, sim);
}

export const CORRECT_AT = 0.65;
export const CLOSE_AT = 0.3;

export function verdictFor(sim: number): 'correct' | 'close' | 'miss' {
  return sim >= CORRECT_AT - 1e-9 ? 'correct' : sim >= CLOSE_AT - 1e-9 ? 'close' : 'miss';
}

/** "a sleepy corgi" -> "_ ______ _____" style hint. */
export function wordHint(prompt: string): string {
  return prompt
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[a-z0-9]/gi, '_'))
    .join('  ');
}

/** Points for a correct guess: 100..500 depending on speed. */
export function guessPoints(elapsedMs: number, roundMs: number): number {
  const f = Math.max(0, Math.min(1, elapsedMs / roundMs));
  return Math.round((100 + 400 * (1 - f)) / 5) * 5;
}
