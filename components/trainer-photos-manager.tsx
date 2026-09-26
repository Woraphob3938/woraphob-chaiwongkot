"use client";

import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { apiAssetUrl, authenticatedRequest } from "@/lib/api";
import type { TrainerPhoto } from "@/lib/types";

type PhotoList = { photos: TrainerPhoto[]; max: number };

const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Extra photos members see on the trainer's profile page, next to the main
 * profile photo. Up to `max` photos; each one is JPG, PNG or WebP under 5 MB.
 */
export function TrainerPhotosManager() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<TrainerPhoto[] | null>(null);
  const [max, setMax] = useState(6);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const result = await authenticatedRequest<PhotoList>("/v1/trainer/photos");
      setPhotos(Array.isArray(result?.photos) ? result.photos : []);
      if (typeof result?.max === "number") setMax(result.max);
      setError("");
    } catch (requestError) {
      setPhotos([]);
      setError(requestError instanceof Error ? requestError.message : "โหลดรูปไม่สำเร็จ");
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function run() {
      if (active) await load();
    }
    void run();
    return () => { active = false; };
  }, [load]);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    setMessage("");
    if (!ACCEPTED.includes(file.type)) {
      setError("ใช้รูป JPG, PNG หรือ WebP");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("รูปต้องมีขนาดไม่เกิน 5 MB");
      return;
    }
    setBusy("upload");
    setError("");
    try {
      const body = new FormData();
      body.append("image", file);
      const result = await authenticatedRequest<PhotoList>("/v1/trainer/photos", { method: "POST", body });
      setPhotos(result.photos);
      setMessage("เพิ่มรูปแล้ว สมาชิกจะเห็นในหน้าโปรไฟล์ของคุณ");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  async function remove(photo: TrainerPhoto, index: number) {
    if (busy) return;
    setBusy(`delete-${photo.id}`);
    setError("");
    setMessage("");
    try {
      const result = await authenticatedRequest<PhotoList>(`/v1/trainer/photos/${photo.id}`, { method: "DELETE" });
      setPhotos(result.photos);
      setMessage(`ลบรูปที่ ${index + 1} แล้ว`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "ลบรูปไม่สำเร็จ");
    } finally {
      setBusy(null);
    }
  }

  const count = photos?.length ?? 0;
  const full = count >= max;

  return (
    <section className="profile-section trainer-photos-manager" aria-labelledby="trainer-photos-title">
      <div className="profile-section__heading">
        <h2 id="trainer-photos-title">รูปในหน้าโปรไฟล์</h2>
        <p>เพิ่มรูปการฝึกหรือสถานที่ได้สูงสุด {max} รูป สมาชิกจะเลื่อนดูต่อจากรูปโปรไฟล์หลัก</p>
      </div>

      {photos === null ? (
        <p className="bank-accounts-manager__loading" role="status">กำลังโหลดรูป…</p>
      ) : (
        <ul className="trainer-photos-manager__grid" aria-label={`รูปของฉัน ${count} จาก ${max} รูป`}>
          {photos.map((photo, index) => {
            const src = apiAssetUrl(photo.url);
            return (
              <li key={photo.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the API with auth-free caching */}
                {src && <img src={src} alt={`รูปที่ ${index + 1}`} loading="lazy" />}
                <button
                  type="button"
                  className="trainer-photos-manager__remove"
                  disabled={Boolean(busy)}
                  aria-label={`ลบรูปที่ ${index + 1}`}
                  onClick={() => void remove(photo, index)}
                >
                  {busy === `delete-${photo.id}` ? <LoaderCircle className="spin" aria-hidden="true" size={16} /> : <Trash2 aria-hidden="true" size={16} />}
                </button>
              </li>
            );
          })}
          {!full && (
            <li>
              <button
                type="button"
                className="trainer-photos-manager__add"
                disabled={Boolean(busy)}
                onClick={() => inputRef.current?.click()}
              >
                {busy === "upload" ? <LoaderCircle className="spin" aria-hidden="true" size={22} /> : <ImagePlus aria-hidden="true" size={22} />}
                <span>{busy === "upload" ? "กำลังอัปโหลด…" : "เพิ่มรูป"}</span>
                <small>JPG, PNG, WebP · ไม่เกิน 5 MB</small>
              </button>
            </li>
          )}
        </ul>
      )}
      <input ref={inputRef} className="sr-only" type="file" accept={ACCEPTED.join(",")} tabIndex={-1} aria-hidden="true" onChange={(event) => void upload(event)} />
      {message && <p className="profile-success" role="status">{message}</p>}
      {error && <p className="profile-field-error" role="alert">{error}</p>}
    </section>
  );
}
