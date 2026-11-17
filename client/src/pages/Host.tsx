import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import MeshReveal, { stageAt } from '../components/MeshReveal';
import Sculpting from '../components/Sculpting';
import WordHint from '../components/WordHint';
import { call, useRoomState, useTick } from '../lib/socket';
import { blip, burst, STYLE_META } from '../lib/fx';
import type { PublicPlayer, RoomState } from '../../../server/src/shared';

const STAGE_LABEL = { voxels: '🧊 Voxel sketch', clay: '🗿 Clay sculpt', color: '🎨 Painting', done: '✨ Full reveal' };

function Avatar({ p, big }: { p: PublicPlayer; big?: boolean }) {
  return (
    <span className={`avatar ${big ? 'big' : ''} ${p.connected ? '' : 'away'}`} style={{ background: p.color }}>
      {p.emoji}
    </span>
  );
}

function Scoreboard({ st }: { st: RoomState }) {
  const sorted = [...st.players].sort((a, b) => b.score - a.score);
  return (
    <div className="scoreboard card">
      <h3>Scores</h3>
      {sorted.map((p) => (
        <div key={p.id} className={`score-row ${p.guessedThisRound ? 'got' : ''}`}>
          <Avatar p={p} />
          <span className="name">
            {p.name}
            {p.id === st.prompterId && <span className="tag">prompter</span>}
          </span>
          {p.guessedThisRound && <span className="check">✓</span>}
          <span className="pts">{p.score}</span>
        </div>
      ))}
    </div>
  );
}

function Countdown({ endsAt, now, total }: { endsAt: number | null; now: () => number; total?: number }) {
  if (!endsAt) return null;
  const left = Math.max(0, endsAt - now());
  const secs = Math.ceil(left / 1000);
  const frac = total ? left / total : 1;
  return (
    <div className={`countdown ${secs <= 10 ? 'urgent' : ''}`}>
      <svg viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="19" className="track" />
        <circle cx="22" cy="22" r="19" className="fill" style={{ strokeDashoffset: `${119.4 * (1 - frac)}` }} />
      </svg>
      <span>{secs}</span>
    </div>
  );
}

export default function Host() {
  const { state: st, now } = useRoomState();
  const [err, setErr] = useState('');
  const [rpp, setRpp] = useState(1);
  useTick(250);

  useEffect(() => {
    (async () => {
      const saved = JSON.parse(sessionStorage.getItem('gtm-host') ?? 'null');
      if (saved) {
        const r = await call('host:attach', saved);
        if (r.ok) return;
      }
      const r = await call('host:create');
      if (r.ok) sessionStorage.setItem('gtm-host', JSON.stringify({ code: r.code, hostKey: r.hostKey }));
    })();
  }, []);

  // confetti + sound on new correct guesses
  const seen = useRef(new Set<string>());
  useEffect(() => {
    if (!st) return;
    for (const f of st.feed) {
      if (seen.current.has(f.id)) continue;
      seen.current.add(f.id);
      if (f.verdict === 'correct') {
        burst();
        blip('correct');
      }
    }
  }, [st?.feed]);
  useEffect(() => {
    if (st?.phase === 'revealing') blip('reveal');
    if (st?.phase === 'roundEnd' && st.lastRound?.correct.length) burst();
  }, [st?.phase]);

  const joinUrl = st ? `${location.origin}/play?code=${st.code}` : '';
  const prompter = st?.players.find((p) => p.id === st.prompterId);
  const nextPrompter = st?.players.find((p) => p.id === st.nextPrompterId);

  const getProgress = useMemo(() => {
    return () => {
      if (!st) return 0;
      if (st.phase === 'roundEnd' || st.phase === 'gameOver') return 1;
      if (!st.revealStart) return 0;
      return (now() - st.revealStart) / st.revealMs;
    };
  }, [st?.revealStart, st?.phase, st?.revealMs]);

  if (!st) return <div className="host center-screen"><div className="loader">Opening a room…</div></div>;

  const start = async () => {
    setErr('');
    const r = await call('host:start', { roundsPerPlayer: rpp });
    if (!r.ok) setErr(r.error);
  };

  const progress = getProgress();
  const stage = stageAt(progress);
  const nextQueued = st.nextJob && (
    <div className="next-queue">
      ⏭️ Next up: <b>{nextPrompter?.name}</b>'s prompt is{' '}
      {st.nextJob.status === 'ready' ? 'ready to reveal' : st.nextJob.status === 'queued' ? 'queued' : 'sculpting'}
    </div>
  );

  return (
    <div className={`host phase-${st.phase}`}>
      <header className="topbar">
        <Link to="/" className="logo">
          Guess<span>the</span>Mesh
        </Link>
        {st.phase !== 'lobby' && (
          <div className="room-pill">
            Room <b>{st.code}</b>
          </div>
        )}
        {st.phase !== 'lobby' && st.phase !== 'gameOver' && (
          <div className="round-pill">
            Round {st.round + 1}/{st.totalRounds}
          </div>
        )}
        <div className="spacer" />
        <div className={`provider ${st.provider}`}>{st.provider === 'mock' ? 'Mock models' : 'Powered by Lux3D'}</div>
        {['prompting', 'revealing', 'roundEnd'].includes(st.phase) && (
          <button className="ghost small" onClick={() => call('host:skip')}>
            Skip ⏭
          </button>
        )}
      </header>

      {st.phase === 'lobby' && (
        <main className="lobby">
          <section className="join-card card">
            <div className="kicker">Join on your phone</div>
            <div className="join-url">{location.host}/play</div>
            <div className="code">{st.code.split('').map((c, i) => <span key={i}>{c}</span>)}</div>
            <img className="qr" src={`/api/qr?text=${encodeURIComponent(joinUrl)}`} alt="QR code to join" />
          </section>
          <section className="lobby-side">
            <h1 className="title">
              3D Pictionary,
              <br />
              <span className="hl">sculpted by AI.</span>
            </h1>
            <ol className="how">
              <li>One player whispers a secret prompt to <b>Lux3D</b>.</li>
              <li>The model appears as voxels → clay → full colour.</li>
              <li>Guess on your phone. Faster = more points.</li>
            </ol>
            <div className="players-grid">
              {st.players.map((p) => (
                <div key={p.id} className="player-chip pop-in">
                  <Avatar p={p} big />
                  <span>{p.name}</span>
                </div>
              ))}
              {st.players.length === 0 && <div className="muted">Waiting for players…</div>}
            </div>
            <div className="start-row">
              <label className="rpp">
                Rounds each
                {[1, 2].map((n) => (
                  <button key={n} className={`seg ${rpp === n ? 'on' : ''}`} onClick={() => setRpp(n)}>
                    {n}
                  </button>
                ))}
              </label>
              <button className="primary huge" disabled={st.players.filter((p) => p.connected).length < 2} onClick={start}>
                Start game ▶
              </button>
            </div>
            {err && <div className="error">{err}</div>}
            <div className="muted small">Need 2+ players. No phone handy? Try <Link to="/solo">Daily Mesh</Link>.</div>
          </section>
        </main>
      )}

      {st.phase === 'prompting' && (
        <main className="center-screen prompting">
          {prompter && <Avatar p={prompter} big />}
          <h2>
            <span className="hl">{prompter?.name}</span> is writing a secret prompt…
          </h2>
          <p className="muted">Everyone else: get ready to guess. No peeking at their phone!</p>
          <Countdown endsAt={st.phaseEndsAt} now={now} total={90_000} />
          {nextQueued}
        </main>
      )}

      {st.phase === 'generating' && (
        <main className="center-screen">
          <Sculpting job={st.job} prompterName={prompter?.name} now={now} />
          {nextQueued}
        </main>
      )}

      {(st.phase === 'revealing' || st.phase === 'roundEnd') && st.modelUrl && (
        <main className="stage">
          <section className="stage-main">
            <MeshReveal url={st.modelUrl} getProgress={getProgress} />
            <div className="stage-hud">
              <div className="stage-label">{STAGE_LABEL[stage]}</div>
              {st.job && (
                <div className="chip">
                  {STYLE_META[st.job.style]?.emoji} {STYLE_META[st.job.style]?.label}
                </div>
              )}
              {st.phase === 'revealing' && <Countdown endsAt={st.roundEndsAt} now={now} total={st.roundMs} />}
            </div>
            <div className="reveal-bar">
              <div style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
            {st.phase === 'revealing' && st.wordHint && <WordHint hint={st.wordHint} />}
            {st.phase === 'roundEnd' && st.lastRound && (
              <div className="answer-card pop-in">
                <div className="kicker">{prompter?.name}'s prompt was</div>
                <div className="answer">“{st.lastRound.prompt}”</div>
                <div className="muted">
                  {st.lastRound.correct.length
                    ? `${st.lastRound.correct.length} got it · ${prompter?.name} +${st.lastRound.prompterPoints}`
                    : 'Nobody got it! The AI wins this round.'}
                </div>
                {st.lastRound.funniestMiss && <div className="miss">Best wrong guess: “{st.lastRound.funniestMiss}”</div>}
              </div>
            )}
          </section>
          <aside className="stage-side">
            <div className="feed card">
              <h3>Guesses</h3>
              <div className="feed-list">
                {[...st.feed].reverse().map((f) => (
                  <div key={f.id} className={`feed-item ${f.verdict} pop-in`}>
                    <span className="dot" style={{ background: f.color }} />
                    <b>{f.name}</b>
                    {f.verdict === 'correct' ? (
                      <span className="got">got it! +{f.points}</span>
                    ) : (
                      <span className="txt">
                        {f.text} {f.verdict === 'close' && <em>close!</em>}
                      </span>
                    )}
                  </div>
                ))}
                {st.feed.length === 0 && <div className="muted">Type guesses on your phone…</div>}
              </div>
            </div>
            <Scoreboard st={st} />
            {nextQueued}
          </aside>
        </main>
      )}

      {st.phase === 'gameOver' && (
        <main className="center-screen game-over">
          <h1 className="title">🏆 Final scores</h1>
          <div className="podium">
            {[...st.players]
              .sort((a, b) => b.score - a.score)
              .slice(0, 3)
              .map((p, i) => (
                <div key={p.id} className={`step step-${i + 1}`}>
                  <Avatar p={p} big />
                  <div className="name">{p.name}</div>
                  <div className="pts">{p.score}</div>
                  <div className="block">{i + 1}</div>
                </div>
              ))}
          </div>
          <div className="row">
            <button className="primary" onClick={() => call('host:lobby')}>
              Play again
            </button>
            <Link className="button ghost" to="/gallery">
              See the gallery →
            </Link>
          </div>
        </main>
      )}
    </div>
  );
}
