import { BookingForm } from "@/components/booking-form";

type Props = { searchParams: Promise<{ trainer?: string; slot?: string; type?: string; slots?: string }> };
export const metadata = { title: "ส่งคำขอจอง" };
export default async function BookingPage({ searchParams }: Props) {
  const params = await searchParams;
  return <main className="page-shell form-page"><section className="compact-page-heading"><p className="workflow-current">ขั้นตอนที่ 1 จาก 4</p><h1>ส่งคำขอจอง</h1><p>ตรวจรายละเอียดแล้วส่งคำขอ เมื่อเทรนเนอร์ตอบรับ ระบบจะแจ้งยืนยันให้คุณในรอบ 12:00 หรือ 18:00 น. เวลาฝึกยังเป็นเวลาที่คุณเลือก จากนั้นคุณมีเวลา 10 นาทีสำหรับชำระเงิน</p></section><BookingForm trainerSlug={params.trainer} slotId={params.slot} bookingType={params.type === "monthly" ? "monthly" : "single"} slotIds={params.slots} /></main>;
}
