import { isDemoMode } from '../../lib/auth/config';

export default function SignUp({ searchParams }: { searchParams: { error?: string; message?: string; next?: string } }) {
  const next = searchParams.next ?? '/intake';
  const errors: Record<string, string> = {
    'auth-unavailable': 'Sign-up is unavailable until Supabase is configured.',
    'credentials-required': 'Enter a valid email and a password of at least six characters.',
    'password-mismatch': 'Passwords do not match.',
    'email-in-use': 'An account may already exist for this email. Try signing in.',
    'signup-failed': 'We could not create your account. Please try again.',
  };
  return <main className="auth-wrap"><div className="auth-card card"><div className="eyebrow">Start here</div><h1>Create your workspace</h1><p>We will send a verification link to your email before you can continue.</p>{searchParams.error && <div className="notice error" role="alert">{errors[searchParams.error] ?? 'Sign-up failed. Please try again.'}</div>}{searchParams.message === 'verification-sent' && <div className="notice" role="status">Verification email sent. Check your inbox, verify your address, then sign in.</div>}<form className="stack" action="/api/auth/signup" method="post"><input type="hidden" name="next" value={next} /><label><span className="label">Email</span><input className="input" name="email" type="email" autoComplete="email" required /></label><label><span className="label">Password</span><input className="input" name="password" type="password" autoComplete="new-password" minLength={6} required /></label><label><span className="label">Confirm password</span><input className="input" name="confirmPassword" type="password" autoComplete="new-password" minLength={6} required /></label><button className="button primary" type="submit">Create account</button></form><p className="field-note">{isDemoMode ? 'Demo mode is active. No account will be created.' : 'Your account is secured by Supabase Auth.'}</p><p className="auth-switch">Already have an account? <a href={`/signin?next=${encodeURIComponent(next)}`}>Sign in</a></p></div></main>;
}
