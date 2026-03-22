import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure channels.config.json (copied into frontend/ at prebuild) ships with serverless routes.
  outputFileTracingIncludes: {
    "/api/**": ["./channels.config.json"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
    ],
  },
};

export default nextConfig;
