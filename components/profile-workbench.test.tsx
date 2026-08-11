import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileWorkbench } from "@/components/profile-workbench";
import { ApiError, authenticatedRequest } from "@/lib/api";

const { push, router } = vi.hoisted(() => {
  const stablePush = vi.fn();
  return { push: stablePush, router: { push: stablePush } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, authenticatedRequest: vi.fn() };
});

const memberProfile = {
  role: "member" as const,
  user: { displayName: "สมชาย ใจดี", email: "member@example.com" },
  imageUrl: null,
  member: {
    firstName: "สมชาย", lastName: "ใจดี", phone: "", fitnessGoal: "",
    experienceLevel: "", weight: null, height: null,
  },
};

const trainerProfile = {
  role: "trainer" as const,
  user: { displayName: "ครูเมย์", email: "trainer@example.com" },
  imageUrl: null,
  trainer: {
    legalName: "เมย์ ใจดี", phone: "", headline: "", bio: "", yearsExperience: 3,
    serviceMode: "freelance" as const, gymName: null, priceFrom: 650, trainingTypeIds: [1],
    approvalStatus: "approved" as const, approvalNote: null, certificates: [],
  },
};

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
  vi.mocked(authenticatedRequest).mockReset();
});

describe("ProfileWorkbench", () => {
  it.each([
    [memberProfile, "โปรไฟล์สมาชิก"],
    [trainerProfile, "โปรไฟล์เทรนเนอร์"],
  ] as const)("loads the %s account profile", async (profile, heading) => {
    localStorage.setItem("fitconnect_token", "token");
    localStorage.setItem("fitconnect_user", JSON.stringify({ role: profile.role }));
    vi.mocked(authenticatedRequest).mockImplementation(async (path) => path === "/v1/training-types" ? [] : profile);

    render(<ProfileWorkbench />);

    expect(screen.getByText("กำลังโหลดโปรไฟล์")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: heading })).toBeInTheDocument();
    expect(screen.getByText(profile.user.email)).toBeInTheDocument();
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/profile");
  });

  it("shows an alert and retries a failed profile request", async () => {
    localStorage.setItem("fitconnect_token", "token");
    localStorage.setItem("fitconnect_user", JSON.stringify({ role: "member" }));
    vi.mocked(authenticatedRequest)
      .mockRejectedValueOnce(new ApiError("เชื่อมต่อไม่สำเร็จ", 503))
      .mockResolvedValueOnce(memberProfile);

    render(<ProfileWorkbench />);

    expect(await screen.findByRole("alert")).toHaveTextContent("เชื่อมต่อไม่สำเร็จ");
    fireEvent.click(screen.getByRole("button", { name: "ลองใหม่" }));
    expect(await screen.findByRole("heading", { name: "โปรไฟล์สมาชิก" })).toBeInTheDocument();
    expect(authenticatedRequest).toHaveBeenCalledTimes(2);
  });

  it("returns a guest to login without requesting profile data", async () => {
    render(<ProfileWorkbench />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("returns an admin to their workspace without requesting profile data", async () => {
    localStorage.setItem("fitconnect_token", "token");
    localStorage.setItem("fitconnect_user", JSON.stringify({ role: "admin" }));
    render(<ProfileWorkbench />);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/admin"));
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });
});
