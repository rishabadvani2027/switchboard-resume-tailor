import './globals.css';
import Link from 'next/link';

export const metadata = {
  title: 'Switchboard — truthful resume tailoring',
  description: 'A calm, review-first resume tailoring workspace.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <nav className="nav">
            <Link className="brand" href="/"><span className="brand-mark">S</span> switchboard</Link>
            <div className="nav-links"><Link href="/intake">Workspace</Link><Link href="/billing">Plans</Link><Link className="button secondary" href="/signin">Sign in</Link></div>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
