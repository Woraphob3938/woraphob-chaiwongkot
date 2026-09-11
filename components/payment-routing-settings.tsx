"use client";

import { useCallback, useEffect, useState } from "react";
import { authenticatedRequest } from "@/lib/api";
import { Button } from "@/components/ui/button";

type Routing = {
  unresolved: { id: string; trainerName: string }[];
};

export function PaymentRoutingSettings() {
  const [data, setData] = useState<Routing | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const result = await authenticatedRequest<Routing>("/v1/admin/payment-routing");
    setData(result);
  }, []);
  useEffect(() => {
    let active = true;
    void authenticatedRequest<Routing>("/v1/admin/payment-routing").then(
      (result) => { if (active) setData(result); },
      (reason: Error) => { if (active) setError(reason.message); },
    );
    return () => { active = false; };
  }, []);

  async function save(input: object) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await authenticatedRequest("/v1/admin/payment-routing", { method: "POST", body: JSON.stringify(input) });
      setNotice("บันทึกสังกัดแล้ว");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "บันทึกไม่สำเร็จ"); }
    finally { setBusy(false); }
  }

  return <details className="admin-record-disclosure">
    <summary>กำหนดผู้ตรวจสลิปของการจองเดิม</summary>
    <div className="admin-editor">
      <p>FitConnect ใช้ยิมเดียว เทรนเนอร์ฟรีแลนซ์ตรวจสลิปของตนเอง ส่วนผู้ดูแลระบบที่มีสิทธิ์ตรวจการชำระเงินตรวจสลิปของเทรนเนอร์ประจำยิม</p>
      {error && <div role="alert"><p>{error}</p><Button variant="outline" disabled={busy} onClick={() => void load().then(() => setError("")).catch((reason: Error) => setError(reason.message))}>ลองโหลดใหม่</Button></div>}
      {notice && <p role="status">{notice}</p>}
      {!data && !error && <p role="status">กำลังโหลดสังกัดยิม…</p>}
      {data && <>
        {data.unresolved.length > 0 && <details><summary>การจองเดิมที่ต้องระบุผู้รับผิดชอบ ({data.unresolved.length})</summary>
          <p>ตรวจข้อตกลงเดิมก่อนเลือกว่าเป็นฟรีแลนซ์หรือประจำยิม</p>
          {data.unresolved.map((booking) => <form key={booking.id} className="admin-editor__fields" onSubmit={(event) => {
            event.preventDefault();
            void save({ bookingId: booking.id, paymentServiceMode: new FormData(event.currentTarget).get("mode") });
          }}><label><span>{booking.id} · {booking.trainerName}</span><select name="mode" required disabled={busy} defaultValue="">
            <option value="">เลือกตามข้อตกลงเดิม</option><option value="freelance">ฟรีแลนซ์</option><option value="gym">ประจำยิม</option>
          </select></label><Button type="submit" disabled={busy}>ยืนยันผู้รับผิดชอบ</Button></form>)}
        </details>}
        {data.unresolved.length === 0 && <p>การจองทั้งหมดมีผู้ตรวจสลิปแล้ว</p>}
      </>}
    </div>
  </details>;
}
