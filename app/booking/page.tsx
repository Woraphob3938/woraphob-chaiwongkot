import { BookingForm } from "@/components/booking-form";

type Props = { searchParams: Promise<{ trainer?: string; slot?: string }> };
export const metadata = { title: "ยืนยันการจอง" };
export default async function BookingPage({ searchParams }: Props) {
  const params = await searchParams;
  return <main className="page-shell form-page"><section className="compact-page-heading"><p className="workflow-current">ขั้นตอนปัจจุบัน: ยืนยันการจอง</p><h1>ทบทวนก่อนล็อกเวลา</h1><p>เมื่อยืนยัน ระบบจะเก็บเวลานี้ไว้ให้คุณชำระเงินภายใน 10 นาที</p></section><BookingForm trainerSlug={params.trainer} slotId={params.slot} /></main>;
}
