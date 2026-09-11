import { ApiError } from "@/lib/api";
import type { AuthenticatedUser, UserRole } from "@/lib/types";

export const TOKEN_STORAGE_KEY = "fitconnect_token";
export const USER_STORAGE_KEY = "fitconnect_user";

const validRoles: readonly UserRole[] = ["member", "trainer", "admin"];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && (validRoles as readonly string[]).includes(value);
}

export function profileImageStorageKey(userId: number) {
  return `fitconnect_profile_image_${userId}`;
}

/** Clears the cached browser session without touching the API. */
export function clearStoredSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(USER_STORAGE_KEY);
}

/**
 * Reads the cached identity. A stored user that fails the shape check is
 * discarded rather than trusted, and `requireToken` additionally demands a
 * token so a stale identity cannot keep a signed-out shell looking signed in.
 * Four components each grew their own version of this with different
 * strictness, which is how a malformed entry survived in one of them.
 */
export function readStoredUser({ requireToken = true }: { requireToken?: boolean } = {}): AuthenticatedUser | null {
  if (typeof window === "undefined") return null;
  if (requireToken && !localStorage.getItem(TOKEN_STORAGE_KEY)) return null;

  const stored = localStorage.getItem(USER_STORAGE_KEY);
  if (!stored) return null;

  try {
    const user = JSON.parse(stored) as Partial<AuthenticatedUser> | null;
    if (
      !user
      || typeof user.id !== "number"
      || typeof user.email !== "string"
      || typeof user.displayName !== "string"
      || !isUserRole(user.role)
    ) {
      throw new Error("Invalid stored user");
    }
    return user as AuthenticatedUser;
  } catch {
    localStorage.removeItem(USER_STORAGE_KEY);
    return null;
  }
}

/**
 * Handles a rejected request by ending the browser session. Returns false when
 * the failure was not an expired session, so callers can fall through to their
 * own error copy.
 */
export function leaveExpiredSession(error: unknown, navigate: (href: string) => void): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  clearStoredSession();
  navigate("/login");
  return true;
}
