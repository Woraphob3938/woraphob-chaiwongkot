---
timestamp: 2026-08-14T16-22-26Z
slug: components-notification-center-tsx
target: หน้าการแจ้งเตือนของสมาชิกและเทรนเนอร์
total_score: 25
max_score: 40
na_heuristics: ""
p0_count: 0
p1_count: 2
---
Method: dual-agent (A: /root/notification_design_review · B: /root/notification_detector_evidence)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3/4 | มีสถานะโหลดและอ่านแล้ว แต่การรีเฟตช์ถอดพื้นที่ทำงานทั้งชุดออก |
| 2 | Match system / real world | 2/4 | ภาษาไทยส่วนใหญ่ชัด แต่ข้อผิดพลาดพาผู้ใช้ไปแก้ Apache/MySQL โดยไม่แยกสาเหตุ |
| 3 | User control and freedom | 2/4 | มีตัวกรองและปุ่มกลับบนมือถือ แต่การกู้คืนจาก empty state อาจไม่เปลี่ยนอะไร |
| 4 | Consistency and standards | 3/4 | โทนสี ตัวอักษร เส้น และ native controls สม่ำเสมอ |
| 5 | Error prevention | 3/4 | ป้องกัน stale request และลิงก์ภายในไม่ปลอดภัยแล้ว แต่เปิดรายการแล้วถือว่าอ่านทันที |
| 6 | Recognition rather than recall | 3/4 | หมวดและข้อมูลนัดหมายมองเห็นได้ แต่หมวดท้ายบนมือถือถูกซ่อนและ CTA กว้างเกินไป |
| 7 | Flexibility and efficiency | 2/4 | มีกรองยังไม่อ่านและทำเครื่องหมายทั้งหมด แต่ยังไม่มีทางลัดหรือการจัดการรายรายการที่รวดเร็ว |
| 8 | Aesthetic and minimalist design | 3/4 | หน้าสะอาด แต่ลำดับชั้นบางช่วงเบาเกินไปและหัวข้อหลักไม่แสดงผล |
| 9 | Error recovery | 2/4 | รายการหลักมีลองใหม่ แต่รายละเอียดล้มเหลวไม่มีปุ่มลองใหม่โดยตรง |
| 10 | Help and documentation | 2/4 | empty state มีคำอธิบาย แต่หมวดและขั้นตอนถัดไปยังไม่ชัดพอ |
| **Total** | | **25/40** | **Acceptable — ควรแก้ประเด็นหลักก่อนส่งมอบ** |

## Design Specificity Verdict

**LLM assessment:** ข้อมูลและภาษาภาพเป็น FitConnect ชัดเจนจากสีเขียวเข้ม/ไลม์ ตัวอักษร และรายละเอียดการจอง/ชำระเงิน แต่โครงสร้าง master-detail และ CTA ยังเป็นแบบทั่วไปที่ใช้กับระบบงานอื่นได้เกือบทั้งหมด ความเร่งด่วนและ “สิ่งที่สมาชิกหรือเทรนเนอร์ต้องทำต่อ” ยังไม่เด่นพอ

**Deterministic scan:** ตัวตรวจ Impeccable คืน `[]` — 0 findings, ไม่มี false positive. การตรวจหน้าจริงยืนยันว่า 1280px และ 375px ไม่มี document overflow และปุ่มที่มองเห็นมีความสูงอย่างน้อย 44px

**Visual overlays:** ไม่มีการฉีด overlay และไม่ได้อ้างว่ามี overlay แสดงในเบราว์เซอร์ หลักฐานทดแทนคือภาพหน้าจริงและ request stub แบบชั่วคราว

## Overall Impression

พื้นฐานแข็งแรงและดูน่าเชื่อถือ โดยเฉพาะโครงสร้าง semantic กับรายละเอียดการจอง แต่โอกาสใหญ่ที่สุดคือทำให้หน้าไม่ใช่แค่ “กล่องข้อความ” — ผู้ใช้ควรรู้ทันทีว่าเหตุการณ์นี้สำคัญแค่ไหนและต้องทำอะไรต่อ โดยไม่เสียตำแหน่งระหว่างโหลด

## What's Working

- โครงสร้างเข้าถึงได้ดี: named regions/navigation, list, description list, semantic time, live announcements, visible focus และ reduced motion
- รายละเอียดรวมข้อมูลที่ใช้ตัดสินใจไว้ครบ ทั้งบุคคล เวลา สถานะการจอง การชำระ ราคา และประวัติ
- Responsive foundation ดี: desktop สามคอลัมน์, tablet สองคอลัมน์, mobile สลับ list/detail; ไม่พบหน้าล้น และ touch target ผ่าน 44px

## Priority Issues

### [P1] ผู้ใช้ที่ยังไม่เข้าสู่ระบบได้รับคำแนะนำผิดสาเหตุ

**Why it matters:** เมื่อ API ตอบ 401 หน้ากลับบอกให้ตรวจ Apache และ MySQL ผู้ใช้ทั่วไปไม่ควรถูกส่งไปแก้ระบบเซิร์ฟเวอร์ และจะคิดว่าเว็บเสีย

**Fix:** แยก 401, network และ server failure; 401 แสดง “กรุณาเข้าสู่ระบบ” พร้อมลิงก์เข้าสู่ระบบ ส่วน network/server จึงค่อยใช้ข้อความบริการไม่พร้อม

**Suggested command:** `$impeccable harden`

### [P1] เปลี่ยนหมวดหรือหน้าแล้วพื้นที่ทำงานหายทั้งชุด

**Why it matters:** control ที่ผู้ใช้กดถูก unmount ระหว่างโหลด ทำให้ focus หาย บริบทกระพริบ และผู้ใช้มือถือหรือคีย์บอร์ดต้องเริ่มหาใหม่

**Fix:** คง toolbar/category rail ไว้ตลอด ตั้ง `aria-busy` เฉพาะรายการ และใช้ skeleton ใน list pane แทนการแทนทั้งหน้า

**Suggested command:** `$impeccable harden`

### [P2] สถานะสำคัญและขั้นตอนถัดไปยังไม่เด่น

**Why it matters:** สถานะการจอง/ชำระเงินเป็นข้อความธรรมดา และ CTA “เปิดรายการที่เกี่ยวข้อง” ไม่บอกปลายทาง สมาชิกและเทรนเนอร์ต้องอ่านรายละเอียดเองเพื่อเดาว่าควรทำอะไร

**Fix:** ใช้ status badge ที่สอดคล้องกับระบบ และตั้ง CTA ตามเหตุการณ์/บทบาท เช่น “ส่งหลักฐานการชำระเงิน”, “ดูตารางนัดหมาย”, “เขียนรีวิว” พร้อมแสดงหัวข้อหน้าที่มองเห็นได้

**Suggested command:** `$impeccable clarify`

### [P2] ตัวกรองและหมวดมีทางตันหรือถูกซ่อนบนมือถือ

**Why it matters:** “ดูทั้งหมด” เป็น no-op เมื่ออยู่หมวดทั้งหมดและไม่ปิด unread-only; badge count ถูก `aria-label` กลบ; หมวด “นัดหมาย” อยู่นอก viewport โดยไม่มีสัญญาณเลื่อนชัด

**Fix:** ให้ empty-state reset ทั้ง category และ unread filter, รวมจำนวนไว้ใน accessible name/description และทำ category rail ให้เห็นส่วนของรายการถัดไปหรือเปลี่ยนเป็น select/compact tabs บนจอแคบ

**Suggested command:** `$impeccable adapt`

### [P2] การกู้คืนจากข้อผิดพลาดยังไม่สม่ำเสมอ

**Why it matters:** รายการหลักมีปุ่มลองใหม่ แต่รายละเอียดไม่มี และความล้มเหลวของ “อ่านแล้วทั้งหมด” ถูกประกาศให้ screen reader เท่านั้น ผู้ใช้สายตาปกติอาจไม่รู้ว่าไม่สำเร็จ

**Fix:** เพิ่ม retry ใน detail pane และแสดง feedback ที่มองเห็นได้สำหรับ bulk failure โดยคง live announcement ไว้

**Suggested command:** `$impeccable harden`

## Persona Red Flags

**Alex (Power User):** การรีเฟตช์ทำให้ focus หาย ไม่มี shortcut หรือการจัดการรายรายการเร็ว และ batch action มีเพียง “อ่านแล้วทั้งหมด”

**Sam (Accessibility-dependent):** semantic/focus ดี แต่ unread counts ถูก aria-label กลบ, control หายระหว่างโหลด และ bulk error มองไม่เห็นด้วยสายตา

**Casey (Distracted Mobile User):** หมวด “นัดหมาย” ซ่อนอยู่ปลาย horizontal rail, filter chrome ยังคงกินพื้นที่เมื่ออ่านรายละเอียด และ bulk action อยู่บนสุดไกลจาก thumb zone

## Minor Observations

- หัวข้อ H1 ของหน้าเป็น `sr-only` จึงไม่มี visual anchor
- “การจอง” และ “นัดหมาย” ใช้ไอคอนเดียวกัน ทำให้แยกหมวดยาก
- รหัสการจองอาจซ้ำทั้งในข้อความและบรรทัด code
- ข้อความรายการ desktop ถูกบีบเป็นบรรทัดเดียว แม้บางจังหวะยังมีพื้นที่
- การตรวจสดพบ member inbox ว่าง ส่วน trainer มีหนึ่งรายการอ่านแล้ว จึงยังไม่ได้ทดสอบ pagination และ member detail ด้วยข้อมูลจริง

## Questions to Consider

- ควรจัดการแจ้งเตือนตามชนิด event ของ backend หรือตามการตัดสินใจถัดไปของผู้ใช้ เช่น “ต้องชำระ”, “เตรียมฝึก”, “เขียนรีวิว”?
- ภายในห้าวินาทีแรก สมาชิกหรือเทรนเนอร์ควรเห็นสถานะหรือ action ใดชัดที่สุด?
- เหตุการณ์เร่งด่วนควรแสดงความเร่งด่วนอย่างไรนอกจากเรียงตามเวลา?
