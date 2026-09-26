import type { NextConfig } from "next";

/**
 * The API client reads `NEXT_PUBLIC_FITCONNECT_API_URL` and falls back to this
 * origin (`lib/api.ts:4`). Profile images are served from it
 * (`/v1/profile-images/...`), and `next/image` refuses any remote host it has
 * not been told about — the optimizer answered 400 for every real trainer
 * photo, which is why `/trainers` and `/trainers/[slug]` showed none.
 */
const API_URL = process.env.NEXT_PUBLIC_FITCONNECT_API_URL ?? "http://localhost/fitconnect-api";

type RemotePattern = NonNullable<NonNullable<NextConfig["images"]>["remotePatterns"]>[number];

/**
 * The API origin, plus the same host over `https` so a deployed API keeps
 * working, limited to the API's own paths rather than the whole host. Reading
 * the prefix from the URL means the environment variable is honoured here too
 * instead of only in the browser bundle.
 */
function imagePatternsFor(apiUrl: string): RemotePattern[] {
  let api: URL;
  try {
    api = new URL(apiUrl);
  } catch {
    return [];
  }

  const pathname = `${api.pathname.replace(/\/+$/, "")}/**`;
  const candidates: RemotePattern[] = [
    { protocol: api.protocol === "https:" ? "https" : "http", hostname: api.hostname, port: api.port, pathname },
    { protocol: "https", hostname: api.hostname, port: "", pathname },
  ];

  return candidates.filter((pattern, index) => candidates.findIndex(
    (other) => other.protocol === pattern.protocol && other.hostname === pattern.hostname && other.port === pattern.port,
  ) === index);
}

/**
 * Next 16 blocks image optimization for upstream hosts that resolve to a
 * loopback or private address unless `dangerouslyAllowLocalIP` is set — the
 * optimizer answered 400/404 for every real trainer photo while the API itself
 * served it fine. The API runs on this machine (Apache on :80) during
 * development, so relax it only while the configured API host really is local;
 * a deployed API keeps the strict default.
 */
function apiHostIsLocal(apiUrl: string): boolean {
  try {
    const host = new URL(apiUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    remotePatterns: imagePatternsFor(API_URL),
    ...(apiHostIsLocal(API_URL) ? { dangerouslyAllowLocalIP: true } : {}),
  },
};

export default nextConfig;
