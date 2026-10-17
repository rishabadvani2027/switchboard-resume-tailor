const items = ['Sign in', 'Add documents', 'Review changes', 'Export'];
export function Steps({ active }: { active: number }) {
  return <div className="steps" aria-label="Progress">{items.map((item, index) => <span key={item} className={`step ${index === active ? 'active' : index < active ? 'done' : ''}`}>{index < active ? '✓ ' : `${index + 1}. `}{item}</span>)}</div>;
}
