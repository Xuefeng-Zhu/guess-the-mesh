import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import MeshReveal from '../components/MeshReveal';
import { STYLE_META } from '../lib/fx';
import type { GalleryEntry } from '../../../server/src/shared';

const one = () => 1;

export default function Gallery() {
  const [items, setItems] = useState<GalleryEntry[] | null>(null);
  const [sel, setSel] = useState<GalleryEntry | null>(null);
  useEffect(() => {
    fetch('/api/gallery')
      .then((r) => r.json())
      .then((r) => {
        setItems(r.items);
        setSel(r.items[0] ?? null);
      });
  }, []);

  return (
    <div className="gallery">
      <header className="topbar">
        <Link to="/" className="logo">
          Guess<span>the</span>Mesh
        </Link>
        <div className="kicker">Gallery · every mesh Lux3D sculpted, and what people thought it was</div>
      </header>
      {items && items.length === 0 && (
        <div className="center-screen">
          <h2>No meshes yet</h2>
          <p className="muted">
            <Link to="/host">Host a game</Link> and they'll show up here.
          </p>
        </div>
      )}
      {sel && (
        <section className="gallery-feature">
          <MeshReveal key={sel.id} url={sel.modelUrl} getProgress={one} orbit className="reveal-canvas feature" />
          <div className="feature-copy card">
            <div className="kicker">
              {STYLE_META[sel.style]?.emoji} {STYLE_META[sel.style]?.label} · by {sel.prompter}
            </div>
            <h2>“{sel.prompt}”</h2>
            {sel.wrongGuesses.length > 0 && (
              <>
                <div className="muted small">What people guessed instead</div>
                <div className="wrong-cloud">
                  {sel.wrongGuesses.slice(0, 24).map((g) => (
                    <span key={g} className="wrong">
                      {g}
                    </span>
                  ))}
                </div>
              </>
            )}
            <div className="muted small">
              {sel.solvedBy.length ? `Solved by ${sel.solvedBy.join(', ')}` : 'Nobody solved it'} · {sel.provider === 'lux3d' ? `Lux3D task ${sel.taskId}` : 'mock sample'} ·{' '}
              {Math.round(sel.generationMs / 1000)}s to sculpt
            </div>
            <a className="button primary" href={`${sel.modelUrl}?download=1`}>
              ⬇ Download GLB
            </a>
          </div>
        </section>
      )}
      <section className="gallery-grid">
        {items?.map((g) => (
          <button key={g.id} className={`gallery-card ${sel?.id === g.id ? 'on' : ''}`} onClick={() => setSel(g)}>
            <span className="g-emoji">{STYLE_META[g.style]?.emoji}</span>
            <span className="g-prompt">“{g.prompt}”</span>
            <span className="g-meta">
              {g.prompter} · {g.wrongGuesses.length} wrong guesses
            </span>
            {g.wrongGuesses[0] && <span className="g-wrong">e.g. “{g.wrongGuesses[0]}”</span>}
          </button>
        ))}
      </section>
    </div>
  );
}
