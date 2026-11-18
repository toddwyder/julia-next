/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.JULIA_VERIFY_DIST_DIR ?? '.next',
  cacheComponents: true,
  partialPrefetching: true,
};

export default nextConfig;
