import { TrainerDiscovery } from "@/components/trainer-discovery";
import { getReferenceData, getTrainers } from "@/lib/api";

export default async function HomePage() {
  const [trainerResult, reference] = await Promise.all([getTrainers(), getReferenceData()]);
  return (
    <main className="page-shell home-shell">
      <TrainerDiscovery
        initialTrainers={trainerResult.data}
        provinces={reference.provinces}
        trainingTypes={reference.trainingTypes}
        isDemo={trainerResult.source === "demo" || reference.source === "demo" || trainerResult.data.some((trainer) => trainer.demo)}
      />
    </main>
  );
}
