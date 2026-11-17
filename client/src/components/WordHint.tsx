// Shows the prompt's shape: one tile per letter, grouped by word (wraps per word).
export default function WordHint({ hint, className }: { hint: string; className?: string }) {
  const words = hint.split(/\s{2,}|\s/).filter(Boolean);
  return (
    <div className={`word-hint ${className ?? ''}`} aria-label={`${words.length} words`}>
      {words.map((w, i) => (
        <span key={i} className="hint-word">
          {w.split('').map((c, j) => (
            <span key={j} className={c === '_' ? 'hint-l' : 'hint-p'}>
              {c === '_' ? '' : c}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}
