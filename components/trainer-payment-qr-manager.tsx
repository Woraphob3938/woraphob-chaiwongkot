"use client";

import Image from "next/image";
import { ChangeEvent, useRef, useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { apiAssetUrl, authenticatedRequest } from "@/lib/api";
import type { AccountProfile, TrainerAccountProfile } from "@/lib/types";

const acceptedQrTypes = ["image/jpeg", "image/png", "image/webp"];
const maxQrBytes = 5 * 1024 * 1024;

/** The receiving QR lives with the account because it is not part of a review. */
export function TrainerPaymentQrManager({ profile, onSaved }: { profile: TrainerAccountProfile; onSaved: (profile: AccountProfile) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [urlOverride, setUrlOverride] = useState<string | null>();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const url = urlOverride === undefined ? profile.trainer.paymentQrUrl ?? null : urlOverride;

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || pending) return;
    setMessage("");
    setError("");
    if (!acceptedQrTypes.includes(file.type) || file.size > maxQrBytes) {
      setError("ใช้ไฟล์ JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB");
      event.target.value = "";
      return;
    }
    setPending(true);
    const body = new FormData();
    body.set("image", file);
    try {
      const result = await authenticatedRequest<{ paymentQrUrl: string }>("/v1/profile/payment-qr", { method: "POST", body });
      setUrlOverride(result.paymentQrUrl);
      onSaved({ ...profile, trainer: { ...profile.trainer, paymentQrUrl: result.paymentQrUrl } });
      setMessage("อัปโหลด QR รับเงินแล้ว");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "อัปโหลด QR ไม่สำเร็จ");
    } finally {
      setPending(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    if (!url || pending) return;
    setPending(true);
    setMessage("");
    setError("");
    try {
      await authenticatedRequest<{ paymentQrUrl: null }>("/v1/profile/payment-qr", { method: "DELETE" });
      setUrlOverride(null);
      onSaved({ ...profile, trainer: { ...profile.trainer, paymentQrUrl: null } });
      setMessage("ลบ QR รับเงินแล้ว");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "ลบ QR ไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="profile-group trainer-payment-qr-manager">
      <div className="profile-group__heading">
        <h3>QR รับเงิน</h3>
        <span>แสดงตอนสมาชิกชำระเงิน</span>
      </div>
      <p className="profile-group__hint">อัปโหลด QR จากแอปธนาคาร สมาชิกจะเห็นภาพนี้ในขั้นตอนจ่ายเงินของการจอง พร้อมยอดที่ต้องโอน ถ้าไม่อัปโหลด ระบบจะสร้าง QR พร้อมเพย์จากเลขพร้อมเพย์ให้แทน</p>
      {url && <Image src={apiAssetUrl(url) as string} alt="QR รับเงินของฉัน" width={160} height={160} unoptimized />}
      <div className="trainer-payment-qr-manager__actions">
        <label className="button" htmlFor="trainer-payment-qr"><Upload aria-hidden="true" size={17} /> {url ? "เปลี่ยน QR" : "อัปโหลด QR รับเงิน"}</label>
        <input ref={inputRef} className="sr-only" id="trainer-payment-qr" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void upload(event)} />
        {url && <button className="button button--danger" type="button" disabled={pending} onClick={() => void remove()}><Trash2 aria-hidden="true" size={17} /> ลบ QR</button>}
      </div>
      <small>JPG, PNG หรือ WebP · ไม่เกิน 5 MB</small>
      {pending && <p role="status">กำลังบันทึก QR…</p>}
      {message && <p className="profile-success" role="status">{message}</p>}
      {error && <p className="profile-field-error" role="alert">{error}</p>}
    </div>
  );
}
