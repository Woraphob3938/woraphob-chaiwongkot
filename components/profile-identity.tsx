"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import { Camera, LoaderCircle } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { apiAssetUrl, authenticatedRequest } from "@/lib/api";
import type { AccountProfile } from "@/lib/types";

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 5 * 1024 * 1024;

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length === 0
    ? "FC"
    : parts.slice(0, 2).map((part) => Array.from(part)[0]).join("").toLocaleUpperCase("th-TH");
}

type ProfileIdentityProps = {
  profile: AccountProfile;
  onProfileChange: (profile: AccountProfile) => void;
};

export function ProfileIdentity({ profile, onProfileChange }: ProfileIdentityProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0] ?? null;
    setMessage("");
    setError("");
    setFile(null);
    setPreviewUrl(null);
    if (!nextFile) return;
    if (!acceptedImageTypes.has(nextFile.type)) {
      setError("รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");
      return;
    }
    if (nextFile.size > maxImageBytes) {
      setError("ขนาดรูปต้องไม่เกิน 5 MB");
      return;
    }
    setFile(nextFile);
    setPreviewUrl(URL.createObjectURL(nextFile));
  }

  async function uploadImage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || pending) return;
    setPending(true);
    setError("");
    setMessage("");
    const body = new FormData();
    body.set("image", file);
    try {
      const result = await authenticatedRequest<{ imageUrl: string }>("/v1/profile/image", {
        method: "POST",
        body,
      });
      onProfileChange({ ...profile, imageUrl: result.imageUrl });
      setFile(null);
      setPreviewUrl(null);
      setMessage("เปลี่ยนรูปโปรไฟล์แล้ว");
    } catch (uploadError) {
      setPreviewUrl(null);
      setError(uploadError instanceof Error ? uploadError.message : "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  }

  const displayName = profile.user.displayName || "บัญชีของฉัน";
  const imageSource = previewUrl ?? apiAssetUrl(profile.imageUrl);

  return (
    <section className="profile-identity" aria-labelledby="profile-title">
      <nav className="account-profile__breadcrumb" aria-label="เส้นทางโปรไฟล์">
        <span>บัญชีของฉัน</span><span aria-hidden="true">/</span><span>โปรไฟล์</span>
      </nav>
      <div className="profile-identity__main">
        <Avatar className="profile-identity__avatar">
          {imageSource
            ? <Image
                className="profile-identity__image"
                src={imageSource}
                alt={`รูปโปรไฟล์ของ ${displayName}`}
                width={112}
                height={112}
                unoptimized
              />
            : <AvatarFallback>{initials(displayName)}</AvatarFallback>}
        </Avatar>
        <div className="profile-identity__copy">
          <div className="profile-identity__heading">
            <h1 id="profile-title">{profile.role === "member" ? "โปรไฟล์สมาชิก" : "โปรไฟล์เทรนเนอร์"}</h1>
            <span className="profile-role-badge">{profile.role === "member" ? "สมาชิก" : "เทรนเนอร์"}</span>
          </div>
          <strong>{displayName}</strong>
          <span>{profile.user.email}</span>
        </div>
      </div>
      <form className="profile-identity__upload" onSubmit={uploadImage}>
        <label className="button button--secondary" htmlFor="profile-image">
          <Camera aria-hidden="true" size={17} /> เลือกรูป
        </label>
        <input
          className="sr-only"
          id="profile-image"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          aria-label="เลือกรูปโปรไฟล์"
          onChange={chooseImage}
        />
        <Button type="submit" disabled={!file || pending}>
          {pending ? <><LoaderCircle className="spin" aria-hidden="true" /> กำลังอัปโหลด</> : "บันทึกรูปใหม่"}
        </Button>
        <small>{file ? file.name : "JPG, PNG หรือ WebP · ไม่เกิน 5 MB"}</small>
      </form>
      {error && <p className="profile-field-error" role="alert">{error}</p>}
      {message && <p className="profile-success" role="status">{message}</p>}
    </section>
  );
}
