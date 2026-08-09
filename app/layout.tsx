/* IMPECCABLE CONTRACT · THESIS: FitConnect turns verified trainer credentials and real availability into one continuous booking path. · OWN-WORLD: Thai athlete-accreditation desk; forest structural ink, lime action marks, ruled evidence rows, tabular times. · STORY: Search by specialty → inspect proof → choose availability → submit booking → trainer responds → admin manually verifies payment → chat and review. · FIRST VIEWPORT: A working three-zone discovery bench, not a detached marketing hero. · FORM: Athlete Credential from concept seed e330335f; approved composition #3 plus persistent booking strip from #2. · FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md */
import type { Metadata } from "next";
import { Bai_Jamjuree, Chakra_Petch, JetBrains_Mono } from "next/font/google";
import { PageFooter } from "@/components/page-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const chakra = Chakra_Petch({
  variable: "--font-chakra",
  subsets: ["latin", "thai"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const bai = Bai_Jamjuree({
  variable: "--font-bai",
  subsets: ["latin", "thai"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "FitConnect — หาเทรนเนอร์ที่พร้อมฝึกจริง", template: "%s · FitConnect" },
  description: "ค้นหา ตรวจคุณสมบัติ ดูตาราง และจองเทรนเนอร์ส่วนบุคคลในเส้นทางเดียว",
};

const contract = "IMPECCABLE CONTRACT · THESIS: verified trainer credentials + real availability → continuous booking · OWN-WORLD: Thai athlete-accreditation desk · STORY: discover → inspect → schedule → request → verify payment → chat/review · FIRST VIEWPORT: working three-zone discovery bench · FORM: concept seed e330335f, approved #3 + booking strip #2 · FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md";

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" data-scroll-behavior="smooth" className={`${chakra.variable} ${bai.variable} ${jetbrains.variable}`}>
      <body data-concept-seed="e330335f">
        <template data-impeccable-contract dangerouslySetInnerHTML={{ __html: `<!-- ${contract} -->` }} />
        <a className="skip-link" href="#main-content">ข้ามไปเนื้อหาหลัก</a>
        <SiteHeader />
        <div id="main-content">{children}</div>
        <PageFooter />
      </body>
    </html>
  );
}
