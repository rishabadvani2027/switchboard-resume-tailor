export const SITE_NAME = 'Switchboard';
export const SITE_TITLE = 'Switchboard — tailor your resume to every job, in minutes';
export const SITE_DESCRIPTION = 'Upload your resume and a job description. Get ATS-friendly, keyword-matched suggestions you approve one by one, see your ATS score before and after, and download in your original Word or PDF format.';

/** Public base URL of the site (custom domain in production). */
export function siteUrl() {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  if (process.env.VERCEL_ENV === 'production') return 'https://switchboardapp.studio';
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
