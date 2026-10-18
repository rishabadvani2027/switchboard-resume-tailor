import { isDemoMode } from '../../lib/auth/config';
import { safeRedirectPath } from '../../lib/security/redirect';

export const dynamic = 'force-dynamic';

const errorMessages: Record<string, string> = {
  'auth-unavailable': 'Sign-in is unavailable: the server is missing its Supabase configuration.',
  'credentials-required': 'Enter both your email and password.',
  'invalid-credentials': 'That email and password combination is not correct.',
  'rate-limited': 'Too many attempts. Wait a minute and try again.',
  'auth-response-invalid': 'The authentication response was invalid. Please try again.',
  'oauth-denied': 'Google sign-in was cancelled.',
  'oauth-code-missing': 'Google sign-in did not return an authorization code.',
  'oauth-state-missing': 'Google sign-in could not be verified. Please start again.',
  'oauth-state-mismatch': 'Google sign-in could not be verified. Please start again.',
  'oauth-verifier-missing': 'Google sign-in expired. Please start again.',
  'oauth-exchange-failed': 'Google sign-in could not be completed. Please try again.',
  'oauth-exchange-invalid': 'Google sign-in returned an invalid response.',
  'verify-email': 'Verify your email address first — check your inbox for the confirmation link.',
  'session-expired': 'Your session expired. Please sign in again.',
};

export default function SignIn({ searchParams }: { searchParams: { error?: string; message?: string; next?: string } }) {
  const next = safeRedirectPath(searchParams.next);
  const message = searchParams.message === 'verification-sent'
    ? 'Check your email for a verification link, then return here to sign in.'
    : searchParams.message === 'email-verified'
      ? 'Your email is verified. You can sign in now.'
      : searchParams.message === 'signed-out' ? 'You have been signed out.' : null;
  return (
    <main className="auth-wrap">
      <div className="auth-card card">
        <div className="eyebrow">Welcome back</div>
        <h1>Sign in to your workspace</h1>
        <p>{isDemoMode ? 'Demo mode: any credentials work and nothing leaves this computer.' : 'Use your verified account to continue.'}</p>
        {searchParams.error && <div className="notice error" role="alert">{errorMessages[searchParams.error] ?? 'Sign-in failed. Please try again.'}</div>}
        {message && <div className="notice success" role="status">{message}</div>}
        <form className="stack" action="/api/auth/signin" method="post">
          <input type="hidden" name="next" value={next} />
          <label><span className="label">Email</span><input className="input" name="email" type="email" autoComplete="email" defaultValue={isDemoMode ? 'demo@example.com' : ''} required /></label>
          <label><span className="label">Password</span><input className="input" name="password" type="password" autoComplete="current-password" defaultValue={isDemoMode ? 'password' : ''} required /></label>
          <button className="button primary" type="submit">Sign in</button>
        </form>
        <div className="divider">or</div>
        <a className="button secondary" href={isDemoMode ? next : `/api/auth/google?next=${encodeURIComponent(next)}`}>Continue with Google <span>↗</span></a>
        <p className="auth-switch">New here? <a href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</a></p>
      </div>
    </main>
  );
}
