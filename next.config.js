/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Next.js 14: enable the instrumentation hook so the cron scheduler boots once.
    instrumentationHook: true,
    // exceljs / node-cron are server-only — keep them out of the client bundle.
    serverComponentsExternalPackages: [
      "exceljs",
      "node-cron",
      "satori",
      "@resvg/resvg-js",
      "pdf-parse",
      "mammoth",
      "tesseract.js",
      "pdfjs-dist",
      "@napi-rs/canvas",
      "adm-zip",
    ],
    // Bundle runtime data files that are loaded by absolute fs path (not import),
    // so they exist in the serverless functions on Vercel: the brand fonts used
    // by server-side image rendering, and the pdfjs worker used by scanned-PDF OCR.
    outputFileTracingIncludes: {
      "/api/generate": ["./node_modules/@fontsource/**/files/*.woff"],
      "/api/extract": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    },
  },
  async rewrites() {
    // Local-mode images now live outside public/ (see lib/dataDir.ts) and are
    // served by app/api/images/[filename]. This keeps any already-generated
    // row that still stores a legacy "/images/<file>" path working without a
    // one-time data rewrite.
    return [{ source: "/images/:filename", destination: "/api/images/:filename" }];
  },
};

module.exports = nextConfig;
