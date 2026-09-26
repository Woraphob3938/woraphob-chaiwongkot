import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartChatButton } from "@/components/start-chat-button";
import { authenticatedRequest } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, authenticatedRequest: vi.fn() };
});

function signIn(role: "member" | "trainer") {
  localStorage.setItem("fitconnect_token", "token");
  localStorage.setItem("fitconnect_user", JSON.stringify({ id: 1, email: "a@b.c", displayName: "ผู้ใช้", role }));
}

describe("StartChatButton", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(authenticatedRequest).mockReset();
  });

  it("sends a signed-out visitor to log in first", () => {
    const navigate = vi.fn();
    render(<StartChatButton trainerId={4} trainerSlug="trainer-a" trainerName="ครูเอ" navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "แชทสอบถาม ครูเอ" }));
    expect(navigate).toHaveBeenCalledWith("/login?redirect=%2Ftrainers%2Ftrainer-a");
    expect(authenticatedRequest).not.toHaveBeenCalled();
  });

  it("opens the member's inquiry room and goes to it", async () => {
    signIn("member");
    const navigate = vi.fn();
    vi.mocked(authenticatedRequest).mockResolvedValueOnce({ roomId: 9, id: "CHAT-9" });
    render(<StartChatButton trainerId={4} trainerSlug="trainer-a" trainerName="ครูเอ" navigate={navigate} />);
    fireEvent.click(screen.getByRole("button", { name: "แชทสอบถาม ครูเอ" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/chat?booking=CHAT-9"));
    expect(authenticatedRequest).toHaveBeenCalledWith("/v1/chat-rooms", { method: "POST", body: JSON.stringify({ trainerId: "4" }) });
  });

  it("explains that only a member account can start the chat", () => {
    signIn("trainer");
    render(<StartChatButton trainerId={4} trainerSlug="trainer-a" trainerName="ครูเอ" navigate={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "แชทสอบถาม ครูเอ" }));
    expect(screen.getByRole("alert")).toHaveTextContent("แชทกับเทรนเนอร์ได้จากบัญชีสมาชิก");
  });
});
