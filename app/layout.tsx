import './globals.css';
import Link from 'next/link';
import { cookies } from 'next/headers';
import type { Metadata } from 'next';
import { ACCESS_COOKIE, isDemoMode, REFRESH_COOKIE } from '../lib/auth/config';
import { Analytics } from '../components/Analytics';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, siteUrl } from '../lib/site';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ['resume tailoring', 'ATS resume checker', 'ATS score', 'tailor resume to job description', 'resume keywords', 'job application', 'AI resume'],
  icons: { icon: '/favicon.svg' },
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: '/',
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    locale: 'en_IN',
  },
  twitter: { card: 'summary_large_image', title: SITE_TITLE, description: SITE_DESCRIPTION },
  // Google Search Console HTML-tag verification (Settings → Ownership verification → HTML tag).
  verification: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION.trim() }
    : undefined,
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
        <Analytics />
      </body>
    </html>
  );
}
