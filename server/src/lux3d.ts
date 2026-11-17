// Lux3D text-to-3D provider (real, via @manycore/aholo-sdk-lux3d) + a mock provider
// that serves bundled CC0 glTF samples, + a serial generation queue (Lux3D allows one
// in-flight generation per account: GENERATION_CONCURRENCY_LIMIT_EXCEEDED otherwise).
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLux3dClient, type Lux3dClient } from '@manycore/aholo-sdk-lux3d';
import { config } from './config.js';
import type { Style } from './shared.js';

export interface GenerateRequest {
  prompt: string;
  style: Style;
  /** absolute path the GLB must be written to */
  outFile: string;
}
export interface GenerateResult {
  provider: 'lux3d' | 'mock';
  taskId: string | null;
  ms: number;
}
export type StatusCb = (s: { stage: 'submitted' | 'running' | 'downloading'; taskId?: string }) => void;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- mock ----------
export const MOCK_SAMPLES: { file: string; keywords: string[] }[] = [
  { file: 'Duck.glb', keywords: ['duck', 'duckling', 'bird', 'goose', 'rubber'] },
  { file: 'Fox.glb', keywords: ['fox', 'wolf', 'dog', 'corgi', 'puppy', 'animal'] },
  { file: 'Avocado.glb', keywords: ['avocado', 'fruit', 'guacamole', 'pear'] },
  { file: 'BoomBox.glb', keywords: ['boombox', 'radio', 'stereo', 'speaker', 'music'] },
  { file: 'Lantern.glb', keywords: ['lantern', 'lamp', 'light', 'street'] },
  { file: 'WaterBottle.glb', keywords: ['bottle', 'water', 'flask', 'drink'] },
  { file: 'ToyCar.glb', keywords: ['car', 'toy', 'vehicle', 'truck', 'race'] },
  { file: 'SheenChair.glb', keywords: ['chair', 'seat', 'throne', 'sofa', 'armchair'] },
];

export function pickMockSample(prompt: string): string {
  const p = prompt.toLowerCase();
  const hit = MOCK_SAMPLES.find((s) => s.keywords.some((k) => p.includes(k)));
  const pick = hit ?? MOCK_SAMPLES[Math.floor(Math.random() * MOCK_SAMPLES.length)];
  return path.join(config.assetsDir, 'samples', pick.file);
}

async function mockGenerate(req: GenerateRequest, onStatus: StatusCb): Promise<GenerateResult> {
  const t0 = Date.now();
  const taskId = `mock-${t0}`;
  onStatus({ stage: 'submitted', taskId });
  await sleep(Math.min(1500, config.mockDelayMs / 4));
  onStatus({ stage: 'running', taskId });
  await sleep(config.mockDelayMs * (0.8 + Math.random() * 0.4));
  onStatus({ stage: 'downloading', taskId });
  await fs.copyFile(pickMockSample(req.prompt), req.outFile);
  return { provider: 'mock', taskId, ms: Date.now() - t0 };
}

// ---------- real Lux3D ----------
let client: Lux3dClient | null = null;
function lux3d(): Lux3dClient {
  if (!client) client = createLux3dClient({ region: 'com' }); // reads AHOLO_API_KEY
  return client;
}

function pickGlbUrl(outputs: { content?: string | null }[]): string | null {
  const urls = outputs.map((o) => o.content ?? '').filter((c) => /^https?:\/\//.test(c));
  return urls.find((u) => /\.glb(\?|$)/i.test(u)) ?? urls.find((u) => !/\.(zip|ply)(\?|$)/i.test(u)) ?? null;
}

async function realGenerate(req: GenerateRequest, onStatus: StatusCb): Promise<GenerateResult> {
  const t0 = Date.now();
  let taskId: number | null = null;
  // Create, retrying politely if another generation is still running on this account.
  for (let attempt = 0; taskId === null; attempt++) {
    try {
      taskId = await lux3d().textTo3d.create({
        prompt: req.prompt,
        style: req.style,
        version: config.lux3dVersion,
        faceCount: config.faceCount,
        outputFormat: ['glb'],
        enablePbr: true,
      });
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      if (/CONCURRENCY/i.test(msg) && attempt < 30) {
        await sleep(10_000);
        continue;
      }
      throw new Error(`Lux3D create failed: ${msg}`);
    }
  }
  onStatus({ stage: 'submitted', taskId: String(taskId) });

  // Poll ourselves (instead of tasks.waitFor) so the host can show live status.
  const deadline = Date.now() + config.generationTimeoutMs;
  for (;;) {
    if (Date.now() > deadline) throw new Error('Lux3D timed out');
    await sleep(config.pollMs);
    let r;
    try {
      r = await lux3d().tasks.retrieve(taskId);
    } catch (e) {
      continue; // transient network error; keep polling
    }
    if (r.status === 0 || r.status === 1) {
      onStatus({ stage: 'running', taskId: String(taskId) });
      continue;
    }
    if (r.status !== 3) throw new Error(`Lux3D task ${taskId} ended with status ${r.status}`);
    const url = pickGlbUrl(r.outputs ?? []);
    if (!url) throw new Error('Lux3D returned no GLB url');
    onStatus({ stage: 'downloading', taskId: String(taskId) });
    // Result URLs expire after ~2h: download immediately and serve from our own storage.
    const res = await fetch(url);
    if (!res.ok) throw new Error(`GLB download failed: HTTP ${res.status}`);
    await fs.writeFile(req.outFile, Buffer.from(await res.arrayBuffer()));
    return { provider: 'lux3d', taskId: String(taskId), ms: Date.now() - t0 };
  }
}

export const providerName = (): 'lux3d' | 'mock' => (config.mock ? 'mock' : 'lux3d');

export function generate(req: GenerateRequest, onStatus: StatusCb): Promise<GenerateResult> {
  return config.mock ? mockGenerate(req, onStatus) : realGenerate(req, onStatus);
}

// ---------- serial queue ----------
interface QItem {
  req: GenerateRequest;
  onStatus: StatusCb;
  resolve: (r: GenerateResult) => void;
  reject: (e: Error) => void;
  id: string;
}
const waiting: QItem[] = [];
let running = 0;

export function queuePosition(id: string): number {
  const i = waiting.findIndex((q) => q.id === id);
  return i < 0 ? 0 : i + 1;
}

export function enqueue(id: string, req: GenerateRequest, onStatus: StatusCb): Promise<GenerateResult> {
  return new Promise((resolve, reject) => {
    waiting.push({ id, req, onStatus, resolve, reject });
    pump();
  });
}

function pump() {
  while (running < Math.max(1, config.concurrency) && waiting.length) {
    const item = waiting.shift()!;
    running++;
    generate(item.req, item.onStatus)
      .then(item.resolve, item.reject)
      .finally(() => {
        running--;
        pump();
      });
  }
}
