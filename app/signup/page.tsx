import { isDemoMode } from '../../lib/auth/config';
import { safeRedirectPath } from '../../lib/security/redirect';

export const dynamic = 'force-dynamic';

const errors: Record<string, string> = {
  'auth-unavailable': 'Sign-up is unavailable: the server is missing its Supabase configuration.',
  'credentials-required': 'Enter a valid email and a password of at least six characters.',
  'password-mismatch': 'Passwords do not match.',
  'email-in-use': 'An account already exists for this email. Try signing in.',
  'rate-limited': 'Too many sign-up attempts. Wait a few minutes and try again.',
  'weak-password': 'That password is too weak. Use at least 8 characters with a mix of letters and numbers.',
  'signup-failed': 'We could not create your account. Please try again.',
};

export default function SignUp({ searchParams }: { searchParams: { error?: string; message?: string; next?: string } }) {
  const next = safeRedirectPath(searchParams.next);
  const sent = searchParams.message === 'verification-sent';
  return (
    <main className="auth-wrap">
      <div className="auth-card card">
        <div className="eyebrow">Start here</div>
        <h1>Create your workspace</h1>
        <p>We will send a verification link to your email before you can continue.</p>
        {searchParams.error && <div className="notice error" role="alert">{errors[searchParams.error] ?? 'Sign-up failed. Please try again.'}</div>}
        {sent && <div className="notice success" role="status">Verification email sent. Open the link in your inbox, then sign in.</div>}
        {!sent && (
          <form className="stack" action="/api/auth/signup" method="post">
            <input type="hidden" name="next" value={next} />
            <label><span className="label">Email</span><input className="input" name="email" type="email" autoComplete="email" required /></label>
            <label><span className="label">Password</span><input className="input" name="password" type="password" autoComplete="new-password" minLength={6} required /></label>
            <label><span className="label">Confirm password</span><input className="input" name="confirmPassword" type="password" autoComplete="new-password" minLength={6} required /></label>
            <button className="button primary" type="submit">Create account</button>
          </form>
        )}
        <div className="divider">or</div>
        <a className="button secondary" href={isDemoMode ? next : `/api/auth/google?next=${encodeURIComponent(next)}`}>Sign up with Google <span>↗</span></a>
        <p className="auth-switch">Already have an account? <a href={`/signin?next=${encodeURIComponent(next)}`}>Sign in</a></p>
      </div>
    </main>
  );
}
