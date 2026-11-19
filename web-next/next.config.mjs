/** @type {import('next').NextConfig} */
const nextConfig = {
 reactStrictMode: true,
 poweredByHeader: false,
 async rewrites() {
  const backend = process.env.BACKEND_URL || 'http://127.0.0.1:3100';
  return [{ source: '/print.css', destination: `${backend}/print.css` }, { source: '/print.js', destination: `${backend}/print.js` }, { source: '/review.js', destination: `${backend}/review.js` },
   { source: '/api/public/:path*', destination: `${backend}/api/public/:path*` }];
 }
};
export default nextConfig;
