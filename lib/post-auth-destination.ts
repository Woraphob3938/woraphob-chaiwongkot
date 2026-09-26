import type { AuthenticatedUser, TrainerWorkspace } from "@/lib/types";

export type PostAuthDestination = "/member" | "/admin" | "/trainer" | "/trainer/apply";

export async function resolvePostAuthDestination(
  user: AuthenticatedUser,
  loadTrainerWorkspace: () => Promise<TrainerWorkspace>,
): Promise<PostAuthDestination> {
  if (user.role === "member") return "/member";
  if (user.role === "admin") return "/admin";

  const workspace = await loadTrainerWorkspace();
  return workspace.profile ? "/trainer" : "/trainer/apply";
}

/**
 * Keeps a `?redirect=` value only when it is an internal path. Runs on the server,
 * so the form receives an already-checked value instead of reading the query
 * string in the browser: the client cannot tell whether a token it holds is still
 * valid, and before this the form decided to auto-continue before it looked at
 * the redirect at all.
 */
export function sanitizeRedirectPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate.startsWith("/")) return null;
  if (candidate.startsWith("//")) return null;
  if (candidate.includes("\\")) return null;
  return candidate;
}

/** An explicit destination wins for every role, not only for members. */
export function resolveAuthRedirect(
  redirectTo: string | null | undefined,
  fallback: PostAuthDestination,
): string {
  return redirectTo ?? fallback;
}
