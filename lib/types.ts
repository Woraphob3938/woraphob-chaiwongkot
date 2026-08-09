export type UserRole = "member" | "trainer" | "admin";

export type AuthenticatedUser = {
  id: number;
  email: string;
  displayName: string;
  role: UserRole;
  status: string;
};

export type VerificationStatus = "verified" | "pending" | "rejected";
export type TrainerApprovalStatus = "pending" | "approved" | "rejected";
export type SlotState = "available" | "held" | "booked" | "blocked";
export type BookingStatus =
  | "pending_trainer"
  | "awaiting_payment"
  | "payment_review"
  | "confirmed"
  | "completed"
  | "cancelled";

export type PaymentSummary = {
  id: number;
  amount: number | null;
  status: "reviewing" | "approved" | "rejected";
  reviewNote: string | null;
  submittedAt: string;
};

export type ReviewSummary = {
  rating: number;
  comment: string;
  status: "published" | "hidden" | "reported";
  createdAt: string;
};

export type BookingActions = {
  canPay: boolean;
  canReadChat: boolean;
  canSendChat: boolean;
  canComplete: boolean;
  canReview: boolean;
};

export type ChatAttachment = {
  name: string;
  mime: string;
  size: number;
  url: string;
};

export type ChatMessage = {
  id: number;
  message: string;
  attachment: ChatAttachment | null;
  createdAt: string;
  readAt: string | null;
  sender: { id: number; displayName: string };
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

export type TrainerAvailabilitySlot = {
  id: number;
  startsAt: string;
  endsAt: string;
  state: SlotState;
};

export type TrainerWorkspace = {
  profile: null | {
    id: number;
    slug: string;
    displayName: string;
    approvalStatus: TrainerApprovalStatus;
    approvalNote: string | null;
  };
  certificates: Certificate[];
  slots: TrainerAvailabilitySlot[];
};

export type AdminCertificate = {
  id: number;
  name: string;
  issuer: string;
  submittedAt: string;
  fileUrl: string;
};

export type AdminQueue = {
  trainers: Array<{
    id: number;
    slug: string;
    displayName: string;
    submittedAt: string;
    certificates: AdminCertificate[];
    demo?: boolean;
  }>;
  payments: Array<{
    id: number;
    bookingId: string;
    memberName: string;
    trainerName: string;
    startsAt: string;
    endsAt: string;
    quotedPrice: number | null;
    amount: number | null;
    difference: number | null;
    submittedAt: string;
    fileUrl: string;
    demo?: boolean;
  }>;
};

export type Trainer = {
  id: number;
  slug: string;
  displayName: string;
  headline: string;
  bio: string;
  yearsExperience: number;
  trainingTypes: TrainingType[];
  serviceMode: "freelance" | "gym" | "both";
  gymName?: string;
  priceFrom?: number | null;
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
  status: BookingStatus;
  paymentStatus: "not_submitted" | "reviewing" | "approved" | "rejected";
  quotedPrice: number | null;
  chatRoomId: number | null;
  payment: PaymentSummary | null;
  review: ReviewSummary | null;
  actions: BookingActions;
  createdAt: string;
  demo: boolean;
  member?: { displayName: string };
  note?: string;
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
