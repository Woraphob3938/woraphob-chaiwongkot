export type UserRole = "member" | "trainer" | "admin";

export type VerificationStatus = "verified" | "pending" | "rejected";
export type BookingStatus =
  | "pending_trainer"
  | "awaiting_payment"
  | "payment_review"
  | "confirmed"
  | "completed"
  | "cancelled";

export type Province = {
  id: number;
  nameTh: string;
  region: string;
};

export type TrainingType = {
  id: number;
  slug: string;
  nameTh: string;
};

export type AvailabilitySlot = {
  id: number;
  startsAt: string;
  endsAt: string;
  available: boolean;
};

export type Certificate = {
  id: number;
  name: string;
  issuer: string;
  issuedYear?: number;
  status: VerificationStatus;
};

export type Trainer = {
  id: number;
  slug: string;
  displayName: string;
  headline: string;
  bio: string;
  yearsExperience: number;
  province: Province;
  serviceAreas: string[];
  trainingTypes: TrainingType[];
  serviceMode: "freelance" | "gym" | "both";
  gymName?: string;
  priceFrom?: number;
  rating?: number;
  reviewCount: number;
  verification: VerificationStatus;
  certificates: Certificate[];
  slots: AvailabilitySlot[];
  image?: string;
  demo: boolean;
};

export type Booking = {
  id: string;
  trainer: Pick<Trainer, "id" | "displayName" | "slug">;
  startsAt: string;
  endsAt: string;
  location: string;
  status: BookingStatus;
  paymentStatus: "not_submitted" | "reviewing" | "approved" | "rejected";
  createdAt: string;
  demo: boolean;
};

export type ApiEnvelope<T> = {
  data: T;
  meta?: Record<string, unknown>;
};

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
};
