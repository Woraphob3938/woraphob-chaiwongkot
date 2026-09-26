"use client";

import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Camera, LoaderCircle, Trash2, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiAssetUrl, authenticatedRequest } from "@/lib/api";
import { initials } from "@/lib/format";
import type { AccountProfile } from "@/lib/types";

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 5 * 1024 * 1024;

type ProfileIdentityProps = {
  profile: AccountProfile;
  onProfileChange: (profile: AccountProfile) => void;
};

export function ProfileIdentity({ profile, onProfileChange }: ProfileIdentityProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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

  function clearImageSelection() {
    setFile(null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function cancelImageSelection() {
    clearImageSelection();
    setError("");
    setMessage("");
  }

  function changeManagerOpen(open: boolean) {
    if (pending) return;
    setManagerOpen(open);
    if (open) {
      setError("");
      setMessage("");
      return;
    }
    clearImageSelection();
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
      clearImageSelection();
      setManagerOpen(false);
      setMessage("เปลี่ยนรูปโปรไฟล์แล้ว");
    } catch (uploadError) {
      setPreviewUrl(null);
      setError(uploadError instanceof Error ? uploadError.message : "อัปโหลดรูปไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  }

  async function deleteImage() {
    if (pending || !profile.imageUrl) return;
    setPending(true);
    setError("");
    setMessage("");
    try {
      await authenticatedRequest<{ imageUrl: null }>("/v1/profile/image", { method: "DELETE" });
      onProfileChange({ ...profile, imageUrl: null });
      clearImageSelection();
      setConfirmDelete(false);
      setManagerOpen(false);
      setMessage("ลบรูปโปรไฟล์แล้ว");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "ลบรูปโปรไฟล์ไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  }

  const displayName = profile.user.displayName || "บัญชีของฉัน";
  const imageSource = previewUrl ?? apiAssetUrl(profile.imageUrl);
  const homeHref = profile.role === "member" ? "/member" : "/trainer";

  return (
    <section className="profile-identity" aria-labelledby="profile-title">
      <nav className="account-profile__breadcrumb" aria-label="เส้นทางโปรไฟล์">
        <Link href={homeHref}>บัญชีของฉัน</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">โปรไฟล์</span>
      </nav>
      <div className="profile-identity__main">
        <button
          className="profile-identity__avatar-trigger"
          type="button"
          aria-label="จัดการรูปโปรไฟล์"
          onClick={() => changeManagerOpen(true)}
        >
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
          <span className="profile-identity__camera" aria-hidden="true"><Camera size={16} /></span>
        </button>
        <div className="profile-identity__copy">
          <div className="profile-identity__heading">
            <h1 id="profile-title">{displayName}</h1>
            <span className="profile-role-badge">{profile.role === "member" ? "สมาชิก" : "เทรนเนอร์"}</span>
          </div>
          <span>{profile.user.email}</span>
        </div>
      </div>
      {error && !managerOpen && <p className="profile-field-error" role="alert">{error}</p>}
      {message && <p className="profile-success" role="status">{message}</p>}
      <Dialog open={managerOpen} onOpenChange={changeManagerOpen}>
        <DialogContent className="profile-photo-dialog">
          <DialogHeader>
            <DialogTitle>จัดการรูปโปรไฟล์</DialogTitle>
            <DialogDescription>เลือกรูปใหม่ ตรวจตัวอย่าง แล้วบันทึกเมื่อพร้อม</DialogDescription>
          </DialogHeader>
          <form className="profile-photo-dialog__form" onSubmit={uploadImage}>
            <Avatar className="profile-photo-dialog__avatar">
              {imageSource
                ? <Image
                    className="profile-identity__image"
                    src={imageSource}
                    alt={`ตัวอย่างรูปโปรไฟล์ของ ${displayName}`}
                    width={160}
                    height={160}
                    unoptimized
                  />
                : <AvatarFallback>{initials(displayName)}</AvatarFallback>}
            </Avatar>
            <div className="profile-photo-dialog__actions">
              <label className="button" htmlFor="profile-image">
                <Camera aria-hidden="true" size={17} /> เลือกรูปใหม่
              </label>
              <input
                ref={fileInputRef}
                className="sr-only"
                id="profile-image"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="เลือกรูปโปรไฟล์"
                onChange={chooseImage}
              />
              <button className="button button--accent" type="submit" disabled={!file || pending}>
                {pending && file ? <><LoaderCircle className="spin" aria-hidden="true" /> กำลังอัปโหลด</> : "บันทึกรูปใหม่"}
              </button>
              {file && (
                <button className="button" type="button" disabled={pending} onClick={cancelImageSelection}>
                  <X aria-hidden="true" /> ยกเลิกรูปที่เลือก
                </button>
              )}
              {profile.imageUrl && !file && (
                <button className="button button--danger" type="button" disabled={pending} onClick={() => setConfirmDelete(true)}>
                  <Trash2 aria-hidden="true" /> ลบรูปโปรไฟล์
                </button>
              )}
            </div>
            <small>{file ? file.name : "JPG, PNG หรือ WebP · ไม่เกิน 5 MB"}</small>
            {error && <p className="profile-field-error" role="alert">{error}</p>}
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDelete} onOpenChange={(open) => { if (!pending) setConfirmDelete(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ลบรูปโปรไฟล์นี้?</DialogTitle>
            <DialogDescription>บัญชีจะกลับไปใช้ตัวอักษรย่อแทนรูป จนกว่าจะอัปโหลดรูปใหม่</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <button className="button" type="button" disabled={pending}>กลับไป</button>
            </DialogClose>
            <button className="button button--danger" type="button" disabled={pending} onClick={() => void deleteImage()}>
              {pending ? "กำลังลบ…" : "ยืนยันลบรูป"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
