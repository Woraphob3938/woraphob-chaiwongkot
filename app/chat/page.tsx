import { ChatDemo } from "@/components/chat-demo";
import { DemoNotice } from "@/components/demo-notice";

export const metadata = { title: "การสนทนา" };
export default function ChatPage() { return <main className="page-shell chat-page"><section className="compact-page-heading"><h1>นัดหมายให้ชัดก่อนเริ่มฝึก</h1></section><DemoNotice /><ChatDemo /></main>; }
