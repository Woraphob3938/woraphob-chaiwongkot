import { TrainerDiscovery } from "@/components/trainer-discovery";
import { getReferenceData, getTrainers } from "@/lib/api";

type Props = { searchParams: Promise<{ q?: string; province?: string; type?: string }> };

export const metadata = { title: "ค้นหาเทรนเนอร์" };

export default async function TrainersPage({ searchParams }: Props) {
  const [params, trainerResult, reference] = await Promise.all([searchParams, getTrainers(), getReferenceData()]);
  return (
    <main className="page-shell home-shell">
      <TrainerDiscovery
        initialTrainers={trainerResult.data}
        provinces={reference.provinces}
        trainingTypes={reference.trainingTypes}
        isDemo={trainerResult.source === "demo" || reference.source === "demo" || trainerResult.data.some((trainer) => trainer.demo)}
        initialQuery={params.q}
        initialProvince={params.province}
        initialType={params.type}
      />
    </main>
  );
}
