'use client';
export default function Error({ reset }: { reset: () => void }) { return <main className="main"><div className="container"><div className="card"><div className="eyebrow">Something went wrong</div><h1>We kept your documents safe.</h1><p>Try the last action again, or return to the workspace.</p><button className="button primary" onClick={reset}>Try again</button></div></div></main>; }
