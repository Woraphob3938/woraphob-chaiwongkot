export type UserRole = "member" | "trainer" | "admin";

export type AuthenticatedUser = {
  id: number;
  email: string;
  displayName: string;
  role: UserRole;
  status: string;
  imageUrl?: string | null;
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
  | "cancelled"
  | "expired";

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
  canCancel: boolean;
  canScheduleSession?: boolean;
  /** Trainer: accept a `pending_trainer` request. */
  canAccept?: boolean;
  /** Trainer: reject a `pending_trainer` request (reason required). */
  canReject?: boolean;
  /** Trainer: cancel an open booking (reason required). */
  canCancelBooking?: boolean;
};

export type AccountUser = {
  displayName: string;
  email: string;
};

export type AccountCertificate = {
  id: number;
  name: string;
  issuer: string;
  issuedYear: number | null;
  status: VerificationStatus;
};

export type MemberAccountProfile = {
  role: "member";
  user: AccountUser;
  imageUrl: string | null;
  member: {
    /** True when `firstName` is the display-name fallback, not a stored name. */
    nameFromDisplayName: boolean;
    firstName: string;
    lastName: string;
    phone: string;
    fitnessGoal: string;
    experienceLevel: string;
    weight: number | null;
    height: number | null;
    /** `YYYY-MM-DD` or null. */
    birthDate?: string | null;
  };
};

export type TrainerAccountProfile = {
  role: "trainer";
  user: AccountUser;
  imageUrl: string | null;
  trainer: {
    legalName: string;
    /** Optional nickname members can search by. */
    nickname?: string;
    phone: string;
    /** `YYYY-MM-DD` or null. */
    birthDate?: string | null;
    /** Education background, free text ≤255 or null. */
    education?: string | null;
    headline: string;
    bio: string;
    yearsExperience: number;
    serviceMode: "freelance" | "gym" | "both";
    gymName: string | null;
    priceFrom: number | null;
    monthlyPrice?: number | null;
    monthlySessionCount?: number | null;
    paymentAccountName?: string;
    promptPayId?: string;
    paymentQrUrl?: string | null;
    trainingTypeIds: number[];
    approvalStatus: TrainerApprovalStatus;
    approvalNote: string | null;
    certificates: AccountCertificate[];
  };
};

export type AccountProfile = MemberAccountProfile | TrainerAccountProfile;

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
  /** Inline image endpoint (`?kind=image`) or null. */
  imageUrl?: string | null;
  imageName?: string | null;
  imageSize?: number | null;
  /** File attachment endpoint (`?kind=file`) or null. */
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
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
    bookingType?: "single" | "monthly";
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
  /** The trainer's nickname, searchable alongside the display name. */
  nickname?: string | null;
  headline: string;
  bio: string;
  yearsExperience: number;
  trainingTypes: TrainingType[];
  serviceMode: "freelance" | "gym" | "both";
  gymName?: string;
  priceFrom?: number | null;
  monthlyPrice?: number | null;
  monthlySessionCount?: number | null;
  paymentQrUrl?: string | null;
  rating?: number;
  reviewCount: number;
  reviews?: PublicTrainerReview[];
  verification: VerificationStatus;
  certificates: Certificate[];
  slots: AvailabilitySlot[];
  image?: string;
  /** Extra gallery photos the trainer uploaded, shown on the profile page. */
  photos?: TrainerPhoto[];
  demo: boolean;
};

export type AdminPermissions = {
  manageUsers: boolean;
  reviewTrainers: boolean;
  manageBookings: boolean;
  reviewPayments: boolean;
};

export type AdminOperationsData = {
  currentUserId: number;
  permissions: AdminPermissions;
  summary: {
    activeMembers: number | null;
    activeTrainers: number | null;
    totalBookings: number | null;
    approvedRevenue: number | null;
  };
  users: Array<{
    id: number;
    email: string;
    displayName: string;
    role: UserRole;
    status: "active" | "suspended" | "deleted";
    createdAt: string;
    approvalStatus: TrainerApprovalStatus | null;
    permissions?: AdminPermissions | null;
  }>;
  administrators: Array<{
    id: number;
    email: string;
    displayName: string;
    role: "admin";
    status: "active" | "suspended" | "deleted";
    createdAt: string;
    approvalStatus: null;
    permissions: AdminPermissions;
  }>;
  bookings: Array<{
    id: string;
    memberName: string;
    trainerName: string;
    startsAt: string;
    endsAt: string;
    status: BookingStatus;
    paymentStatus: Booking["paymentStatus"];
    quotedPrice: number | null;
    createdAt: string;
    history: Array<{
      fromStatus: string | null;
      toStatus: string;
      changedBy: string | null;
      note: string | null;
      createdAt: string;
    }>;
  }>;
  payments: Array<{
    id: number;
    bookingId: string;
    memberName: string;
    trainerName: string;
    amount: number | null;
    quotedPrice: number | null;
    status: "reviewing" | "approved" | "rejected";
    submittedAt: string;
    reviewedAt: string | null;
    reviewedBy: string | null;
  }>;
  trainerIncome: Array<{
    trainerId: number;
    trainerName: string;
    paidSessions: number;
    revenue: number;
  }>;
  /** Monthly salary accrual for gym/both trainers (latest 12 months). */
  gymSalaries?: GymSalaryRow[];
  pagination: {
    pageSize: number;
    users: { page: number; total: number };
    administrators: { page: number; total: number };
    bookings: { page: number; total: number };
    payments: { page: number; total: number };
    trainerIncome: { page: number; total: number };
  };
};

export type PublicTrainerReview = {
  rating: number;
  comment: string;
  createdAt: string;
};

export type Booking = {
  /** True for a pre-booking chat room opened from a trainer's profile. */
  inquiry?: boolean;
  paymentServiceMode?: "freelance" | "gym" | null;
  paymentRecipient?: {
    accountName: string;
    promptPayId: string;
    /** The QR image the trainer uploaded; null falls back to a generated one. */
    paymentQrUrl?: string | null;
    /** The trainer's default bank account, for a member who transfers instead. */
    bankAccount?: BankAccountDetails | null;
  } | null;
  id: string;
  trainer: Pick<Trainer, "id" | "displayName" | "slug"> & { imageUrl?: string | null };
  startsAt: string;
  endsAt: string;
  /** Trainer-confirmed window, or null while still `pending_trainer`. */
  confirmedStartsAt?: string | null;
  confirmedEndsAt?: string | null;
  /** Trainer view only: the 12:00 / 18:00 round at which an accepted request reaches the member. */
  confirmationReleaseAt?: string | null;
  /** The originally requested window (`startsAt` before any confirmation change). */
  requestedStartsAt?: string | null;
  cancellationReason?: string | null;
  bookingType?: "single" | "monthly";
  sessionCount?: number;
  periodStart?: string | null;
  periodEnd?: string | null;
  sessions?: Array<{ id: number; startsAt: string; endsAt: string }>;
  status: BookingStatus;
  paymentStatus: "not_submitted" | "reviewing" | "approved" | "rejected";
  paymentDeadlineAt: string | null;
  quotedPrice: number | null;
  chatRoomId: number | null;
  payment: PaymentSummary | null;
  review: ReviewSummary | null;
  actions: BookingActions;
  createdAt: string;
  demo: boolean;
  member?: {
    displayName: string;
    imageUrl?: string | null;
    goals?: string;
    experienceLevel?: string;
    weight?: number | null;
    height?: number | null;
    medicalNote?: string;
  };
  note?: string;
};

export type CreateBookingResponse = {
  id: string;
  status: BookingStatus;
  quotedPrice: number;
  paymentDeadlineAt: string | null;
};

export type NotificationCategory = "all" | "booking" | "payment" | "appointment";

export type NotificationItem = {
  id: number;
  type: string;
  category: Exclude<NotificationCategory, "all">;
  title: string;
  message: string;
  bookingId: string;
  actionPath: string;
  readAt: string | null;
  createdAt: string;
};

export type NotificationListResponse = {
  items: NotificationItem[];
  unread: Record<NotificationCategory, number>;
  pagination: {
    page: number;
    pageSize: 10;
    total: number;
    totalPages: number;
  };
};

export type NotificationDetail = NotificationItem & {
  booking: {
    id: string;
    memberName: string;
    trainerName: string;
    startsAt: string;
    endsAt: string;
    status: BookingStatus;
    paymentStatus: Booking["paymentStatus"];
    quotedPrice: number | null;
    history: Array<{
      fromStatus: string | null;
      toStatus: string;
      note: string | null;
      createdAt: string;
    }>;
  };
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

/** `YYYY-MM` month bucket. */
export type MonthKey = string;

export type GymSalaryRow = {
  trainerId: number;
  trainerName: string;
  month: MonthKey;
  sessions: number;
  amount: number;
};

export type AdminReports = {
  year: number;
  /** 12 buckets for `year`, `01`..`12` in month order. */
  bookingsByMonth: Array<{
    month: MonthKey;
    total: number;
    byStatus: Record<BookingStatus, number>;
  }>;
  /** Sum of `payments.amount` for `approved` payments. */
  incomeByMonth: Array<{ month: MonthKey; amount: number }>;
  paymentsByMonth: Array<{
    month: MonthKey;
    submitted: number;
    approved: number;
    rejected: number;
  }>;
  /** One row per role, per CONTRACT §5.1 (the reports tab iterates rows). */
  usersByRole: Array<{ role: "member" | "trainer" | "admin"; count: number }>;
  totals: {
    bookings: number;
    income: number;
    paymentsSubmitted: number;
    paymentsApproved: number;
    paymentsRejected: number;
    users: number;
  };
};

export type TrainerStats = {
  year: number;
  /** 12 buckets for `year`. */
  bookingsByMonth: Array<{ month: MonthKey; total: number }>;
  incomeByMonth: Array<{ month: MonthKey; amount: number }>;
  totals: { bookings: number; income: number };
  /** Only for `serviceMode` gym/both; null for freelance trainers. */
  salarySummary: Array<{ month: MonthKey; sessions: number; amount: number }> | null;
};

export type BankAccountDetails = {
  bankName: string;
  accountName: string;
  accountNumber: string;
};

export type TrainerBankAccount = BankAccountDetails & {
  id: number;
  isDefault: boolean;
  createdAt: string;
};

export type TrainerPhoto = { id: number; url: string };
