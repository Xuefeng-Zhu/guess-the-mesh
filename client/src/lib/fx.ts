import confetti from 'canvas-confetti';

export function burst(colors = ['#FF4D6D', '#FFBE0B', '#00D1FF', '#06D6A0', '#B388FF']) {
  if (new URLSearchParams(location.search).has('lowfx')) {
    confetti({ particleCount: 160, spread: 100, startVelocity: 40, origin: { y: 0.6 }, colors, ticks: 400 });
    return;
  }
  const end = Date.now() + 700;
  confetti({ particleCount: 140, spread: 90, startVelocity: 45, origin: { y: 0.65 }, colors });
  (function frame() {
    confetti({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0 }, colors });
    confetti({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

let ctx: AudioContext | null = null;
/** Tiny synth blips so we don't ship audio files. */
export function blip(kind: 'correct' | 'close' | 'tick' | 'reveal' = 'tick') {
  try {
    ctx ??= new AudioContext();
    const notes = { correct: [660, 880, 1320], close: [440, 520], tick: [880], reveal: [330, 440, 550, 660] }[kind];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = kind === 'tick' ? 'square' : 'triangle';
      o.frequency.value = f;
      const t = ctx!.currentTime + i * 0.08;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(kind === 'tick' ? 0.03 : 0.12, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(ctx!.destination);
      o.start(t);
      o.stop(t + 0.2);
    });
  } catch {
    /* audio is optional */
  }
}

export const STYLE_META: Record<string, { label: string; emoji: string }> = {
  photorealistic: { label: 'Photoreal', emoji: '📷' },
  cartoon: { label: 'Cartoon', emoji: '🎈' },
  anime: { label: 'Anime', emoji: '🌸' },
  hand_painted: { label: 'Hand-painted', emoji: '🖌️' },
  cyberpunk: { label: 'Cyberpunk', emoji: '🌆' },
  fantasy: { label: 'Fantasy', emoji: '🐉' },
  glass: { label: 'Glass', emoji: '🔮' },
};
