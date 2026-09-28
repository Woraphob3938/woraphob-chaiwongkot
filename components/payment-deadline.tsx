"use client";

import { useEffect, useRef, useState } from "react";

/** Below this many milliseconds the countdown turns urgent. */
const URGENT_MS = 3 * 60 * 1000;

export function PaymentDeadline({
  deadlineAt,
  onExpired,
  label = "เวลาที่เหลือสำหรับส่งสลิป",
}: {
  deadlineAt: string;
  onExpired: () => void;
  label?: string;
}) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Date.parse(deadlineAt) - Date.now()),
  );
  const notified = useRef(false);

  useEffect(() => {
    const tick = () => {
      setRemaining(Math.max(0, Date.parse(deadlineAt) - Date.now()));
    };
    tick();
    const intervalId = window.setInterval(tick, 1_000);
    return () => window.clearInterval(intervalId);
  }, [deadlineAt]);

  useEffect(() => {
    if (remaining === 0 && !notified.current) {
      notified.current = true;
      onExpired();
    }
  }, [onExpired, remaining]);

  if (remaining === 0) {
    return <span className="payment-deadline is-expired" role="status">หมดเวลาแล้ว</span>;
  }

  const seconds = Math.ceil(remaining / 1_000);
  const minutesText = String(Math.floor(seconds / 60)).padStart(2, "0");
  const secondsText = String(seconds % 60).padStart(2, "0");

  const urgent = remaining <= URGENT_MS;
  // The digits tick every second, so they are not a live region; the timer
  // role names them and a screen reader announces the value when focused.
  return (
    <span
      className={`payment-deadline${urgent ? " is-urgent" : ""}`}
      role="timer"
      aria-label={`${label} ${Math.floor(seconds / 60)} นาที ${seconds % 60} วินาที`}
      data-urgent={urgent || undefined}
    >
      <time dateTime={deadlineAt} suppressHydrationWarning aria-hidden="true">{minutesText}:{secondsText}</time>
    </span>
  );
}
