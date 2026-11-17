import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// server/src or server/dist -> project root
export const ROOT = path.resolve(here, '..', '..');

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(process.env.PORT, 3000),
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(ROOT, 'data')),
  assetsDir: path.join(ROOT, 'assets'),
  clientDir: path.join(ROOT, 'dist', 'client'),
  aholoKey: process.env.AHOLO_API_KEY ?? '',
  /** Mock when LUX3D_MOCK=1 or no API key. */
  get mock() {
    return process.env.LUX3D_MOCK === '1' || !this.aholoKey;
  },
  lux3dVersion: (process.env.LUX3D_VERSION as 'G1' | 'G1-Turbo') ?? 'G1-Turbo',
  faceCount: num(process.env.LUX3D_FACE_COUNT, 50000),
  /** Lux3D allows one in-flight generation per account; keep 1 unless your plan says otherwise. */
  concurrency: num(process.env.LUX3D_CONCURRENCY, 1),
  generationTimeoutMs: num(process.env.LUX3D_TIMEOUT_MS, 6 * 60_000),
  pollMs: num(process.env.LUX3D_POLL_MS, 5000),
  mockDelayMs: num(process.env.MOCK_DELAY_MS, 9000),
  revealMs: num(process.env.REVEAL_MS, 50_000),
  roundMs: num(process.env.ROUND_MS, 60_000),
  roundEndMs: num(process.env.ROUND_END_MS, 9000),
  promptTimeoutMs: num(process.env.PROMPT_TIMEOUT_MS, 90_000),
  openrouterKey: process.env.OPENROUTER_API_KEY ?? '',
  openrouterModel: process.env.OPENROUTER_MODEL ?? 'openai/gpt-4o-mini',
};
