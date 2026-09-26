import { HomeOverview } from "@/components/home-overview";
import { getReferenceData, getTrainers } from "@/lib/api";

export default async function HomePage() {
  const [trainerResult, reference] = await Promise.all([getTrainers(), getReferenceData()]);
  return (
    <main className="page-shell home-overview-shell">
      <HomeOverview
        trainers={trainerResult.data}
        trainingTypes={reference.trainingTypes}
      />
    </main>
  );
}
