import { NotificationCenter } from "@/components/notification-center";

export const metadata = { title: "การแจ้งเตือน" };

export default function NotificationsPage() {
  return (
    <main className="notifications-page">
      <h1 className="sr-only">การแจ้งเตือน</h1>
      <NotificationCenter />
    </main>
  );
}
