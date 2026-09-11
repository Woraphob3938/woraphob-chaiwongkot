import { notFound } from "next/navigation";
import Link from "next/link";
import { TrainerDetail } from "@/components/trainer-detail";
import { getTrainer } from "@/lib/api";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ returnTo?: string | string[] }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const result = await getTrainer(id);
  return { title: result.error ? "โหลดข้อมูลเทรนเนอร์ไม่สำเร็จ" : result.data?.displayName ?? "ไม่พบเทรนเนอร์" };
}

export default async function TrainerPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  const backHref = typeof returnTo === "string" && (returnTo === "/trainers" || returnTo.startsWith("/trainers?")) ? returnTo : "/trainers";
  const result = await getTrainer(id);
  if (result.error) {
    return (
      <main className="page-shell profile-shell">
        <section className="empty-state" role="alert">
          <h1>โหลดข้อมูลเทรนเนอร์ไม่สำเร็จ</h1>
          <p>ยังแสดงราคา รีวิว และเวลาว่างไม่ได้ กรุณาลองใหม่อีกครั้ง</p>
          <a className="button button--accent" href={`/trainers/${encodeURIComponent(id)}?returnTo=${encodeURIComponent(backHref)}`}>ลองใหม่</a>
          <Link className="button" href={backHref}>กลับไปค้นหาเทรนเนอร์</Link>
        </section>
      </main>
    );
  }
  if (!result.data) notFound();
  return <main className="page-shell profile-shell"><TrainerDetail trainer={result.data} returnTo={backHref} /></main>;
}
