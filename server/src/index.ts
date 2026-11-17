import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import { config } from './config.js';
import { answerOf, guessPuzzle, puzzleFile, soloPuzzles, todaysPuzzles, SOLO_ROUND_MS } from './daily.js';
import { providerName } from './lux3d.js';
import { attachRooms, roomCount } from './rooms.js';
import { listGallery, modelsDir } from './store.js';
import { STYLES } from './shared.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

const startedAt = Date.now();
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    provider: providerName(),
    lux3dVersion: config.lux3dVersion,
    llmJudge: Boolean(config.openrouterKey),
    rooms: roomCount(),
    galleryCount: listGallery().length,
    uptimeS: Math.round((Date.now() - startedAt) / 1000),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({ provider: providerName(), styles: STYLES, revealMs: config.revealMs, roundMs: config.roundMs, soloRoundMs: SOLO_ROUND_MS });
});

app.get('/api/gallery', (_req, res) => res.json({ items: listGallery().slice(0, 200) }));

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text ?? '').slice(0, 300);
  if (!text) return res.status(400).end();
  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#14112b', light: '#ffffff' } });
  res.type('image/svg+xml').send(svg);
});

// Solo / Daily Mesh
app.get('/api/daily', (_req, res) => res.json(todaysPuzzles()));
app.get('/api/solo', (_req, res) => res.json({ puzzles: soloPuzzles(5) }));
app.get('/api/puzzle/:id/model.glb', (req, res) => {
  const f = puzzleFile(req.params.id);
  if (!f) return res.status(404).end();
  res.type('model/gltf-binary').sendFile(f);
});
app.post('/api/puzzle/:id/guess', async (req, res) => {
  const r = await guessPuzzle(req.params.id, String(req.body?.text ?? '').slice(0, 80), Number(req.body?.elapsedMs) || 0);
  if (!r) return res.status(404).json({ error: 'unknown puzzle' });
  res.json(r);
});
app.post('/api/puzzle/:id/giveup', (req, res) => {
  const a = answerOf(req.params.id);
  if (!a) return res.status(404).json({ error: 'unknown puzzle' });
  res.json({ answer: a });
});

// Generated models: /models/<id>.glb  (?download=1 for attachment)
app.get('/models/:file', (req, res) => {
  const file = path.basename(req.params.file);
  if (!/^[\w-]+\.glb$/.test(file)) return res.status(400).end();
  const full = path.join(modelsDir, file);
  if (!fs.existsSync(full)) return res.status(404).end();
  if (req.query.download) {
    const entry = listGallery().find((g) => `${g.id}.glb` === file);
    const nice = (entry?.prompt ?? 'mesh').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
    res.attachment(`guess-the-mesh-${nice || 'model'}.glb`);
  }
  res.type('model/gltf-binary').sendFile(full, { maxAge: '7d' });
});

// Client (built by Vite)
if (fs.existsSync(config.clientDir)) {
  app.use(express.static(config.clientDir, { maxAge: '1h', index: false }));
  app.get(/^\/(?!api|models|socket\.io).*/, (_req, res) => res.sendFile(path.join(config.clientDir, 'index.html')));
}

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, pingInterval: 10_000, pingTimeout: 20_000 });
attachRooms(io);

server.listen(config.port, () => {
  console.log(`Guess the Mesh on :${config.port} — provider=${providerName()} (${config.mock ? 'mock samples' : 'Lux3D ' + config.lux3dVersion})`);
});
