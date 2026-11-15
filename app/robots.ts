import type { MetadataRoute } from 'next';
import { siteUrl } from '../lib/site';

/** Public marketing pages are indexable; the signed-in app and APIs are not. */
export default function robots(): MetadataRoute.Robots {
  const isProduction = process.env.VERCEL_ENV === 'production' || !process.env.VERCEL_ENV;
  return {
    // Preview deployments must never be indexed (duplicate content).
    rules: isProduction
      ? [{ userAgent: '*', allow: ['/', '/signin', '/signup'], disallow: ['/api/', '/intake', '/review', '/export', '/billing', '/settings', '/auth/'] }]
      : [{ userAgent: '*', disallow: '/' }],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
