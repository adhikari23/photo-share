/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const backendPort = process.env.BACKEND_PORT || "8000";
    return [
      {
        source: "/api/:path*",
        destination: `http://127.0.0.1:${backendPort}/api/:path*`
      }
    ];
  }
};

module.exports = nextConfig;
