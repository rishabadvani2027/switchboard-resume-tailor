import Link from 'next/link';

export default function Home() {
  return <main className="main"><div className="container">
    <section className="hero">
      <div><div className="eyebrow">Resume tailoring, with receipts</div><h1>Make your resume fit the role — without losing your voice.</h1><p>Switchboard highlights exactly what changes for a target job. You decide every addition and removal before anything is exported.</p><div className="hero-actions"><Link className="button primary" href="/intake">Tailor a resume <span>→</span></Link><Link className="button secondary" href="/signin">I already have an account</Link></div></div>
      <div className="hero-card"><div className="mock-window"><div className="mock-top"><span className="dot"/><span className="dot"/><span className="dot"/></div><div className="diff-line neutral">Experience · Product designer</div><div className="diff-line remove">− Worked across product initiatives</div><div className="diff-line add">+ Led discovery and shipped 3 workflow improvements</div><div className="diff-line neutral">Skills · Figma · Research · Prototyping</div><div className="diff-line add">+ Added: stakeholder alignment</div></div><p className="field-note">Every suggestion is visible, explainable, and optional.</p></div>
    </section>
    <section className="grid-2"><div className="card"><div className="eyebrow">01 · Inspectable</div><h3>See the delta, not a mystery rewrite.</h3><p>Changes are grouped by section with stable IDs, rationale, and clear additions/removals.</p></div><div className="card"><div className="eyebrow">02 · In control</div><h3>Approve the final document yourself.</h3><p>Export stays locked until every proposed change has an explicit decision.</p></div></section>
  </div></main>;
}
