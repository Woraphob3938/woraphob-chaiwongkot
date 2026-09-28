/* IMPECCABLE CONTRACT · THESIS: FitConnect turns verified trainer credentials and real availability into one continuous booking path. · OWN-WORLD: Thai athlete-accreditation desk; forest structural ink, lime action marks, ruled evidence rows, tabular times. · STORY: Search by specialty → inspect proof → choose availability → submit booking → trainer responds → admin manually verifies payment → chat and review. · FIRST VIEWPORT: A working three-zone discovery bench, not a detached marketing hero. · FORM: Athlete Credential from concept seed e330335f; approved composition #3 plus persistent booking strip from #2. · FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md */
import type { Metadata } from "next";
import localFont from "next/font/local";
import { PageFooter } from "@/components/page-footer";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

// Font files live in app/fonts (SIL OFL, from github.com/google/fonts) so the
// build and dev server never depend on reaching Google Fonts.
const chakra = localFont({
  variable: "--font-chakra",
  src: [
    { path: "./fonts/chakra-petch/ChakraPetch-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/chakra-petch/ChakraPetch-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/chakra-petch/ChakraPetch-Bold.ttf", weight: "700", style: "normal" },
  ],
  display: "swap",
});

const bai = localFont({
  variable: "--font-bai",
  src: [
    { path: "./fonts/bai-jamjuree/BaiJamjuree-Regular.ttf", weight: "400", style: "normal" },
    { path: "./fonts/bai-jamjuree/BaiJamjuree-Medium.ttf", weight: "500", style: "normal" },
    { path: "./fonts/bai-jamjuree/BaiJamjuree-SemiBold.ttf", weight: "600", style: "normal" },
    { path: "./fonts/bai-jamjuree/BaiJamjuree-Bold.ttf", weight: "700", style: "normal" },
  ],
  display: "swap",
});

const jetbrains = localFont({
  variable: "--font-jetbrains",
  src: "./fonts/jetbrains-mono/JetBrainsMono-Variable.ttf",
  weight: "100 800",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: { default: "FitConnect — หาเทรนเนอร์ที่พร้อมฝึกจริง", template: "%s · FitConnect" },
  description: "ค้นหา ตรวจคุณสมบัติ ดูตาราง และจองเทรนเนอร์ส่วนบุคคลในเส้นทางเดียว",
};

const contract = "IMPECCABLE CONTRACT · THESIS: verified trainer credentials + real availability → continuous booking · OWN-WORLD: Thai athlete-accreditation desk · STORY: discover → inspect → schedule → request → verify payment → chat/review · FIRST VIEWPORT: working three-zone discovery bench · FORM: concept seed e330335f, approved #3 + booking strip #2 · FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md";

const sessionBootstrapScript = `(function(){try{var t=localStorage.getItem("fitconnect_token"),u=localStorage.getItem("fitconnect_user");document.documentElement.dataset.fitconnectSession=t&&u?"authenticated":"guest"}catch(e){document.documentElement.dataset.fitconnectSession="guest"}})()`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" data-scroll-behavior="smooth" data-fitconnect-session="guest" suppressHydrationWarning className={`${chakra.variable} ${bai.variable} ${jetbrains.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: sessionBootstrapScript }} />
      </head>
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
