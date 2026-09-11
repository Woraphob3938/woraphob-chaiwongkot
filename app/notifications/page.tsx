import { NotificationCenter } from "@/components/notification-center";

export const metadata = { title: "การแจ้งเตือน" };

export default function NotificationsPage() {
  return (
    <main className="notifications-page">
      <NotificationCenter />
    </main>
  );
}
