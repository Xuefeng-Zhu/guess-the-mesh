// Phone controller.
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { call, getSocket, useRoomState } from '../lib/socket';
import { STYLE_META } from '../lib/fx';
import { STYLES, type Style } from '../../../server/src/shared';

function PromptComposer({ early, error }: { early?: boolean; error?: string }) {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState<Style>('cartoon');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true);
    setErr('');
    const r = await call('player:prompt', { prompt, style });
    setBusy(false);
    if (!r.ok) setErr(r.error);
  };
  const inspire = async () => setPrompt((await call<{ prompt: string }>('inspire')).prompt);
  return (
    <div className="composer card">
      <div className="kicker">{early ? "You're up next — queue it now" : "You're the prompter!"}</div>
      <h2>{early ? 'Start sculpting your prompt while they guess' : 'Describe something for Lux3D to sculpt'}</h2>
      <textarea
        value={prompt}
        maxLength={120}
        placeholder="a sleepy corgi wearing a crown"
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
      />
      <div className="styles">
        {STYLES.map((s) => (
          <button key={s} className={`style-chip ${style === s ? 'on' : ''}`} onClick={() => setStyle(s)}>
            {STYLE_META[s].emoji} {STYLE_META[s].label}
          </button>
        ))}
      </div>
      <div className="row">
        <button className="ghost" onClick={inspire}>
          🎲 Inspire me
        </button>
        <button className="primary grow" disabled={busy || prompt.trim().length < 3} onClick={submit}>
          {busy ? 'Sending…' : 'Sculpt it ✨'}
        </button>
      </div>
      <p className="muted small">Tip: one clear thing + one funny detail guesses best. Keep it secret!</p>
      {(err || error) && <div className="error">{err || error}</div>}
    </div>
  );
}

export default function Play() {
  const [params] = useSearchParams();
  const { state: st, me, connected } = useRoomState();
  const [code, setCode] = useState((params.get('code') ?? '').toUpperCase());
  const [name, setName] = useState(localStorage.getItem('gtm-name') ?? '');
  const [joined, setJoined] = useState(false);
  const [err, setErr] = useState('');
  const [guess, setGuess] = useState('');
  const [flash, setFlash] = useState<'' | 'correct' | 'close' | 'miss'>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const join = async (c = code, pid?: string) => {
    setErr('');
    const r = await call('player:join', { code: c, name, playerId: pid });
    if (r.ok) {
      localStorage.setItem('gtm-name', name);
      localStorage.setItem(`gtm-player-${r.code}`, r.playerId);
      setJoined(true);
    } else setErr(r.error);
    return r.ok;
  };

  // auto-rejoin after refresh / reconnect
  useEffect(() => {
    const c = (params.get('code') ?? '').toUpperCase();
    const pid = c && localStorage.getItem(`gtm-player-${c}`);
    if (c && pid) join(c, pid);
    const s = getSocket();
    const onRe = () => {
      const cc = sessionStorage.getItem('gtm-code');
      const p = cc && localStorage.getItem(`gtm-player-${cc}`);
      if (cc && p) call('player:join', { code: cc, playerId: p });
    };
    s.on('connect', onRe);
    return () => {
      s.off('connect', onRe);
    };
  }, []);
  useEffect(() => {
    if (joined && st) sessionStorage.setItem('gtm-code', st.code);
  }, [joined, st?.code]);

  const sendGuess = async () => {
    const t = guess.trim();
    if (!t) return;
    setGuess('');
    const r = await call('player:guess', { text: t });
    if (r.ok) {
      setFlash(r.verdict);
      if (r.verdict === 'correct') navigator.vibrate?.([60, 40, 120]);
      setTimeout(() => setFlash(''), 900);
    }
    inputRef.current?.focus();
  };

  if (!joined || !st || !me) {
    return (
      <div className="phone">
        <div className="phone-brand">
          Guess<span>the</span>Mesh
        </div>
        <div className="card join-form">
          <label>Room code</label>
          <input
            className="code-input"
            value={code}
            maxLength={4}
            autoCapitalize="characters"
            placeholder="ABCD"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          />
          <label>Your name</label>
          <input value={name} maxLength={16} placeholder="Frank" onChange={(e) => setName(e.target.value)} />
          <button className="primary huge" disabled={code.length !== 4 || !name.trim()} onClick={() => join()}>
            Join ▶
          </button>
          {err && <div className="error">{err}</div>}
        </div>
      </div>
    );
  }

  const self = st.players.find((p) => p.id === me.playerId)!;
  const prompter = st.players.find((p) => p.id === st.prompterId);
  const myCorrect = me.myGuesses.find((g) => g.verdict === 'correct');
  const rank = [...st.players].sort((a, b) => b.score - a.score).findIndex((p) => p.id === me.playerId) + 1;

  return (
    <div className={`phone flash-${flash}`}>
      <header className="phone-top" style={{ borderColor: self?.color }}>
        <span className="avatar" style={{ background: self?.color }}>
          {self?.emoji}
        </span>
        <b>{self?.name}</b>
        <span className="spacer" />
        {!connected && <span className="chip warn">reconnecting…</span>}
        <span className="score-badge">{self?.score ?? 0} pts</span>
      </header>

      {st.phase === 'lobby' && (
        <div className="phone-msg">
          <div className="big-emoji">🎉</div>
          <h2>You're in!</h2>
          <p className="muted">Room {st.code}. Watch the big screen — the host starts when everyone's here.</p>
        </div>
      )}

      {me.mustPrompt && <PromptComposer error={me.promptError} />}

      {st.phase === 'prompting' && !me.isPrompter && (
        <div className="phone-msg">
          <div className="big-emoji">🤫</div>
          <h2>{prompter?.name} is thinking up a prompt…</h2>
        </div>
      )}

      {st.phase === 'generating' && (
        <div className="phone-msg">
          <div className="big-emoji spin">🧊</div>
          <h2>{me.isPrompter ? 'Lux3D is sculpting your prompt' : 'Lux3D is sculpting…'}</h2>
          {me.isPrompter && me.myQueuedPrompt && <p className="secret">“{me.myQueuedPrompt.prompt}”</p>}
          <p className="muted">Get your guessing thumbs ready.</p>
        </div>
      )}

      {st.phase === 'revealing' && me.isPrompter && (
        <div className="phone-msg">
          <div className="big-emoji">🎬</div>
          <h2>Your model is on screen!</h2>
          <p className="muted">You score when people guess it. {st.players.filter((p) => p.guessedThisRound).length} so far.</p>
        </div>
      )}

      {st.phase === 'revealing' && !me.isPrompter && (
        <div className="guess-panel">
          {st.wordHint && <div className="word-hint small">{st.wordHint}</div>}
          {myCorrect ? (
            <div className="phone-msg">
              <div className="big-emoji">✅</div>
              <h2>Nailed it! +{myCorrect.points}</h2>
              <p className="muted">Enjoy watching everyone else squirm.</p>
            </div>
          ) : (
            <form
              className="guess-form"
              onSubmit={(e) => {
                e.preventDefault();
                sendGuess();
              }}
            >
              <input
                ref={inputRef}
                value={guess}
                autoFocus
                maxLength={80}
                enterKeyHint="send"
                placeholder="What is it?"
                onChange={(e) => setGuess(e.target.value)}
              />
              <button className="primary" type="submit">
                Guess
              </button>
            </form>
          )}
          <div className="my-guesses">
            {[...me.myGuesses].reverse().map((g, i) => (
              <div key={i} className={`my-guess ${g.verdict}`}>
                <span>{g.text}</span>
                <span className="v">{g.verdict === 'correct' ? `✅ +${g.points}` : g.verdict === 'close' ? '🔥 close' : '❄️ cold'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {st.phase === 'roundEnd' && st.lastRound && (
        <div className="phone-msg">
          <div className="big-emoji">{myCorrect ? '🥳' : me.isPrompter ? '🎨' : '😅'}</div>
          <p className="muted">It was</p>
          <h2>“{st.lastRound.prompt}”</h2>
          {myCorrect && <p className="good">+{myCorrect.points} points</p>}
          {me.isPrompter && <p className="good">+{st.lastRound.prompterPoints} prompter points</p>}
        </div>
      )}

      {st.phase === 'gameOver' && (
        <div className="phone-msg">
          <div className="big-emoji">{rank === 1 ? '🏆' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🎈'}</div>
          <h2>You finished #{rank}</h2>
          <p className="muted">{self?.score} points. Check the big screen!</p>
          <a className="button ghost" href="/gallery">
            Browse the gallery
          </a>
        </div>
      )}

      {me.canQueue && !me.mustPrompt && <PromptComposer early error={me.promptError} />}
      {me.isNextPrompter && me.myQueuedPrompt && !me.isPrompter && (
        <div className="queued card">
          <div className="kicker">Your next prompt</div>
          <div className="secret">“{me.myQueuedPrompt.prompt}”</div>
          <div className="muted small">
            {me.myQueuedPrompt.status === 'ready' ? '✅ Sculpted and ready to reveal' : me.myQueuedPrompt.status === 'queued' ? '⏳ Queued for Lux3D' : '🧊 Lux3D is sculpting it now'}
          </div>
        </div>
      )}
    </div>
  );
}
