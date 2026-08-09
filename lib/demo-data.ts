import type { Booking, Province, Trainer, TrainingType } from "@/lib/types";

export const provinces: Province[] = [
  { id: 1, nameTh: "สกลนคร", region: "ตะวันออกเฉียงเหนือ" },
  { id: 2, nameTh: "นครพนม", region: "ตะวันออกเฉียงเหนือ" },
  { id: 3, nameTh: "อุดรธานี", region: "ตะวันออกเฉียงเหนือ" },
  { id: 4, nameTh: "ขอนแก่น", region: "ตะวันออกเฉียงเหนือ" },
  { id: 5, nameTh: "กรุงเทพมหานคร", region: "กลาง" },
  { id: 6, nameTh: "เชียงใหม่", region: "เหนือ" },
  { id: 7, nameTh: "ชลบุรี", region: "ตะวันออก" },
  { id: 8, nameTh: "ภูเก็ต", region: "ใต้" },
];

export const trainingTypes: TrainingType[] = [
  { id: 1, slug: "strength", nameTh: "เวทเทรนนิง" },
  { id: 2, slug: "weight-loss", nameTh: "ลดไขมัน" },
  { id: 3, slug: "mobility", nameTh: "การเคลื่อนไหว" },
  { id: 4, slug: "functional", nameTh: "ฟังก์ชันนัล" },
  { id: 5, slug: "running", nameTh: "วิ่ง" },
  { id: 6, slug: "rehab", nameTh: "ฟื้นฟูร่างกาย" },
];

function slot(id: number, day: number, hour: number) {
  const startsAt = new Date(Date.UTC(2026, 7, day, hour - 7, 0, 0));
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  return {
    id,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    available: true,
  };
}

export const trainers: Trainer[] = [
  {
    id: 1,
    slug: "demo-trainer-a",
    displayName: "เทรนเนอร์สาธิต ก.",
    headline: "วางรากฐานความแข็งแรงอย่างเป็นระบบ",
    bio: "โปรไฟล์สาธิตสำหรับทดสอบขั้นตอนค้นหา ตรวจคุณสมบัติ และจองเวลาในระบบ FitConnect",
    yearsExperience: 6,
    province: provinces[0],
    serviceAreas: ["อำเภอเมืองสกลนคร", "เดินทางนอกสถานที่"],
    trainingTypes: [trainingTypes[0], trainingTypes[3]],
    serviceMode: "both",
    gymName: "สถานที่ฝึกสาธิต",
    priceFrom: 650,
    reviewCount: 0,
    verification: "verified",
    certificates: [
      { id: 1, name: "ใบรับรองผู้ฝึกสอนส่วนบุคคล (ข้อมูลสาธิต)", issuer: "หน่วยงานสาธิต", issuedYear: 2024, status: "verified" },
      { id: 2, name: "การปฐมพยาบาลเบื้องต้น (ข้อมูลสาธิต)", issuer: "หน่วยงานสาธิต", issuedYear: 2025, status: "verified" },
    ],
    slots: [slot(101, 3, 9), slot(102, 3, 17), slot(103, 4, 18), slot(104, 5, 10)],
    image: "/demo/trainer-a.png",
    demo: true,
  },
  {
    id: 2,
    slug: "demo-trainer-b",
    displayName: "เทรนเนอร์สาธิต ข.",
    headline: "ขยับดีขึ้นก่อนเพิ่มความหนัก",
    bio: "โปรไฟล์สาธิตที่เน้นการเคลื่อนไหวและการฟื้นฟู เพื่อสาธิตการเปรียบเทียบความเชี่ยวชาญ",
    yearsExperience: 4,
    province: provinces[0],
    serviceAreas: ["อำเภอเมืองสกลนคร", "สวนสาธารณะ"],
    trainingTypes: [trainingTypes[2], trainingTypes[5]],
    serviceMode: "freelance",
    priceFrom: 550,
    reviewCount: 0,
    verification: "verified",
    certificates: [
      { id: 3, name: "การเคลื่อนไหวเชิงแก้ไข (ข้อมูลสาธิต)", issuer: "หน่วยงานสาธิต", issuedYear: 2023, status: "verified" },
    ],
    slots: [slot(201, 3, 7), slot(202, 4, 16), slot(203, 5, 8), slot(204, 6, 17)],
    image: "/demo/trainer-b.png",
    demo: true,
  },
  {
    id: 3,
    slug: "demo-trainer-c",
    displayName: "เทรนเนอร์สาธิต ค.",
    headline: "แผนวิ่งและความฟิตที่เข้ากับชีวิตจริง",
    bio: "โปรไฟล์สาธิตสำหรับการค้นหาเทรนเนอร์ตามประเภทการฝึก และช่วงเวลาว่าง",
    yearsExperience: 5,
    province: provinces[1],
    serviceAreas: ["อำเภอเมืองนครพนม", "ริมโขง"],
    trainingTypes: [trainingTypes[1], trainingTypes[4]],
    serviceMode: "freelance",
    reviewCount: 0,
    verification: "pending",
    certificates: [
      { id: 4, name: "ผู้ฝึกสอนการวิ่ง (ข้อมูลสาธิต)", issuer: "หน่วยงานสาธิต", issuedYear: 2025, status: "pending" },
    ],
    slots: [slot(301, 4, 6), slot(302, 5, 18), slot(303, 6, 6)],
    image: "/demo/trainer-c.png",
    demo: true,
  },
];

export const demoBookings: Booking[] = [
  {
    id: "BK-DEMO-001",
    trainer: { id: 1, displayName: trainers[0].displayName, slug: trainers[0].slug },
    startsAt: trainers[0].slots[1].startsAt,
    endsAt: trainers[0].slots[1].endsAt,
    location: "สถานที่ฝึกสาธิต · สกลนคร",
    status: "payment_review",
    paymentStatus: "reviewing",
    quotedPrice: 850,
    chatRoomId: null,
    payment: {
      id: 1,
      amount: 850,
      status: "reviewing",
      reviewNote: null,
      submittedAt: "2026-07-30T03:25:00.000Z",
    },
    review: null,
    actions: {
      canPay: false,
      canReadChat: true,
      canSendChat: true,
      canComplete: false,
      canReview: false,
    },
    createdAt: "2026-07-30T03:20:00.000Z",
    demo: true,
  },
];
