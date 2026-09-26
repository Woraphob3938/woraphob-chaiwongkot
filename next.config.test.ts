import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";

/**
 * `next/image` refuses any remote host that is not listed, and the API serves
 * profile photos from its own origin (`lib/api.ts`). Without this block every
 * real trainer photo answered 400 from `/_next/image`, so the list is part of
 * the fix, not decoration.
 */
describe("next.config images.remotePatterns", () => {
  const api = new URL(process.env.NEXT_PUBLIC_FITCONNECT_API_URL ?? "http://localhost/fitconnect-api");
  const patterns = nextConfig.images?.remotePatterns ?? [];

  it("allows the API origin the client actually calls", () => {
    expect(patterns).toContainEqual({
      protocol: api.protocol === "https:" ? "https" : "http",
      hostname: api.hostname,
      port: api.port,
      pathname: "/fitconnect-api/**",
    });
  });

  it("allows the same host over https for a deployed API", () => {
    expect(patterns).toContainEqual({
      protocol: "https",
      hostname: api.hostname,
      port: "",
      pathname: "/fitconnect-api/**",
    });
  });

  it("keeps the rest of the host out of the optimizer", () => {
    for (const pattern of patterns) {
      expect(pattern.pathname).toBe("/fitconnect-api/**");
    }
  });
});
