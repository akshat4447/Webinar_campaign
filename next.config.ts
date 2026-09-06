import type { NextConfig } from "next";

// Tunnel hostnames (Cloudflare quick tunnels, ngrok, localtunnel) are random
// per session, so these are wildcards rather than the one currently in use —
// a hardcoded specific subdomain goes stale the moment that tunnel restarts.
const TUNNEL_ORIGINS = ['*.trycloudflare.com', '*.loca.lt', '*.ngrok-free.app', '*.ngrok.io', 'localhost:3000'];

const nextConfig: NextConfig = {
  // Lets the dev server accept HMR/dev-resource requests when accessed
  // through a tunnel rather than localhost directly.
  allowedDevOrigins: TUNNEL_ORIGINS,
  experimental: {
    serverActions: {
      allowedOrigins: TUNNEL_ORIGINS,
    },
  },
};

export default nextConfig;
