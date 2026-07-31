import { provinces, trainers, trainingTypes } from "@/lib/demo-data";
import type { ApiEnvelope, Province, Trainer, TrainingType } from "@/lib/types";

export const API_URL = process.env.NEXT_PUBLIC_FITCONNECT_API_URL ?? "http://localhost/fitconnect-api";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiError("ยังเชื่อมต่อ PHP API ไม่ได้ โปรดเปิด Apache และ MySQL ใน XAMPP", 503);
  }

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | { error?: { message?: string } } | null;

  if (!response.ok) {
    const message = payload && "error" in payload && payload.error?.message
      ? payload.error.message
      : "เชื่อมต่อบริการ FitConnect ไม่สำเร็จ";
    throw new ApiError(message, response.status);
  }

  if (!payload || !("data" in payload)) {
    throw new ApiError("รูปแบบข้อมูลจากบริการไม่ถูกต้อง", response.status);
  }

  return payload.data;
}

export async function getTrainers(): Promise<{ data: Trainer[]; source: "api" | "demo" }> {
  try {
    return { data: await apiRequest<Trainer[]>("/v1/trainers"), source: "api" };
  } catch {
    return { data: trainers, source: "demo" };
  }
}

export async function getTrainer(slug: string): Promise<{ data: Trainer | null; source: "api" | "demo" }> {
  try {
    return { data: await apiRequest<Trainer>(`/v1/trainers/${encodeURIComponent(slug)}`), source: "api" };
  } catch {
    return { data: trainers.find((trainer) => trainer.slug === slug) ?? null, source: "demo" };
  }
}

export async function getReferenceData(): Promise<{
  provinces: Province[];
  trainingTypes: TrainingType[];
  source: "api" | "demo";
}> {
  try {
    const [liveProvinces, liveTrainingTypes] = await Promise.all([
      apiRequest<Province[]>("/v1/provinces"),
      apiRequest<TrainingType[]>("/v1/training-types"),
    ]);
    return { provinces: liveProvinces, trainingTypes: liveTrainingTypes, source: "api" };
  } catch {
    return { provinces, trainingTypes, source: "demo" };
  }
}
