"use client";

import { useState } from "react";
import { MessageSquareText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authenticatedRequest } from "@/lib/api";
import { leaveExpiredSession, readStoredUser } from "@/lib/session";

/**
 * บทที่ 3 ภาพที่ 3-16: from a trainer's profile a member can book or start a
 * chat. The chat opens (or reopens) one inquiry room per member and trainer.
 */
function defaultNavigate(href: string) {
  window.location.assign(href);
}

export function StartChatButton({
  trainerId,
  trainerSlug,
  trainerName,
  navigate = defaultNavigate,
}: {
  trainerId: number;
  trainerSlug: string;
  trainerName: string;
  navigate?: (href: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    if (pending) return;
    const user = readStoredUser();
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(`/trainers/${trainerSlug}`)}`);
      return;
    }
    if (user.role !== "member") {
      setError("แชทกับเทรนเนอร์ได้จากบัญชีสมาชิก");
      return;
    }
    setPending(true);
    setError("");
    try {
      const room = await authenticatedRequest<{ id: string }>("/v1/chat-rooms", {
        method: "POST",
        body: JSON.stringify({ trainerId: String(trainerId) }),
      });
      navigate(`/chat?booking=${encodeURIComponent(room.id)}`);
    } catch (requestError) {
      if (leaveExpiredSession(requestError, navigate)) return;
      setError(requestError instanceof Error ? requestError.message : "เปิดห้องแชทไม่สำเร็จ");
      setPending(false);
    }
  }

  return (
    <div className="start-chat">
      <Button className="button button--wide start-chat__button" type="button" disabled={pending} onClick={() => void start()}>
        <MessageSquareText aria-hidden="true" size={18} />
        {pending ? "กำลังเปิดแชท…" : `แชทสอบถาม ${trainerName}`}
      </Button>
      <p className="start-chat__hint">คุยเรื่องเป้าหมาย เวลา และรายละเอียดการฝึกก่อนจองได้</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  );
}
