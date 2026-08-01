import { ChatWorkbench } from "@/components/chat-workbench";

export const metadata = { title: "การสนทนา" };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const { booking } = await searchParams;
  return (
    <main className="page-shell chat-page">
      <section className="compact-page-heading"><h1>การสนทนาและรายละเอียดนัดหมาย</h1></section>
      <ChatWorkbench initialBookingId={booking} />
    </main>
  );
}
