import { isDemoMode } from '../../lib/auth/config';

export default function SignIn({ searchParams }: { searchParams: { error?: string; next?: string } }) {
  const next = searchParams.next ?? '/intake';
  const errorMessages: Record<string, string> = {
    'auth-unavailable': 'Sign-in is unavailable until Supabase is configured.',
    'credentials-required': 'Enter both your email and password.',
    'invalid-credentials': 'Those credentials could not be verified.',
    'auth-response-invalid': 'The authentication response was invalid.',
    'oauth-code-missing': 'Google sign-in did not return an authorization code.',
    'oauth-state-missing': 'Google sign-in could not be verified. Start again.',
    'oauth-state-mismatch': 'Google sign-in could not be verified. Start again.',
    'oauth-verifier-missing': 'Google sign-in could not be verified. Start again.',
    'oauth-exchange-failed': 'Google sign-in could not be completed.',
    'oauth-exchange-invalid': 'Google sign-in returned an invalid response.',
  };
  return <main className="auth-wrap"><div className="auth-card card"><div className="eyebrow">Welcome back</div><h1>Sign in to your workspace</h1><p>{isDemoMode ? 'Use the local demo account to explore the complete flow without credentials.' : 'Use your verified account to continue.'}</p>{searchParams.error && <div className="notice error" role="alert">{errorMessages[searchParams.error] ?? 'Sign-in failed. Please try again.'}</div>}<form className="stack" action="/api/auth/signin" method="post"><input type="hidden" name="next" value={next} /><label><span className="label">Email</span><input className="input" name="email" type="email" defaultValue={isDemoMode ? 'demo@example.com' : ''} required /></label><label><span className="label">Password</span><input className="input" name="password" type="password" defaultValue={isDemoMode ? 'password' : ''} required /></label><button className="button primary" type="submit">Sign in</button></form><div className="divider">or</div><a className="button secondary" href={isDemoMode ? next : `/api/auth/google?next=${encodeURIComponent(next)}`}>Continue with Google <span>↗</span></a><p className="field-note">{isDemoMode ? 'Demo mode is active. Supabase is not contacted.' : 'Production sign-in uses Supabase Auth and fails closed if it is not configured.'}</p></div></main>;
}
