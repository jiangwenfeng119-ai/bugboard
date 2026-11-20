import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // 只在有已公布的安全公告时提示升级。
    agentUpgrade: "security",
  },
  output: "standalone",
  poweredByHeader: false,
  serverExternalPackages: ["better-sqlite3"],
  // README 用 127.0.0.1 打开本地开发。Next 默认只放行 localhost，否则页面脚本被拦住，登录不会提交。
  allowedDevOrigins: ["127.0.0.1"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), display-capture=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
