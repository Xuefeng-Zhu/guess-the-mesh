// Pre-generate Solo / Daily Mesh puzzles with real Lux3D text-to-3D.
// Usage: AHOLO_API_KEY=... npm run pregenerate            (generates all prompts below)
//        AHOLO_API_KEY=... npm run pregenerate -- 3       (only the first 3)
// Writes GLBs to assets/daily/<id>.glb and rewrites assets/daily/manifest.json.
// Runs one task at a time (Lux3D allows one in-flight generation per account).
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/src/config.js';
import { generate } from '../server/src/lux3d.js';
import type { Style } from '../server/src/shared.js';

const PUZZLES: { id: string; prompt: string; aliases: string[]; style: Style }[] = [
  { id: 'corgi-crown', prompt: 'a sleepy corgi wearing a crown', aliases: ['corgi with a crown', 'king corgi', 'dog wearing a crown'], style: 'cartoon' },
  { id: 'cactus-guitar', prompt: 'a cactus playing the guitar', aliases: ['cactus with a guitar', 'guitar cactus'], style: 'cartoon' },
  { id: 'teacup-dragon', prompt: 'a tiny dragon in a teacup', aliases: ['dragon in a cup', 'teacup dragon'], style: 'fantasy' },
  { id: 'penguin-skate', prompt: 'a penguin on a skateboard', aliases: ['skateboarding penguin', 'penguin skateboard'], style: 'cartoon' },
  { id: 'mushroom-house', prompt: 'a mushroom house with a chimney', aliases: ['mushroom house', 'mushroom cottage'], style: 'hand_painted' },
  { id: 'robot-flower', prompt: 'a robot watering a flower', aliases: ['robot with a flower', 'gardening robot'], style: 'cyberpunk' },
  { id: 'snail-castle', prompt: 'a snail with a castle shell', aliases: ['castle snail', 'snail castle'], style: 'fantasy' },
  { id: 'glass-whale', prompt: 'a glass whale', aliases: ['crystal whale', 'whale'], style: 'glass' },
  { id: 'frog-knight', prompt: 'a frog knight with a sword', aliases: ['frog with a sword', 'knight frog'], style: 'anime' },
  { id: 'burger-wings', prompt: 'a cheeseburger with wings', aliases: ['flying burger', 'burger with wings'], style: 'cartoon' },
  { id: 'toaster-rocket', prompt: 'a toaster rocket ship', aliases: ['rocket toaster', 'toaster spaceship'], style: 'cyberpunk' },
  { id: 'lighthouse-candy', prompt: 'a lighthouse made of candy', aliases: ['candy lighthouse'], style: 'hand_painted' },
];

async function main() {
  if (config.mock) throw new Error('Set AHOLO_API_KEY (and unset LUX3D_MOCK) to pre-generate with Lux3D.');
  const limit = Number(process.argv[2]) || PUZZLES.length;
  const dir = path.join(config.assetsDir, 'daily');
  const manifestFile = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const existing = new Map<string, any>(manifest.puzzles.map((p: any) => [p.id, p]));

  for (const p of PUZZLES.slice(0, limit)) {
    const out = path.join(dir, `${p.id}.glb`);
    if (fs.existsSync(out)) {
      console.log('skip (exists)', p.id);
    } else {
      console.log(`→ ${p.prompt} [${p.style}]`);
      const r = await generate({ prompt: p.prompt, style: p.style, outFile: out }, (s) => console.log('   ', s.stage, s.taskId ?? ''));
      console.log(`   done in ${Math.round(r.ms / 1000)}s, task ${r.taskId}, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
    }
    existing.set(p.id, { ...p, file: `daily/${p.id}.glb`, lux3dGenerated: true });
    // Lux3D puzzles go first; the CC0 samples stay as a fallback at the end.
    const lux = [...existing.values()].filter((x) => x.lux3dGenerated);
    const rest = [...existing.values()].filter((x) => !x.lux3dGenerated);
    manifest.puzzles = [...lux, ...rest];
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log('manifest updated:', manifestFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
