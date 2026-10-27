"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { TrainerMarketplaceCard } from "@/components/trainer-marketplace-card";
import { apiRequest } from "@/lib/api";
import type { Trainer } from "@/lib/types";

type TrainersState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; trainers: Trainer[] };

export function ProfileTrainersPanel() {
  const [state, setState] = useState<TrainersState>({ status: "loading" });

  // Live data only: the demo fallback in getTrainers() produces slugs the
  // trainer page cannot open, which sent members to a 404.
  const load = useCallback(async () => {
    try {
      const trainers = await apiRequest<Trainer[]>("/v1/trainers", { cache: "no-store" });
      setState({ status: "ready", trainers });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "โหลดรายชื่อเทรนเนอร์ไม่สำเร็จ",
      });
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  return (
    <section className="profile-section" aria-labelledby="profile-trainers-title">
      <div className="profile-section__heading">
        <h2 id="profile-trainers-title">เทรนเนอร์</h2>
        <p>ดูโปรไฟล์เทรนเนอร์และเลือกเวลาที่ว่าง</p>
      </div>
      {state.status === "loading" && (
        <div className="workbench-loading" role="status">
          <LoaderCircle className="spin" aria-hidden="true" size={20} /> กำลังโหลดเทรนเนอร์
        </div>
      )}
      {state.status === "error" && (
        <div className="workbench-error" role="alert">
          <CircleAlert aria-hidden="true" size={20} />
          <p>{state.message}</p>
          <button className="button" type="button" onClick={() => { setState({ status: "loading" }); void load(); }}>
            <RefreshCw aria-hidden="true" size={17} /> ลองใหม่
          </button>
        </div>
      )}
      {state.status === "ready" && (state.trainers.length === 0
        ? <p>ยังไม่มีเทรนเนอร์ในระบบ</p>
        : (
          <ul className="trainer-marketplace-grid" aria-label={`เทรนเนอร์ ${state.trainers.length} คน`}>
            {state.trainers.map((trainer) => (
              <TrainerMarketplaceCard key={trainer.id} trainer={trainer} returnTo="/profile" />
            ))}
          </ul>
        ))}
    </section>
  );
}
