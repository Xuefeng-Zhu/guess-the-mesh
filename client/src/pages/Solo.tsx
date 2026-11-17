// Solo / Daily Mesh: pre-generated models, no waiting, answers checked server-side.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MeshReveal, { stageAt } from '../components/MeshReveal';
import WordHint from '../components/WordHint';
import { blip, burst, STYLE_META } from '../lib/fx';
import { useTick } from '../lib/socket';
import type { DailyPuzzle } from '../../../server/src/shared';

const ROUND_MS = 45_000;
const REVEAL_MS = 38_000;
type Result = { points: number; answer: string; solved: boolean; guesses: number };

export default function Solo() {
  const [mode, setMode] = useState<'daily' | 'endless'>('daily');
  const [puzzles, setPuzzles] = useState<DailyPuzzle[]>([]);
  const [dayNo, setDayNo] = useState<number | null>(null);
  const [idx, setIdx] = useState(0);
  const [startAt, setStartAt] = useState(Date.now());
  const [guess, setGuess] = useState('');
  const [log, setLog] = useState<{ text: string; verdict: string }[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [done, setDone] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useTick(250);

  const load = async (m: 'daily' | 'endless') => {
    const r = await fetch(m === 'daily' ? '/api/daily' : '/api/solo').then((x) => x.json());
    setPuzzles(r.puzzles);
    setDayNo(r.number ?? null);
    setIdx(0);
    setResults([]);
    setLog([]);
    setDone(null);
    setStartAt(Date.now());
  };
  useEffect(() => {
    load(mode);
  }, [mode]);

  const pz = puzzles[idx];
  const elapsed = Date.now() - startAt;
  const getProgress = useMemo(() => () => (done ? 1 : (Date.now() - startAt) / REVEAL_MS), [startAt, done]);

  const finish = (r: Result) => {
    setDone(r);
    setResults((rs) => [...rs, r]);
  };

  useEffect(() => {
    if (!pz || done || elapsed < ROUND_MS) return;
    fetch(`/api/puzzle/${pz.id}/giveup`, { method: 'POST' })
      .then((x) => x.json())
      .then((r) => finish({ points: 0, answer: r.answer, solved: false, guesses: log.length }));
  }, [elapsed > ROUND_MS]);

  const send = async () => {
    const t = guess.trim();
    if (!t || !pz || done) return;
    setGuess('');
    const r = await fetch(`/api/puzzle/${pz.id}/guess`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: t, elapsedMs: Date.now() - startAt }),
    }).then((x) => x.json());
    setLog((l) => [...l, { text: t, verdict: r.verdict }]);
    if (r.verdict === 'correct') {
      burst();
      blip('correct');
      finish({ points: r.points, answer: r.answer, solved: true, guesses: log.length + 1 });
    } else if (r.verdict === 'close') blip('close');
    inputRef.current?.focus();
  };

  const giveUp = async () => {
    if (!pz) return;
    const r = await fetch(`/api/puzzle/${pz.id}/giveup`, { method: 'POST' }).then((x) => x.json());
    finish({ points: 0, answer: r.answer, solved: false, guesses: log.length });
  };

  const next = () => {
    setIdx((i) => i + 1);
    setLog([]);
    setDone(null);
    setStartAt(Date.now());
  };

  const total = results.reduce((s, r) => s + r.points, 0);
  const finished = puzzles.length > 0 && idx >= puzzles.length - 1 && done;
  const shareText = `Guess the Mesh ${mode === 'daily' ? `Daily #${dayNo}` : 'Endless'} — ${total} pts\n${results
    .map((r) => (r.solved ? (r.points >= 350 ? '🟩' : '🟨') : '⬛'))
    .join('')}\n${location.origin}/solo`;

  return (
    <div className="solo">
      <header className="topbar">
        <Link to="/" className="logo">
          Guess<span>the</span>Mesh
        </Link>
        <div className="tabs">
          <button className={mode === 'daily' ? 'on' : ''} onClick={() => setMode('daily')}>
            Daily Mesh{dayNo ? ` #${dayNo}` : ''}
          </button>
          <button className={mode === 'endless' ? 'on' : ''} onClick={() => setMode('endless')}>
            Endless 5
          </button>
        </div>
        <div className="spacer" />
        <div className="score-badge">{total} pts</div>
      </header>
      {pz && (
        <main className="solo-main">
          <section className="stage-main">
            <MeshReveal key={pz.id + startAt} url={pz.modelUrl} getProgress={getProgress} />
            <div className="stage-hud">
              <div className="stage-label">
                {pz.number}/{puzzles.length} · {{ voxels: '🧊 Voxel sketch', clay: '🗿 Clay', color: '🎨 Painting', done: '✨ Full reveal' }[stageAt(getProgress())]}
              </div>
              <div className="chip">
                {STYLE_META[pz.style]?.emoji} {STYLE_META[pz.style]?.label}
              </div>
              {!done && <div className="timer-text">{Math.max(0, Math.ceil((ROUND_MS - elapsed) / 1000))}s</div>}
            </div>
            <div className="reveal-bar">
              <div style={{ width: `${Math.min(100, getProgress() * 100)}%` }} />
            </div>
            {!done && <WordHint hint={pz.wordHint} />}
            {done && (
              <div className="answer-card pop-in">
                <div className="kicker">{done.solved ? `Solved! +${done.points}` : 'It was'}</div>
                <div className="answer">“{done.answer}”</div>
                {finished ? (
                  <div className="row">
                    <button
                      className="primary"
                      onClick={() => {
                        navigator.clipboard?.writeText(shareText);
                        setCopied(true);
                      }}
                    >
                      {copied ? 'Copied!' : 'Share score'}
                    </button>
                    <button className="ghost" onClick={() => (mode === 'endless' ? load('endless') : setMode('endless'))}>
                      Play endless →
                    </button>
                  </div>
                ) : (
                  <button className="primary" onClick={next}>
                    Next mesh →
                  </button>
                )}
              </div>
            )}
          </section>
          <aside className="stage-side">
            <div className="card">
              <h3>What is it?</h3>
              <form
                className="guess-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <input ref={inputRef} value={guess} disabled={!!done} placeholder="Type a guess…" onChange={(e) => setGuess(e.target.value)} />
                <button className="primary" disabled={!!done}>
                  Guess
                </button>
              </form>
              <div className="my-guesses">
                {[...log].reverse().map((g, i) => (
                  <div key={i} className={`my-guess ${g.verdict}`}>
                    <span>{g.text}</span>
                    <span className="v">{g.verdict === 'correct' ? '✅' : g.verdict === 'close' ? '🔥 close' : '❄️ cold'}</span>
                  </div>
                ))}
              </div>
              {!done && (
                <button className="ghost small" onClick={giveUp}>
                  Give up
                </button>
              )}
            </div>
            <div className="card muted small">
              Faster guesses score more (100–500). Close guesses get a 🔥. Multiplayer is more fun — <Link to="/host">host a room</Link>.
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}
