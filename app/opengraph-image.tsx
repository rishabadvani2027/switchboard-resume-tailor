import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Switchboard — tailor your resume to every job';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Link-preview card shown when the site is shared on WhatsApp, LinkedIn, X, etc. */
export default function OpengraphImage() {
  const line = (sign: string, text: string, color: string, background: string) => (
    <div style={{ display: 'flex', gap: 18, padding: '14px 22px', borderRadius: 12, background, color, fontSize: 30 }}>
      <span style={{ fontWeight: 700 }}>{sign}</span><span>{text}</span>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: 64, background: '#f7f8fb', color: '#172033', fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: '#315cf6', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 700 }}>S</div>
          <div style={{ fontSize: 36, fontWeight: 700 }}>switchboard</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>Tailor your resume to every job.</div>
          <div style={{ fontSize: 30, color: '#667085' }}>Approve each change · See your ATS score climb · Keep your original format</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {line('−', 'Worked on database performance.', '#b42318', '#fff0ef')}
          {line('+', 'Improved PostgreSQL database performance for the orders service.', '#087f5b', '#e9f8f1')}
        </div>
      </div>
    ),
    size,
  );
}
