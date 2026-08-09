import Link from "next/link";
import { TrainerDiscovery } from "@/components/trainer-discovery";
import { getLiveTrainerCatalog } from "@/lib/api";

type Props = { searchParams: Promise<{ q?: string; type?: string }> };

export const metadata = { title: "ค้นหาเทรนเนอร์" };

export default async function TrainersPage({ searchParams }: Props) {
  const params = await searchParams;
  let catalog: Awaited<ReturnType<typeof getLiveTrainerCatalog>> | null = null;
  let loadError = "";
  try {
    catalog = await getLiveTrainerCatalog();
  } catch (error) {
    loadError = error instanceof Error ? error.message : "บริการค้นหาเทรนเนอร์ยังไม่พร้อมใช้งาน";
  }

  if (catalog) {
    return (
      <main className="page-shell home-shell">
        <TrainerDiscovery
          initialTrainers={catalog.trainers}
          trainingTypes={catalog.trainingTypes}
          isDemo={catalog.trainers.some((trainer) => trainer.demo)}
          initialQuery={params.q}
          initialType={params.type}
        />
      </main>
    );
  }

  return (
    <main className="page-shell home-shell">
      <div className="catalog-unavailable" role="alert">
        <h1>ยังเปิดรายชื่อเทรนเนอร์ไม่ได้</h1>
        <p>{loadError}</p>
        <Link className="button button--dark" href="/trainers">ลองโหลดข้อมูลอีกครั้ง</Link>
      </div>
    </main>
  );
}
