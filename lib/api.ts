import { provinces, trainers, trainingTypes } from "@/lib/demo-data";
import type { ApiEnvelope, ApiErrorEnvelope, Province, Trainer, TrainingType } from "@/lib/types";

export const API_URL = process.env.NEXT_PUBLIC_FITCONNECT_API_URL ?? "http://localhost/fitconnect-api";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status = 500,
    public readonly code = "REQUEST_FAILED",
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("fitconnect_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function authenticatedRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  return apiRequest<T>(path, { ...init, headers: { ...authHeaders(), ...init.headers } });
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

  const payload = (await response.json().catch(() => null)) as ApiEnvelope<T> | ApiErrorEnvelope | null;

  if (!response.ok) {
    const error = payload && "error" in payload ? payload.error : null;
    throw new ApiError(
      error?.message ?? "เชื่อมต่อบริการ FitConnect ไม่สำเร็จ",
      response.status,
      error?.code ?? "REQUEST_FAILED",
      error?.fields ?? {},
    );
  }

  if (!payload || !("data" in payload)) {
    throw new ApiError("รูปแบบข้อมูลจากบริการไม่ถูกต้อง", response.status);
  }

  return payload.data;
}

export async function openProtectedFile(path: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { headers: authHeaders() });
  } catch {
    throw new ApiError("ยังเชื่อมต่อ PHP API ไม่ได้ โปรดเปิด Apache และ MySQL ใน XAMPP", 503);
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorEnvelope | null;
    throw new ApiError(
      payload?.error?.message ?? "เปิดไฟล์ไม่สำเร็จ",
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.fields ?? {},
    );
  }

  const objectUrl = URL.createObjectURL(await response.blob());
  window.open(objectUrl, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
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

export async function getLiveTrainerCatalog(): Promise<{
  trainers: Trainer[];
  provinces: Province[];
  trainingTypes: TrainingType[];
}> {
  const request: RequestInit = { cache: "no-store" };
  const [liveTrainers, liveProvinces, liveTrainingTypes] = await Promise.all([
    apiRequest<Trainer[]>("/v1/trainers", request),
    apiRequest<Province[]>("/v1/provinces", request),
    apiRequest<TrainingType[]>("/v1/training-types", request),
  ]);
  return { trainers: liveTrainers, provinces: liveProvinces, trainingTypes: liveTrainingTypes };
}
