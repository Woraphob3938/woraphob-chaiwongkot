import { MemberOnboarding } from "@/components/member-onboarding";

export const metadata = { title: "ยินดีต้อนรับสมาชิกใหม่" };
export default async function MemberWelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="page-shell form-page">
      <MemberOnboarding next={next} />
    </main>
  );
}
