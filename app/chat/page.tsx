import { ChatWorkbench } from "@/components/chat-workbench";

export const metadata = { title: "การสนทนา" };

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const { booking } = await searchParams;
  return (
    <main className="chat-page">
      <h1 className="sr-only">การสนทนา</h1>
      <ChatWorkbench initialBookingId={booking} />
    </main>
  );
}
