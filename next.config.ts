import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin turbopack root to this app so it ignores parent lockfiles.
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
};

export default nextConfig;
