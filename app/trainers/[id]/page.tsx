import { notFound } from "next/navigation";
import { TrainerDetail } from "@/components/trainer-detail";
import { getTrainer } from "@/lib/api";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const result = await getTrainer(id);
  return { title: result.data?.displayName ?? "ไม่พบเทรนเนอร์" };
}

export default async function TrainerPage({ params }: Props) {
  const { id } = await params;
  const result = await getTrainer(id);
  if (!result.data) notFound();
  return <main className="page-shell profile-shell"><TrainerDetail trainer={result.data} /></main>;
}
