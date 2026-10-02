"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileText, X } from "lucide-react";

/**
 * What the member or trainer is about to send, shown before sending: a
 * thumbnail for an image, a file card for a PDF, and either one opens full
 * size in a new tab straight from the browser (nothing is uploaded yet).
 */
export function ChatAttachmentPreview({ file, kind, meta, disabled, onRemove }: {
  file: File;
  kind: "image" | "file";
  meta: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (typeof URL.createObjectURL !== "function") return;
    const objectUrl = URL.createObjectURL(file);
    queueMicrotask(() => setUrl(objectUrl));
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [file]);

  const isImage = kind === "image" && file.type.startsWith("image/");
  const label = kind === "image" ? "รูปภาพที่เลือก" : "ไฟล์ที่เลือก";

  return (
    <figure className="chat-attachment-preview" aria-label={`${label}: ${file.name}`}>
      {isImage ? (
        url ? (
          <a className="chat-attachment-preview__thumb" href={url} target="_blank" rel="noreferrer" title="เปิดดูรูปเต็ม">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL, not an optimisable asset */}
            <img src={url} alt={`ตัวอย่างรูป ${file.name}`} />
          </a>
        ) : <span className="chat-attachment-preview__thumb" aria-hidden="true" />
      ) : (
        <span className="chat-attachment-preview__icon" aria-hidden="true"><FileText size={22} /></span>
      )}
      <figcaption>

        <strong className="chat-attachment-preview__name" title={file.name}>{file.name}</strong>
        <small>{meta}</small>
        <span className="chat-attachment-preview__actions">
          {url && (
            <a className="button" href={url} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" size={15} /> {isImage ? "ดูรูปเต็ม" : "เปิดดูไฟล์"}
            </a>
          )}
          <button className="button" type="button" disabled={disabled} aria-label={`เอา${kind === "image" ? "รูปภาพ" : "ไฟล์"} ${file.name} ออก`} onClick={onRemove}>
            <X aria-hidden="true" size={15} /> เอาออก
          </button>
        </span>
      </figcaption>
    </figure>
  );
}
