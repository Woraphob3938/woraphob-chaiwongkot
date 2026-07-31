import { BookingForm } from "@/components/booking-form";

type Props = { searchParams: Promise<{ trainer?: string; slot?: string }> };
export const metadata = { title: "ส่งคำขอจอง" };
export default async function BookingPage({ searchParams }: Props) {
  const params = await searchParams;
  return <main className="page-shell form-page"><section className="compact-page-heading"><p className="workflow-current">ขั้นตอนปัจจุบัน: ส่งคำขอจอง</p><h1>ทบทวนก่อนส่ง</h1><p>ยังไม่มีการเรียกเก็บเงินในขั้นตอนนี้ เทรนเนอร์ต้องตอบรับคำขอก่อน</p></section><BookingForm trainerSlug={params.trainer} slotId={params.slot} /></main>;
}
