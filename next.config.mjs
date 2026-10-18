/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the dev cache separate from production builds so `next build` never corrupts `next dev`.
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',
  experimental: {
    // Load the document parsers from node_modules at runtime instead of bundling them.
    // Bundling pdfjs breaks its worker/DOMMatrix setup on serverless hosts.
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist', '@napi-rs/canvas', 'mammoth'],
    // Make sure the PDF worker file (loaded dynamically) ships with the function on Vercel.
    outputFileTracingIncludes: {
      '/api/documents': ['./node_modules/pdf-parse/dist/**/*', './node_modules/pdfjs-dist/legacy/build/**/*'],
    },
  },
};
export default nextConfig;
