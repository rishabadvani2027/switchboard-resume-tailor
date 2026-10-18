import './globals.css';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, isDemoMode, REFRESH_COOKIE } from '../lib/auth/config';

export const metadata = {
  title: 'Switchboard — truthful resume tailoring',
  description: 'Tailor your resume to any job description and review every change like a pull request.',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = cookies();
  const signedIn = isDemoMode || Boolean(jar.get(ACCESS_COOKIE)?.value || jar.get(REFRESH_COOKIE)?.value);
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <nav className="nav">
            <Link className="brand" href="/"><span className="brand-mark">S</span> switchboard</Link>
            <div className="nav-links">
              <Link href="/intake">Workspace</Link>
              <Link href="/settings">AI settings</Link>
              <Link href="/billing">Plans</Link>
              {signedIn
                ? (isDemoMode
                  ? <span className="status-pill pending">Demo mode</span>
                  : <form action="/api/auth/signout" method="post"><button className="button secondary small" type="submit">Sign out</button></form>)
                : <Link className="button secondary small" href="/signin">Sign in</Link>}
            </div>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
