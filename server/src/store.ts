// Gallery + model storage on disk (DATA_DIR, default ./data).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import type { GalleryEntry } from './shared.js';

export const modelsDir = path.join(config.dataDir, 'models');
const galleryFile = path.join(config.dataDir, 'gallery.json');

fs.mkdirSync(modelsDir, { recursive: true });

let gallery: GalleryEntry[] = [];
try {
  gallery = JSON.parse(fs.readFileSync(galleryFile, 'utf8'));
} catch {
  gallery = [];
}

let saveTimer: NodeJS.Timeout | null = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFileSync(galleryFile + '.tmp', JSON.stringify(gallery, null, 2));
    fs.renameSync(galleryFile + '.tmp', galleryFile);
  }, 200);
}

export const modelPath = (id: string) => path.join(modelsDir, `${id}.glb`);
export const modelUrl = (id: string) => `/models/${id}.glb`;

export function addEntry(e: GalleryEntry) {
  gallery.unshift(e);
  save();
}

export function updateEntry(id: string, fn: (e: GalleryEntry) => void) {
  const e = gallery.find((g) => g.id === id);
  if (e) {
    fn(e);
    save();
  }
}

export function listGallery(): GalleryEntry[] {
  return gallery;
}
