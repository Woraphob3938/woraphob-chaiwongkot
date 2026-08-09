# FitConnect Role Navigation, Trainer Onboarding, and Location Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ทำให้เมนูตรงตามบทบาท เปลี่ยนการสมัครเทรนเนอร์เป็นสองขั้นตอนต่อเนื่องที่กลับมาทำต่อได้ และลบจังหวัดกับสถานที่นัดฝึกออกจาก FitConnect ทุกชั้น

**Architecture:** ใช้โมเดล navigation กลางร่วมกันระหว่าง desktop/mobile และใช้ตัวตัดสินปลายทางหลังยืนยันตัวตนจาก `GET /v1/trainer/me` สำหรับบัญชีเทรนเนอร์ การลบข้อมูลแบ่งเป็นสัญญา province และ booking location ที่ตรวจรับแยกกัน ก่อนใช้ manual migration ที่สำรองและตรวจโครงสร้างฐานข้อมูลจริงล่วงหน้า

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Vitest/Testing Library, PHP 8 ภายใต้ XAMPP, MariaDB/MySQL, PowerShell smoke/migration scripts

## Global Constraints

- ทุกคำสั่ง shell ในสภาพแวดล้อมนี้ต้องขึ้นต้นด้วย `rtk`
- ใช้ TDD: เพิ่ม test → รันให้เห็น RED → แก้ขั้นต่ำ → รัน GREEN ก่อน commit
- เฉพาะสมาชิกเห็น “ค้นหาเทรนเนอร์” และ “การจองของฉัน” ใน desktop/mobile navigation
- บัญชีเทรนเนอร์ที่ `GET /v1/trainer/me` ส่ง `profile: null` ต้องไปขั้นตั้งค่าโปรไฟล์; ห้ามเดาสถานะเมื่อ API ล้มเหลว
- ไม่มีจังหวัด พื้นที่ให้บริการ หรือสถานที่นัดฝึกใน UI, API, TypeScript type, demo data, schema, seed หรือฐานข้อมูลที่ migrate แล้ว
- คงชื่อฟิตเนส รูปแบบการฝึก ราคา วันเวลา slot การอนุมัติ การชำระเงิน แชต และรีวิวตามเดิม
- ไม่เพิ่มแผนที่ พิกัด ที่อยู่ หรือระบบสถานที่ทดแทน
- สำรองฐานข้อมูล XAMPP ก่อน manual migration และห้าม apply เมื่อ preflight พบโครงสร้างแบบครึ่งเก่าครึ่งใหม่
- รักษาไฟล์นอกขอบเขต โดยเฉพาะ `next-env.d.ts`, `.superpowers/` และ `graphify-out/`; ห้าม stage รวม
- หลังคำสั่ง Next.js ให้คืน `next-env.d.ts` เป็น production route import ก่อนตรวจ diff/commit

---

### Task 1: ใช้เมนูตามบทบาทจากแหล่งเดียว

**Files:**
- Create: `lib/role-navigation.ts`
- Create: `lib/role-navigation.test.ts`
- Modify: `components/site-header.tsx`
- Modify: `components/mobile-role-nav.tsx`
- Modify: `components/site-header.test.tsx`
- Modify: `components/site-header.responsive.test.ts`

**Interfaces:**
- Produces: `navigationFor(role: UserRole | null): RoleNavigationItem[]`
- Produces: `RoleNavigationItem = { href: string; label: string; icon: NavigationIcon; desktop: boolean; mobile: boolean }`
- Consumed by: `SiteHeader` และ `MobileRoleNav`

- [ ] **Step 1: เขียน test ของโมเดลเมนูให้ RED**

```ts
import { describe, expect, it } from "vitest";
import { navigationFor } from "@/lib/role-navigation";

const labels = (role: "member" | "trainer" | "admin" | null) =>
  navigationFor(role).map((item) => item.label);

describe("navigationFor", () => {
  it("reserves trainer discovery and member bookings for members", () => {
    expect(labels("member")).toEqual(expect.arrayContaining(["ค้นหาเทรนเนอร์", "การจองของฉัน"]));
    for (const role of [null, "trainer", "admin"] as const) {
      expect(labels(role)).not.toContain("ค้นหาเทรนเนอร์");
      expect(labels(role)).not.toContain("การจองของฉัน");
    }
  });
});
```

- [ ] **Step 2: รัน test เพื่อยืนยัน RED**

Run: `rtk npm test -- lib/role-navigation.test.ts`

Expected: FAIL เพราะยังไม่มี `@/lib/role-navigation`

- [ ] **Step 3: สร้างโมเดลเมนูขั้นต่ำ**

```ts
import type { UserRole } from "@/lib/types";

export type NavigationIcon = "home" | "search" | "bookings" | "workspace" | "chat" | "login" | "register";
export type RoleNavigationItem = {
  href: string;
  label: string;
  icon: NavigationIcon;
  desktop: boolean;
  mobile: boolean;
};

const navigationByAudience: Record<"guest" | UserRole, RoleNavigationItem[]> = {
  guest: [
    { href: "/", label: "หน้าแรก", icon: "home", desktop: false, mobile: true },
    { href: "/login", label: "เข้าสู่ระบบ", icon: "login", desktop: false, mobile: true },
    { href: "/register", label: "สมัครสมาชิก", icon: "register", desktop: false, mobile: true },
  ],
  member: [
    { href: "/", label: "หน้าแรก", icon: "home", desktop: false, mobile: true },
    { href: "/trainers", label: "ค้นหาเทรนเนอร์", icon: "search", desktop: true, mobile: true },
    { href: "/member", label: "การจองของฉัน", icon: "bookings", desktop: true, mobile: true },
    { href: "/chat", label: "แชต", icon: "chat", desktop: false, mobile: true },
  ],
  trainer: [
    { href: "/", label: "หน้าแรก", icon: "home", desktop: false, mobile: true },
    { href: "/trainer", label: "พื้นที่เทรนเนอร์", icon: "workspace", desktop: true, mobile: true },
    { href: "/chat", label: "แชต", icon: "chat", desktop: false, mobile: true },
  ],
  admin: [
    { href: "/", label: "หน้าแรก", icon: "home", desktop: false, mobile: true },
    { href: "/admin", label: "พื้นที่แอดมิน", icon: "workspace", desktop: true, mobile: true },
  ],
};

export function navigationFor(role: UserRole | null) {
  return navigationByAudience[role ?? "guest"];
}
```

- [ ] **Step 4: เชื่อม desktop/mobile และจำกัด search control เฉพาะสมาชิก**

ใน `SiteHeader` ใช้ `navigationFor(user?.role ?? null).filter((item) => item.desktop)` แทน `navItems` เดิม และ render command/search dialog/keyboard shortcut เฉพาะ `user?.role === "member"`

ใน `MobileRoleNav` map `NavigationIcon` ไป Lucide icon แล้วใช้ `navigationFor(user?.role ?? null).filter((item) => item.mobile)` แทน array ที่ประกาศซ้ำ

เพิ่ม component assertions:

```ts
it.each(["trainer", "admin"] as const)("hides member-only navigation from %s", async (role) => {
  localStorage.setItem("fitconnect_user", JSON.stringify(user(role)));
  localStorage.setItem("fitconnect_token", "test-token");
  mockedApiRequest.mockResolvedValue(user(role));
  render(<SiteHeader />);
  await screen.findByRole("button", { name: new RegExp(user(role).displayName) });
  expect(screen.queryByRole("link", { name: "ค้นหาเทรนเนอร์" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "การจองของฉัน" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "เปิดค้นหาเทรนเนอร์" })).not.toBeInTheDocument();
});
```

- [ ] **Step 5: รัน GREEN และ regression เฉพาะ navigation**

Run: `rtk npm test -- lib/role-navigation.test.ts components/site-header.test.tsx components/site-header.responsive.test.ts`

Expected: PASS ทุก test และไม่มีข้อความ member-only ใน role อื่น

- [ ] **Step 6: ตรวจ type/lint/diff และ commit**

```powershell
rtk npm run typecheck
rtk npm run lint
rtk git diff --check
rtk git add lib/role-navigation.ts lib/role-navigation.test.ts components/site-header.tsx components/mobile-role-nav.tsx components/site-header.test.tsx components/site-header.responsive.test.ts
rtk git commit -m "fix: scope navigation to each role"
```

---

### Task 2: พาเทรนเนอร์เข้าสู่ onboarding ต่อเนื่องและกลับมาทำต่อได้

**Files:**
- Create: `lib/post-auth-destination.ts`
- Create: `lib/post-auth-destination.test.ts`
- Create: `components/auth-form.test.tsx`
- Modify: `components/auth-form.tsx`
- Modify: `components/role-dashboard.tsx`
- Modify: `components/role-dashboard.test.tsx`
- Modify: `app/register/page.tsx`
- Modify: `app/trainer/apply/page.tsx`

**Interfaces:**
- Consumes: `AuthenticatedUser`, `TrainerWorkspace`, `authenticatedRequest`
- Produces: `resolvePostAuthDestination(user, loadTrainerWorkspace): Promise<"/member" | "/admin" | "/trainer" | "/trainer/apply">`
- `AuthForm` accepts optional `navigate?: (href: string) => void` only to make redirects observable in tests; production default is `window.location.assign`

- [ ] **Step 1: เขียน resolver tests ให้ RED**

```ts
it("routes an incomplete trainer to profile setup", async () => {
  const destination = await resolvePostAuthDestination(trainerUser, async () => ({
    profile: null,
    certificates: [],
    slots: [],
  }));
  expect(destination).toBe("/trainer/apply");
});

it("routes trainers with any saved profile status to their workspace", async () => {
  const destination = await resolvePostAuthDestination(trainerUser, async () => ({
    profile: { id: 7, slug: "trainer-7", displayName: "เทรนเนอร์", approvalStatus: "pending", approvalNote: null },
    certificates: [],
    slots: [],
  }));
  expect(destination).toBe("/trainer");
});
```

- [ ] **Step 2: รัน RED**

Run: `rtk npm test -- lib/post-auth-destination.test.ts`

Expected: FAIL เพราะ resolver ยังไม่มี

- [ ] **Step 3: สร้าง resolver**

```ts
export async function resolvePostAuthDestination(
  user: AuthenticatedUser,
  loadTrainerWorkspace: () => Promise<TrainerWorkspace>,
) {
  if (user.role === "member") return "/member" as const;
  if (user.role === "admin") return "/admin" as const;
  const workspace = await loadTrainerWorkspace();
  return workspace.profile ? "/trainer" as const : "/trainer/apply" as const;
}
```

- [ ] **Step 4: เขียน AuthForm/RoleDashboard behavior tests ให้ RED**

เพิ่ม test ต่อไปนี้:

- Register trainer เก็บ token/user แล้วเรียก trainer workspace และ navigate `/trainer/apply`
- Login trainer ที่มี pending profile navigate `/trainer`
- workspace lookup ล้มเหลว แสดง `role="alert"` และปุ่ม “ตรวจสถานะอีกครั้ง” โดยยังไม่ navigate
- retry สำเร็จใช้ user/token เดิม ไม่ POST login/register ซ้ำ
- `RoleDashboard role="trainer"` ที่ workspace สำเร็จแต่ `profile: null` replace ไป `/trainer/apply`
- workspace error ห้าม redirect เป็น onboarding

- [ ] **Step 5: เชื่อม resolver กับ AuthForm และ resume guard**

หลังบันทึก token/user:

```ts
const destination = await resolvePostAuthDestination(
  result.user,
  () => authenticatedRequest<TrainerWorkspace>("/v1/trainer/me"),
);
navigate(destination);
```

เก็บ `result.user` ใน state เมื่อการตรวจ trainer workspace ล้มเหลว ปุ่ม retry เรียกเฉพาะ resolver เดิม

ใน `RoleDashboard` redirect เฉพาะเมื่อ `role === "trainer"`, workspace request สำเร็จ และ `workspace.profile === null`; ไม่ redirect ระหว่าง loading/error

เปลี่ยนข้อความ `/trainer/apply` เป็น “ขั้นที่ 2 จาก 2 · ตั้งค่าโปรไฟล์เทรนเนอร์” และปรับ Register copy ให้บอกว่าบัญชีเทรนเนอร์มีขั้นข้อมูลวิชาชีพต่อทันที

- [ ] **Step 6: รัน GREEN และ regression**

Run: `rtk npm test -- lib/post-auth-destination.test.ts components/auth-form.test.tsx components/role-dashboard.test.tsx`

Expected: PASS ทุกสถานะ member/admin/trainer-null/pending/approved/rejected/error/retry

- [ ] **Step 7: ตรวจและ commit**

```powershell
rtk npm run typecheck
rtk npm run lint
rtk git diff --check
rtk git add lib/post-auth-destination.ts lib/post-auth-destination.test.ts components/auth-form.tsx components/auth-form.test.tsx components/role-dashboard.tsx components/role-dashboard.test.tsx app/register/page.tsx app/trainer/apply/page.tsx
rtk git commit -m "feat: resume trainer onboarding after authentication"
```

---

### Task 3: ลบจังหวัดและพื้นที่ให้บริการออกจาก application/catalog contract

**Files:**
- Modify: `backend/index.php`
- Modify: `backend/src/Handlers.php`
- Modify: `backend/database/schema.sql`
- Modify: `backend/database/seed.sql`
- Modify: `lib/types.ts`
- Modify: `lib/api.ts`
- Modify: `lib/api.test.ts`
- Modify: `lib/demo-data.ts`
- Modify: `app/page.tsx`
- Modify: `app/trainers/page.tsx`
- Modify: `components/application-form.tsx`
- Create: `components/application-form.test.tsx`
- Modify: `components/trainer-discovery.tsx`
- Modify: `components/trainer-discovery.test.tsx`
- Modify: `components/trainer-detail.tsx`
- Modify: `components/trainer-detail.test.tsx`
- Modify: `components/trainer-preview-card.tsx`
- Modify: `components/trainer-preview-card.test.tsx`
- Modify: `components/credential-card.tsx`
- Modify: `components/booking-form.tsx`
- Modify: `components/admin-review-queue.tsx`
- Modify: `components/admin-review-queue.test.tsx`
- Modify: `components/site-header.tsx`

**Interfaces:**
- `Trainer` no longer has `province` or `serviceAreas`
- `AdminQueue.trainers[number]` no longer has `province`
- `getReferenceData(): Promise<{ trainingTypes: TrainingType[]; source: "api" | "demo" }>`
- `getLiveTrainerCatalog(): Promise<{ trainers: Trainer[]; trainingTypes: TrainingType[] }>`
- `POST /v1/trainer-applications` multipart fields: `legalName`, `phone`, `serviceMode`, `trainingTypeId`, `experience`, `certificate`

- [ ] **Step 1: เปลี่ยน tests ให้ระบุสัญญาใหม่และรัน RED**

เพิ่ม assertions หลัก:

```ts
expect(screen.queryByLabelText("จังหวัด")).not.toBeInTheDocument();
expect(screen.queryByText(/ทุกจังหวัด|พื้นที่ให้บริการ/)).not.toBeInTheDocument();
expect(submittedFormData.has("provinceId")).toBe(false);
expect(apiRequest).not.toHaveBeenCalledWith("/v1/provinces", expect.anything());
```

ใน discovery test ให้ตรวจว่า query/type/verified filter ยังทำงานและ card ยังแสดงชื่อ ความเชี่ยวชาญ ราคา/สถานะ โดยไม่มีจังหวัด

Run: `rtk npm test -- components/application-form.test.tsx components/trainer-discovery.test.tsx components/trainer-detail.test.tsx components/trainer-preview-card.test.tsx components/admin-review-queue.test.tsx lib/api.test.ts`

Expected: FAIL ที่ props/type/UI/API จังหวัดเดิม

- [ ] **Step 2: ลด TypeScript/API/demo model**

ลบ `Province`, `Trainer.province`, `Trainer.serviceAreas`, `AdminQueue.trainers[].province` และลบ import/export `provinces`

แทน reference loaders ด้วย:

```ts
export async function getReferenceData() {
  try {
    return { trainingTypes: await apiRequest<TrainingType[]>("/v1/training-types"), source: "api" as const };
  } catch {
    return { trainingTypes, source: "demo" as const };
  }
}

export async function getLiveTrainerCatalog() {
  const request: RequestInit = { cache: "no-store" };
  const [liveTrainers, liveTrainingTypes] = await Promise.all([
    apiRequest<Trainer[]>("/v1/trainers", request),
    apiRequest<TrainingType[]>("/v1/training-types", request),
  ]);
  return { trainers: liveTrainers, trainingTypes: liveTrainingTypes };
}
```

- [ ] **Step 3: ลด UI/search/application**

- `ApplicationForm` ลบ province import/select และไม่ append `provinceId`
- `TrainersPage` รับเฉพาะ `q` และ `type`
- `TrainerDiscovery` ลบ province prop/state/filter/select/URL sync/MapPin/copy
- profile/preview/credential/booking/admin ลบ province facts และ accessible labels
- header search เปลี่ยนเป็น “ค้นหาความเชี่ยวชาญหรือชื่อเทรนเนอร์” และลบ “ทุกจังหวัด”
- empty state ใช้ “ลองเปลี่ยนคำค้น ประเภทการฝึก หรือยกเลิกตัวกรองคุณสมบัติ”

- [ ] **Step 4: ลด PHP query/payload/application contract**

ลบ route `/v1/provinces` และ method `provinces()`

ใน application handler:

```php
Http::requireFields($input, ['legalName', 'phone', 'serviceMode', 'trainingTypeId', 'experience']);
```

`INSERT/UPDATE trainer_profiles` ไม่เขียน `primary_province_id`; ลบ lookup provinces และ insert `trainer_service_areas`

query รายชื่อ/รายละเอียด/คิวแอดมินไม่ join `provinces`; `trainerPayload()` ไม่ส่ง `province`, `region`, `serviceAreas`

ครอบ transaction ของใบสมัครเพื่อไม่ทิ้งไฟล์กำพร้า:

```php
$certificate = $this->saveUpload('certificate', ['application/pdf'], 8 * 1024 * 1024, 'certificates');
try {
    $profileId = $this->database->transaction(function (PDO $pdo) use ($user, $input, $certificate): int {
        $existing = $this->database->fetchOne('SELECT id FROM trainer_profiles WHERE user_id = ?', [$user['id']]);
        if ($existing) {
            $profileId = (int) $existing['id'];
            $pdo->prepare(
                'UPDATE trainer_profiles SET legal_name = ?, phone = ?, service_mode = ?, bio = ?, approval_status = "pending", updated_at = UTC_TIMESTAMP() WHERE id = ?'
            )->execute([
                trim((string) $input['legalName']), trim((string) $input['phone']),
                $input['serviceMode'], trim((string) $input['experience']), $profileId,
            ]);
        } else {
            $pdo->prepare(
                'INSERT INTO trainer_profiles (user_id, slug, legal_name, phone, service_mode, bio, approval_status)
                 VALUES (?, ?, ?, ?, ?, ?, "pending")'
            )->execute([
                $user['id'], 'trainer-' . $user['id'], trim((string) $input['legalName']),
                trim((string) $input['phone']), $input['serviceMode'], trim((string) $input['experience']),
            ]);
            $profileId = (int) $pdo->lastInsertId();
        }

        $pdo->prepare('DELETE FROM trainer_training_types WHERE trainer_profile_id = ?')->execute([$profileId]);
        $pdo->prepare('INSERT INTO trainer_training_types (trainer_profile_id, training_type_id) VALUES (?, ?)')
            ->execute([$profileId, (int) $input['trainingTypeId']]);
        $pdo->prepare(
            'INSERT INTO trainer_certificates (trainer_profile_id, name, issuer, file_path, mime_type, status)
             VALUES (?, "เอกสารใบรับรองจากผู้สมัคร", "รอระบุ", ?, ?, "pending")'
        )->execute([$profileId, $certificate['path'], $certificate['mime']]);
        return $profileId;
    });
} catch (Throwable $error) {
    $this->removeUpload($certificate['path']);
    throw $error;
}
```

ตรวจ `trainingTypeId` ก่อนเรียก `saveUpload()` เพื่อไม่สร้างไฟล์เมื่อข้อมูลอ้างอิงไม่ถูกต้อง

- [ ] **Step 5: ปรับ fresh-install schema/seed**

ลบจาก `schema.sql`:

- `CREATE TABLE provinces`
- `member_profiles.home_province_id` และ `fk_member_province`
- `gyms.province_id`, index/fk จังหวัด; เพิ่ม `KEY idx_gyms_status (status)`
- `trainer_profiles.primary_province_id`, index/fk จังหวัด; ใช้ `KEY idx_trainer_discovery (approval_status, updated_at)`
- ตาราง `trainer_service_areas`

ลบ seed จังหวัด, home province, trainer primary province และ service areas โดยคง demo trainers/training types/certificates/slots

- [ ] **Step 6: รัน GREEN, typecheck และ source detector**

```powershell
rtk npm test -- components/application-form.test.tsx components/trainer-discovery.test.tsx components/trainer-detail.test.tsx components/trainer-preview-card.test.tsx components/admin-review-queue.test.tsx lib/api.test.ts
rtk npm run typecheck
rtk npm run lint
rtk rg -n "province|provinces|จังหวัด|primary_province|trainer_service_areas|serviceAreas" app components lib backend/index.php backend/src/Handlers.php backend/database/schema.sql backend/database/seed.sql
```

Expected: tests/type/lint PASS; detector ไม่พบ match ใน source ที่กำหนด

- [ ] **Step 7: ตรวจและ commit**

```powershell
rtk git diff --check
rtk git add backend/index.php backend/src/Handlers.php backend/database/schema.sql backend/database/seed.sql lib/types.ts lib/api.ts lib/api.test.ts lib/demo-data.ts app/page.tsx app/trainers/page.tsx components/application-form.tsx components/application-form.test.tsx components/trainer-discovery.tsx components/trainer-discovery.test.tsx components/trainer-detail.tsx components/trainer-detail.test.tsx components/trainer-preview-card.tsx components/trainer-preview-card.test.tsx components/credential-card.tsx components/booking-form.tsx components/admin-review-queue.tsx components/admin-review-queue.test.tsx components/site-header.tsx
rtk git commit -m "refactor: remove province data from FitConnect"
```

---

### Task 4: ลบสถานที่นัดฝึกออกจาก booking contract

**Files:**
- Modify: `lib/types.ts`
- Modify: `components/booking-form.tsx`
- Modify: `components/booking-form.test.tsx`
- Modify: `components/role-dashboard.tsx`
- Modify: `components/role-dashboard.test.tsx`
- Modify: `components/trainer-workbench.tsx`
- Modify: `components/trainer-workbench.test.tsx`
- Modify: `components/admin-review-queue.tsx`
- Modify: `components/admin-review-queue.test.tsx`
- Modify: `components/chat-workbench.tsx`
- Modify: `components/chat-workbench.test.tsx`
- Modify: `components/payment-panel.test.tsx`
- Modify: `components/review-form.test.tsx`
- Modify: `backend/src/Handlers.php`
- Modify: `backend/database/schema.sql`
- Modify: `backend/database/seed.sql`
- Modify: `scripts/api-workflow-smoke.ps1`
- Modify: `scripts/api-payment-chat-review-smoke.ps1`
- Modify: `backend/database/audit_booking.sql`

**Interfaces:**
- `Booking` no longer has `location`
- `AdminQueue.payments[number]` no longer has `location`
- `POST /v1/bookings` body is `{ trainerId: number; slotId: number; note: string }`
- Booking/admin/chat payloads no longer return `location`

- [ ] **Step 1: เปลี่ยน booking/UI tests ให้ RED**

```ts
expect(screen.queryByLabelText("สถานที่ที่สะดวก")).not.toBeInTheDocument();
expect(authenticatedRequest).toHaveBeenCalledWith("/v1/bookings", {
  method: "POST",
  body: JSON.stringify({ trainerId: 1, slotId: 44, note: "เริ่มฝึกเวท" }),
});
```

ลบ `location` จาก fixtures และเพิ่ม negative assertions ใน member/trainer/admin/chat ว่าไม่มี heading/fact “สถานที่”

Run: `rtk npm test -- components/booking-form.test.tsx components/role-dashboard.test.tsx components/trainer-workbench.test.tsx components/admin-review-queue.test.tsx components/chat-workbench.test.tsx components/payment-panel.test.tsx components/review-form.test.tsx`

Expected: FAIL ที่ field, type, payload และ location facts เดิม

- [ ] **Step 2: ลด frontend types/form/surfaces**

- ลบ `Booking.location` และ `AdminQueue.payments[].location`
- ลบ location state/input/validation/fact จาก `BookingForm`
- stale-slot retry เก็บเฉพาะ note และยังปิด submit จนมี slot ใหม่
- ลบ location row จาก member ledger, trainer cards, admin payment facts และ chat facts
- เปลี่ยน chat empty copy เป็น “เริ่มคุยเรื่องเวลาและการเตรียมตัวได้”

- [ ] **Step 3: ลด PHP booking/admin payload**

ใน `createBooking()`:

```php
Http::requireFields($input, ['trainerId', 'slotId']);
$insert = $pdo->prepare(
    'INSERT INTO bookings (public_id, member_user_id, trainer_profile_id, availability_slot_id, starts_at, ends_at, member_note, status, payment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, "pending_trainer", "not_submitted")'
);
```

ลบ `b.location_text` จาก list/admin SELECT และลบ `location` จาก `bookingPayload()` กับ admin payment mapping

- [ ] **Step 4: ปรับ fresh schema/seed และ smoke/audit fixtures**

- ลบ `bookings.location_text` จาก `schema.sql`
- ลบ column/value จาก booking inserts ใน `seed.sql`
- ลบ `location` จาก request body ใน `api-workflow-smoke.ps1`
- ลบ `location_text` จาก direct SQL inserts ใน `api-payment-chat-review-smoke.ps1`
- ให้ audit query ตรวจ booking/history/payment/chat/review counts โดยไม่ select location

- [ ] **Step 5: รัน GREEN และ detector**

```powershell
rtk npm test -- components/booking-form.test.tsx components/role-dashboard.test.tsx components/trainer-workbench.test.tsx components/admin-review-queue.test.tsx components/chat-workbench.test.tsx components/payment-panel.test.tsx components/review-form.test.tsx
rtk npm run typecheck
rtk npm run lint
rtk rg -n "location_text|booking\.location|payment\.location|สถานที่ที่สะดวก|<span>สถานที่</span>|<dt>สถานที่</dt>" app components lib backend/src/Handlers.php backend/database/schema.sql backend/database/seed.sql scripts
```

Expected: tests/type/lint PASS; detector ไม่พบ location contract เดิม (ข้อความแชตของผู้ใช้อาจมีคำว่า “สถานที่” ได้ แต่ห้ามเป็น field/fact ของ booking)

- [ ] **Step 6: ตรวจและ commit**

```powershell
rtk git diff --check
rtk git add lib/types.ts components/booking-form.tsx components/booking-form.test.tsx components/role-dashboard.tsx components/role-dashboard.test.tsx components/trainer-workbench.tsx components/trainer-workbench.test.tsx components/admin-review-queue.tsx components/admin-review-queue.test.tsx components/chat-workbench.tsx components/chat-workbench.test.tsx components/payment-panel.test.tsx components/review-form.test.tsx backend/src/Handlers.php backend/database/schema.sql backend/database/seed.sql scripts/api-workflow-smoke.ps1 scripts/api-payment-chat-review-smoke.ps1 backend/database/audit_booking.sql
rtk git commit -m "refactor: remove booking location data"
```

---

### Task 5: สร้างและใช้ manual migration แบบสำรองก่อนลบข้อมูล

**Files:**
- Create: `backend/database/manual-migrations/20260810_remove_province_and_booking_location.sql`
- Create: `scripts/migrate-remove-province-location.ps1`
- Create: `scripts/migrate-remove-province-location.test.ps1`
- Create: `scripts/api-trainer-onboarding-smoke.ps1`
- Modify: `package.json`
- Modify: `backend/README.md`

**Interfaces:**
- Produces command: `npm run migrate:remove-location-data`
- Script parameters: `-XamppRoot`, `-DatabaseUser`, `-DatabasePassword`, `-DatabaseName`, `-BackupDirectory`, `-PreflightOnly`, `-SchemaState`
- Produces a timestamped full SQL backup outside the repository before DDL

- [ ] **Step 1: เขียน preflight script test harness ให้ RED**

เพิ่ม `-PreflightOnly` และ `-MySqlExe`/`-MySqlDumpExe` injectable parameters เพื่อทดสอบการตัดสิน state โดยไม่แตะฐานข้อมูลจริง แล้วสร้าง Pester-free PowerShell assertions ใน `scripts/migrate-remove-province-location.test.ps1`:

```powershell
$legacyFailed = $false
try { & $Script -PreflightOnly -SchemaState 'legacy' } catch { $legacyFailed = $true }
if ($legacyFailed) { throw 'legacy schema must be accepted' }

$migratedFailed = $false
try { & $Script -PreflightOnly -SchemaState 'migrated' } catch { $migratedFailed = $true }
if ($migratedFailed) { throw 'migrated schema must be idempotent' }

$partialFailed = $false
try { & $Script -PreflightOnly -SchemaState 'partial' } catch { $partialFailed = $true }
if (-not $partialFailed) { throw 'partial schema must be rejected before DDL' }
```

Run: `rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-remove-province-location.test.ps1`

Expected: FAIL เพราะ migration wrapper ยังไม่มี

- [ ] **Step 2: เขียน idempotent SQL migration**

```sql
USE fitconnect;

DROP TABLE IF EXISTS trainer_service_areas;

ALTER TABLE member_profiles
  DROP FOREIGN KEY IF EXISTS fk_member_province,
  DROP COLUMN IF EXISTS home_province_id;

ALTER TABLE gyms
  DROP FOREIGN KEY IF EXISTS fk_gyms_province,
  DROP INDEX IF EXISTS idx_gyms_province,
  DROP COLUMN IF EXISTS province_id,
  ADD INDEX IF NOT EXISTS idx_gyms_status (status);

ALTER TABLE trainer_profiles
  DROP FOREIGN KEY IF EXISTS fk_trainer_province,
  DROP INDEX IF EXISTS idx_trainer_discovery,
  DROP COLUMN IF EXISTS primary_province_id,
  ADD INDEX IF NOT EXISTS idx_trainer_discovery (approval_status, updated_at);

ALTER TABLE bookings
  DROP COLUMN IF EXISTS location_text;

DROP TABLE IF EXISTS provinces;
```

- [ ] **Step 3: เขียน safe wrapper**

Wrapper ต้อง:

1. Resolve `mysql.exe`, `mysqldump.exe`, migration และ backup directory เป็น absolute paths
2. query `information_schema` สำหรับ 2 ตารางและ 4 คอลัมน์เป้าหมาย
3. ยอมรับเฉพาะ legacy state (พบครบทั้งหมด) หรือ migrated state (ไม่พบทั้งหมด); partial state ต้อง throw ก่อน DDL
4. legacy state ใช้ `mysqldump --single-transaction --routines --triggers --result-file=fitconnect-yyyyMMdd-HHmmss.sql fitconnect`
5. ตรวจว่า backup file มีขนาดมากกว่า 0 ก่อน `SOURCE` migration
6. query postflight ว่าไม่มี targets เหลือ
7. คืน `MYSQL_PWD` ใน `finally` และพิมพ์ path backup ชัดเจน

เพิ่ม package command:

```json
"migrate:remove-location-data": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-remove-province-location.ps1",
"smoke:trainer-onboarding": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-trainer-onboarding-smoke.ps1"
```

onboarding smoke ต้องสร้างอีเมลเทรนเนอร์แบบสุ่ม, ยืนยัน `profile: null`, ส่ง multipart โดยไม่มี `provinceId`, ยืนยัน `pending`, ให้แอดมินปฏิเสธพร้อมเหตุผล, ส่งใหม่จนกลับเป็น `pending`, อนุมัติ และยืนยัน workspace เป็น `approved` โดยใช้ไฟล์ PDF ชั่วคราวที่ลบใน `finally`

- [ ] **Step 4: รัน script tests และ PHP syntax/tests ก่อนฐานข้อมูลจริง**

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-remove-province-location.test.ps1
rtk C:\xampp\php\php.exe -l backend\src\Handlers.php
rtk C:\xampp\php\php.exe -l backend\index.php
rtk npm run test:php
```

Expected: wrapper tests PASS, PHP syntax clean, WorkflowRules 20/20 PASS

- [ ] **Step 5: สำรองและ migrate ฐานข้อมูล XAMPP จริง**

Run: `rtk npm run migrate:remove-location-data`

Expected:

- แสดง path backup ที่อยู่นอก repository
- migration exit 0
- postflight รายงาน province tables/columns และ booking location เป็น 0
- การรันซ้ำรายงาน already migrated และไม่สร้าง DDL ซ้ำ

- [ ] **Step 6: ตรวจ phpMyAdmin contract ด้วย SQL**

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'fitconnect'
  AND (
    table_name = 'provinces'
    OR table_name = 'trainer_service_areas'
    OR column_name IN ('home_province_id', 'province_id', 'primary_province_id', 'location_text')
  );
```

Expected: 0 rows

- [ ] **Step 7: ตรวจ diff และ commit**

```powershell
rtk git diff --check
rtk git add backend/database/manual-migrations/20260810_remove_province_and_booking_location.sql scripts/migrate-remove-province-location.ps1 scripts/migrate-remove-province-location.test.ps1 scripts/api-trainer-onboarding-smoke.ps1 package.json backend/README.md
rtk git commit -m "chore: safely migrate location data out"
```

---

### Task 6: ตรวจ workflow ครบวงจรและปิดงาน

**Files:**
- Modify: `DESIGN.md`
- Create: `.superpowers/sdd/2026-08-10-role-onboarding-location-removal/task-6-report.md` (ignored report; do not stage)

**Interfaces:**
- Consumes: navigation model, post-auth resolver, province-free trainer DTO, location-free booking DTO, migrated database
- Produces: verified end-to-end FitConnect system and audit evidence

- [ ] **Step 1: รัน full automated gate หนึ่งรอบจาก HEAD**

```powershell
rtk npm test
rtk npm run lint
rtk npm run typecheck
rtk npm run build
rtk npm run test:php
rtk C:\xampp\php\php.exe -l backend\src\Handlers.php
rtk C:\xampp\php\php.exe -l backend\index.php
```

Expected: ทุก test PASS, lint/typecheck/build exit 0, build ครบทุก route, PHP syntax/tests PASS

- [ ] **Step 2: เชื่อม XAMPP โดยไม่ import schema ซ้ำและตรวจ health**

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/connect-xampp.ps1 -SkipDatabaseImport
rtk powershell -NoProfile -Command "(Invoke-RestMethod http://localhost/fitconnect-api/v1/health).data | ConvertTo-Json -Depth 5"
```

Expected: API healthy และ database connected

- [ ] **Step 3: รัน workflow smoke/audit ที่ไม่มี location**

```powershell
rtk powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-workflow-smoke.ps1 -Scenario all
rtk npm run smoke:trainer-onboarding
rtk npm run smoke:postbooking
```

Expected:

- trainer approval, slot, booking, payment, chat และ review ผ่าน
- onboarding smoke ผ่าน `profile: null` → rejected → resubmitted pending → approved
- booking request/response ไม่มี `location`
- `smoke:postbooking` เรียก audit ของ booking ที่เพิ่งสร้างเอง และ counts booking/history/payments/rooms/messages/reviews ตรง workflow

- [ ] **Step 4: ตรวจ role/onboarding UI ใน browser แบบจำกัดรอบ**

ตรวจที่ 1280px และ 320px:

- guest ไม่มีเมนูค้นหา/การจองของฉัน
- member มีสองเมนูดังกล่าวและ search control
- trainer/admin ไม่มีเมนูสมาชิก
- trainer profile null ไปขั้น 2; pending/approved/rejected ไป workspace
- discovery/profile/booking/admin/chat ไม่มีจังหวัดหรือ location fact
- ไม่มี horizontal overflow, clipped controls หรือ console error

บันทึกภาพเฉพาะ matrix รอบจริงและหนึ่ง confirmation หากพบ defect

- [ ] **Step 5: ใช้ source/database detectors ปิดช่องตกหล่น**

```powershell
rtk rg -n "province|provinces|จังหวัด|primary_province|trainer_service_areas|serviceAreas|location_text|สถานที่ที่สะดวก" app components lib backend scripts
rtk git diff --check
rtk git status --short
```

Expected: ไม่มี product match ที่ผิดสเปก; ยอมให้คำใน migration/spec/report และข้อความแชตที่ผู้ใช้พิมพ์เองเท่านั้น

- [ ] **Step 6: อัปเดต design ledger และ report**

ใน `DESIGN.md` บันทึก:

- role-owned navigation
- two-step resumable trainer onboarding
- province/location-free transaction contract
- manual migration backup path และผล postflight
- test/build/smoke/audit/browser evidence พร้อมข้อจำกัดจริง

สร้าง ignored report ที่ path ที่ระบุ โดยห้าม stage `.superpowers/`

- [ ] **Step 7: คืน next-env, ตรวจ scope และ commit เอกสาร tracked**

```powershell
rtk git diff -- next-env.d.ts
rtk git add DESIGN.md
rtk git diff --cached --check
rtk git commit -m "docs: finalize role onboarding and data simplification"
rtk git status --short --branch
```

Expected: tracked worktree clean; `.superpowers/` และ `graphify-out/` ยัง unstaged; ไม่มี push จนกว่าผู้ใช้สั่ง
