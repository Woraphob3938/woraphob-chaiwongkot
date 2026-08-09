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
