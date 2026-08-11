# Member and Trainer Account Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** สร้างหน้า `/profile` ที่สมาชิกและเทรนเนอร์ดูและแก้ข้อมูลจริง เปลี่ยนรูป และเปลี่ยนรหัสผ่านได้ โดยใช้ UI ของ FitConnect และข้อมูลสมาชิกตามบทที่ 3

**Architecture:** ใช้ route เดียวและ Client Component เดียวเป็นตัวโหลดข้อมูล จากนั้นประกอบฟอร์มย่อยตาม discriminated union `role`. PHP API อ่าน user id จาก bearer token เท่านั้น ใช้ตารางเดิมและ migration เพิ่มเฉพาะคอลัมน์สมาชิกที่ขาด รูปเก็บใน upload root เดิมและเปิดผ่าน endpoint ที่ตรวจ path ก่อนส่งไฟล์

**Tech Stack:** Next.js 16.3 App Router, React 19, TypeScript 6, Vitest/Testing Library, shadcn/Radix primitives ที่ติดตั้งแล้ว, PHP 8, PDO, MariaDB/XAMPP, PowerShell smoke tests

## Global Constraints

- เส้นทางบัญชีร่วมคือ `/profile` และรองรับเฉพาะ `member` กับ `trainer`
- อีเมลเป็น read-only และการบันทึกห้ามรับ user id เป้าหมายจาก client
- ไม่เพิ่มเพศ วันเกิด จังหวัด พื้นที่ให้บริการ สถานที่นัดฝึก ที่อยู่ หรือสัญชาติ
- ไม่เปิดแก้ `medical_note`; ต้องรักษาค่าเดิมไว้
- รูปรองรับ JPG, PNG และ WebP ไม่เกิน 5 MB
- ไม่มีการบันทึกอัตโนมัติ
- ไม่เพิ่ม dependency ใหม่และไม่สร้าง settings framework
- ปุ่มและช่องควบคุมสูงอย่างน้อย 44px
- ตรวจที่ 1280, 768, 414, 375 และ 320px รวม 200% zoom, keyboard และ reduced motion
- ไม่เปลี่ยนกติกาการจอง การชำระเงิน แชต รีวิว หรือการอนุมัติเทรนเนอร์
- คงการแก้ไข `next-env.d.ts`, `.superpowers/` และ `graphify-out/` ที่มีอยู่ก่อนงานนี้ไว้นอกทุก commit

## File Map

- `backend/database/schema.sql` - schema สำหรับติดตั้งใหม่
- `backend/database/manual-migrations/20260811_add_member_profile_fields.sql` - DDL แบบ idempotent สำหรับฐานเดิม
- `scripts/migrate-member-profile.ps1` - preflight, backup, apply และ postflight
- `scripts/migrate-member-profile.test.ps1` - ตรวจ legacy/migrated/partial state
- `backend/src/ProfileRules.php` - normalize และ validation ที่ทดสอบแยกได้
- `backend/tests/ProfileRulesTest.php` - unit tests ของกติกาโปรไฟล์
- `backend/src/Auth.php` - ตรวจรหัสเดิม เปลี่ยน hash และยกเลิก token อื่น
- `backend/src/Handlers.php` - handlers ของข้อมูลโปรไฟล์ รูป และรหัสผ่าน
- `backend/index.php` - route dispatch ของ profile endpoints
- `scripts/api-profile-smoke.ps1` - ทดสอบ API กับ XAMPP และตรวจฐานข้อมูลจริง
- `lib/types.ts` - discriminated union ของ payload สมาชิก/เทรนเนอร์
- `lib/api.ts` - helper URL สำหรับรูปจาก PHP API
- `lib/role-navigation.ts` และ test - เมนูโปรไฟล์ตามบทบาท
- `components/site-header.tsx` และ test - ลิงก์เมนูบัญชี รูป และการ sync session
- `app/profile/page.tsx` - route และ metadata
- `components/profile-workbench.tsx` - loading/error/role gate และโครงหน้า
- `components/profile-identity.tsx` - avatar, upload preview และ role badge
- `components/member-profile-form.tsx` - ฟอร์มสมาชิก
- `components/trainer-account-form.tsx` - ฟอร์มข้อมูลวิชาชีพและข้อมูล read-only
- `components/password-form.tsx` - เปลี่ยนรหัสผ่าน
- `components/profile-workbench.test.tsx` - integration tests ของหน้า
- `components/profile-identity.test.tsx`, `components/member-profile-form.test.tsx`, `components/trainer-account-form.test.tsx`, `components/password-form.test.tsx` - focused component tests
- `app/globals.css` - layout และ responsive hooks ของหน้าโปรไฟล์
- `package.json` - migration, PHP test และ smoke scripts

---

### Task 1: Safe member-profile migration

**Files:**
- Modify: `backend/database/schema.sql:24-34`
- Create: `backend/database/manual-migrations/20260811_add_member_profile_fields.sql`
- Create: `scripts/migrate-member-profile.ps1`
- Create: `scripts/migrate-member-profile.test.ps1`
- Modify: `package.json:scripts`

**Interfaces:**
- Produces: nullable columns `first_name`, `last_name`, `experience_level`, `weight`, `height`, `image_path` on `member_profiles`
- Preserves: `phone`, `goals`, `medical_note`, timestamps และทุกแถวเดิม

- [ ] **Step 1: Write the migration preflight test**

```powershell
$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'migrate-member-profile.ps1'

foreach ($accepted in @('legacy', 'migrated')) {
    & $scriptPath -PreflightOnly -SchemaState $accepted
    if ($LASTEXITCODE -ne 0) { throw "$accepted schema must be accepted" }
}

$partialAccepted = $true
try { & $scriptPath -PreflightOnly -SchemaState 'partial' } catch { $partialAccepted = $false }
if ($partialAccepted) { throw 'partial schema must be rejected before DDL' }
Write-Output 'PASS member profile migration preflight checks'
```

- [ ] **Step 2: Run the preflight test and verify RED**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-member-profile.test.ps1`

Expected: FAIL because `scripts/migrate-member-profile.ps1` does not exist.

- [ ] **Step 3: Add the schema and idempotent migration SQL**

Add these columns to the `member_profiles` definition and the manual migration:

```sql
ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS first_name VARCHAR(100) NULL AFTER user_id,
  ADD COLUMN IF NOT EXISTS last_name VARCHAR(100) NULL AFTER first_name,
  ADD COLUMN IF NOT EXISTS experience_level VARCHAR(50) NULL AFTER goals,
  ADD COLUMN IF NOT EXISTS weight DECIMAL(5,2) NULL AFTER experience_level,
  ADD COLUMN IF NOT EXISTS height DECIMAL(5,2) NULL AFTER weight,
  ADD COLUMN IF NOT EXISTS image_path VARCHAR(500) NULL AFTER height;
```

Do not split existing Thai display names. Existing rows stay nullable and the API supplies `users.display_name` as the read fallback.

- [ ] **Step 4: Implement guarded migration and package commands**

Use the existing backup pattern from `migrate-remove-province-location.ps1`. The state query must count exactly the six target columns and classify `0=legacy`, `6=migrated`, otherwise `partial`. Add:

```json
"migrate:member-profile": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-member-profile.ps1",
"test:migrate-member-profile": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/migrate-member-profile.test.ps1"
```

- [ ] **Step 5: Verify GREEN and apply to the local database**

Run: `npm run test:migrate-member-profile`

Expected: PASS for legacy and migrated; intentional partial state is rejected.

Run: `npm run migrate:member-profile`

Expected: backup path printed, then postflight reports `6/6` profile columns. A second run reports already migrated without another DDL change.

- [ ] **Step 6: Commit**

```bash
git add backend/database/schema.sql backend/database/manual-migrations/20260811_add_member_profile_fields.sql scripts/migrate-member-profile.ps1 scripts/migrate-member-profile.test.ps1 package.json
git commit -m "feat: add member profile data fields"
```

---

### Task 2: Profile data rules and authenticated read/update API

**Files:**
- Create: `backend/src/ProfileRules.php`
- Create: `backend/tests/ProfileRulesTest.php`
- Modify: `backend/src/Handlers.php`
- Modify: `backend/index.php`
- Modify: `package.json:scripts`
- Create: `scripts/api-profile-smoke.ps1`

**Interfaces:**
- Consumes: Task 1 member columns and existing `trainer_profiles`, `trainer_training_types`, `training_types`, `trainer_certificates`
- Produces: `GET /v1/profile` and `PATCH /v1/profile`
- Produces PHP methods: `ProfileRules::member(array): array` and `ProfileRules::trainer(array): array`

- [ ] **Step 1: Write failing PHP rules tests**

```php
test('normalizes a member profile', function (): void {
    assertSameValue([
        'firstName' => 'สมชาย', 'lastName' => 'ใจดี', 'phone' => '0812345678',
        'fitnessGoal' => 'เพิ่มความแข็งแรง', 'experienceLevel' => 'beginner',
        'weight' => 70.5, 'height' => 175.0,
    ], ProfileRules::member([
        'firstName' => ' สมชาย ', 'lastName' => ' ใจดี ', 'phone' => '0812345678',
        'fitnessGoal' => ' เพิ่มความแข็งแรง ', 'experienceLevel' => 'beginner',
        'weight' => '70.50', 'height' => '175',
    ]));
});

test('rejects non-positive body measurements', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::member([
        'firstName' => 'สมชาย', 'lastName' => 'ใจดี', 'weight' => '0', 'height' => '-1',
    ]));
});

test('requires a gym name only for gym service', function (): void {
    expectHttp(422, 'VALIDATION_FAILED', fn() => ProfileRules::trainer([
        'displayName' => 'ครูเมย์', 'serviceMode' => 'gym', 'gymName' => '',
        'yearsExperience' => 3, 'trainingTypeIds' => [1],
    ]));
});
```

- [ ] **Step 2: Run the rules test and verify RED**

Run: `C:\xampp\php\php.exe backend/tests/ProfileRulesTest.php`

Expected: FAIL because `ProfileRules.php` is missing.

- [ ] **Step 3: Implement minimal validation**

`ProfileRules::member()` must require trimmed first/last names, accept blank optional phone/goal/experience, and return nullable floats for blank weight/height. `ProfileRules::trainer()` must validate `serviceMode` in `freelance|gym|both`, non-negative integer years, positive nullable price, non-empty integer `trainingTypeIds`, and conditional gym name. Return field errors with client field names.

```php
private static function nullablePositiveNumber(mixed $value, string $field): ?float
{
    if ($value === null || trim((string) $value) === '') return null;
    if (!is_numeric($value) || (float) $value <= 0) {
        throw new HttpException(422, 'ข้อมูลโปรไฟล์ไม่ถูกต้อง', 'VALIDATION_FAILED', [
            $field => 'กรอกเป็นตัวเลขที่มากกว่าศูนย์',
        ]);
    }
    return round((float) $value, 2);
}
```

- [ ] **Step 4: Add role-shaped GET payloads**

`GET /v1/profile` calls `requireUser(['member','trainer'])`. Member response:

```json
{
  "role": "member",
  "user": { "displayName": "สมชาย ใจดี", "email": "member@example.com" },
  "imageUrl": "/v1/profile-images/member/1",
  "member": {
    "firstName": "สมชาย", "lastName": "ใจดี", "phone": "0812345678",
    "fitnessGoal": "เพิ่มความแข็งแรง", "experienceLevel": "beginner",
    "weight": 70.5, "height": 175
  }
}
```

Trainer response has the same `role`, `user`, `imageUrl` keys plus:

```json
{
  "trainer": {
    "legalName": "เมย์ ใจดี", "phone": "0899999999", "headline": "สร้างความแข็งแรงอย่างเป็นระบบ",
    "bio": "วางแผนการฝึกตามเป้าหมาย", "yearsExperience": 6, "serviceMode": "freelance",
    "gymName": null, "priceFrom": 650, "trainingTypeIds": [1, 3],
    "approvalStatus": "approved", "approvalNote": null,
    "certificates": [{ "id": 1, "name": "CPT", "issuer": "สถาบันทดสอบ", "issuedYear": 2024, "status": "verified" }]
  }
}
```

- [ ] **Step 5: Add transactional PATCH behavior**

For members, update `users.display_name` with `trim(firstName + ' ' + lastName)` and update only approved member columns. Do not include `medical_note` in SQL. For trainers, update `users.display_name`, approved trainer columns, and replace `trainer_training_types` inside one transaction. Validate every requested type against active `training_types` before deleting existing links. Do not update `approval_status`, `approval_note`, certificates, slug or image path.

- [ ] **Step 6: Add the smoke script RED assertions**

The script must register a disposable member and trainer, call both endpoints, assert role-shaped payloads, PATCH each profile, query MariaDB for saved values, and confirm member `medical_note` plus trainer `approval_status` remain unchanged. Use a timestamped email and delete only those disposable rows in `finally`.

- [ ] **Step 7: Run focused GREEN checks**

Run: `C:\xampp\php\php.exe backend/tests/ProfileRulesTest.php`

Expected: all profile rule tests PASS.

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-profile-smoke.ps1 -Scenario profile`

Expected: member and trainer GET/PATCH PASS; MariaDB assertions PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/ProfileRules.php backend/tests/ProfileRulesTest.php backend/src/Handlers.php backend/index.php scripts/api-profile-smoke.ps1 package.json
git commit -m "feat: add role-aware profile API"
```

---

### Task 3: Safe profile-image upload and delivery

**Files:**
- Modify: `backend/src/Handlers.php`
- Modify: `backend/index.php`
- Modify: `scripts/api-profile-smoke.ps1`
- Modify: `lib/api.ts`

**Interfaces:**
- Produces: `POST /v1/profile/image` multipart field `image`
- Produces: `GET /v1/profile-images/{role}/{id}` with safe image bytes
- Produces TypeScript helper: `apiAssetUrl(path: string | null): string | null`

- [ ] **Step 1: Add failing smoke cases**

Extend the disposable accounts from Task 2 and assert:

```powershell
$validBody = & curl.exe --silent --show-error --fail-with-body `
  -H "Authorization: Bearer $memberToken" `
  -F "image=@$pngFixture;type=image/png" `
  "$ApiBase/v1/profile/image"
if ($LASTEXITCODE -ne 0) { throw "valid PNG upload failed: $validBody" }

$invalidBody = & curl.exe --silent --show-error `
  -w "`n%{http_code}" `
  -H "Authorization: Bearer $memberToken" `
  -F "image=@$pdfFixture;type=application/pdf" `
  "$ApiBase/v1/profile/image"
$invalidLines = @($invalidBody -split "`n")
if ($invalidLines[-1] -ne '422') { throw 'PDF upload must return 422' }
if (($invalidLines[0] | ConvertFrom-Json).error.code -ne 'VALIDATION_FAILED') {
    throw 'PDF upload must return VALIDATION_FAILED'
}
```

Also assert oversize rejection, unauthenticated rejection, `Content-Type` on the public GET, and that failed replacement leaves the old `image_path` and old file intact.

- [ ] **Step 2: Run the image scenario and verify RED**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-profile-smoke.ps1 -Scenario image`

Expected: FAIL with route not found.

- [ ] **Step 3: Implement upload validation and atomic replacement**

Reuse `saveUpload()` with MIME allowlist `image/jpeg`, `image/png`, `image/webp`, maximum `5 * 1024 * 1024`, and directory `profile-images`. Start a database transaction only after the new file is saved. Update `member_profiles.image_path` or `trainer_profiles.image_path`, commit, then remove the old upload. If the database update fails, remove only the new upload.

Return:

```json
{ "imageUrl": "/v1/profile-images/member/1" }
```

When an existing seeded trainer uses a frontend public path such as `/demo/trainer-a.png`, return that path unchanged. Convert only newly uploaded `uploads/profile-images/...` values to the public `/v1/profile-images/{role}/{id}` endpoint.

- [ ] **Step 4: Implement safe public image delivery**

The route regex accepts only `member|trainer` and positive numeric id. Resolve the stored path with `realpath`, require it to start with the resolved `backend/uploads/profile-images/` prefix, send the recorded MIME type or detect it with `finfo`, and set `X-Content-Type-Options: nosniff` plus a bounded public cache header. Never send the database path in an error.

- [ ] **Step 5: Add the frontend asset helper**

```ts
export function apiAssetUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith("/v1/")) return `${API_URL}${path}`;
  return path.startsWith("/") ? path : `/${path}`;
}
```

- [ ] **Step 6: Run GREEN and commit**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-profile-smoke.ps1 -Scenario image`

Expected: valid images upload and render; invalid/oversize/unauthenticated cases PASS; cleanup removes disposable files.

```bash
git add backend/src/Handlers.php backend/index.php scripts/api-profile-smoke.ps1 lib/api.ts
git commit -m "feat: upload safe profile images"
```

---

### Task 4: Password change with other-session revocation

**Files:**
- Modify: `backend/src/Auth.php`
- Modify: `backend/src/Handlers.php`
- Modify: `backend/index.php`
- Modify: `scripts/api-profile-smoke.ps1`

**Interfaces:**
- Produces: `PATCH /v1/profile/password`
- Produces: `Auth::changePassword(array $input): array`

- [ ] **Step 1: Add failing live password cases**

Create two tokens by logging into the same disposable account twice. Assert wrong current password returns `401 INVALID_CREDENTIALS`, fewer than eight characters returns `422 VALIDATION_FAILED` with `newPassword`, and a valid change returns `{ "changed": true }`.

After success, assert the bearer token used for the change still passes `/v1/me`, the second token returns `401 INVALID_TOKEN`, the old password can no longer log in, and the new password can log in.

- [ ] **Step 2: Run and verify RED**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-profile-smoke.ps1 -Scenario password`

Expected: FAIL because the password route is missing.

- [ ] **Step 3: Implement `Auth::changePassword()`**

```php
public function changePassword(array $input): array
{
    Http::requireFields($input, ['currentPassword', 'newPassword']);
    $token = Http::bearerToken();
    $user = $this->requireUser(['member', 'trainer']);
    $row = $this->database->fetchOne('SELECT password_hash FROM users WHERE id = ?', [$user['id']]);
    if (!$row || !password_verify((string) $input['currentPassword'], $row['password_hash'])) {
        throw new HttpException(401, 'รหัสผ่านปัจจุบันไม่ถูกต้อง', 'INVALID_CREDENTIALS', [
            'currentPassword' => 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
        ]);
    }
    if (mb_strlen((string) $input['newPassword']) < 8) {
        throw new HttpException(422, 'รหัสผ่านใหม่ไม่ถูกต้อง', 'VALIDATION_FAILED', [
            'newPassword' => 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
        ]);
    }
    $currentTokenHash = hash('sha256', (string) $token);
    $newHash = password_hash((string) $input['newPassword'], PASSWORD_DEFAULT);
    $this->database->transaction(function (PDO $pdo) use ($user, $newHash, $currentTokenHash): void {
        $pdo->prepare('UPDATE users SET password_hash = ?, updated_at = UTC_TIMESTAMP() WHERE id = ?')
            ->execute([$newHash, $user['id']]);
        $pdo->prepare(
            'UPDATE auth_tokens SET revoked_at = UTC_TIMESTAMP()
             WHERE user_id = ? AND token_hash <> ? AND revoked_at IS NULL'
        )->execute([$user['id'], $currentTokenHash]);
    });
    return ['changed' => true];
}
```

The handler ignores any `userId`, `email`, `role`, or `confirmPassword` sent by the client.

- [ ] **Step 4: Run GREEN and commit**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-profile-smoke.ps1 -Scenario password`

Expected: all password and token assertions PASS.

```bash
git add backend/src/Auth.php backend/src/Handlers.php backend/index.php scripts/api-profile-smoke.ps1
git commit -m "feat: let users change their password"
```

---

### Task 5: Shared profile types, route and role navigation

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/role-navigation.ts`
- Modify: `lib/role-navigation.test.ts`
- Modify: `components/site-header.tsx`
- Modify: `components/site-header.test.tsx`
- Create: `app/profile/page.tsx`
- Create: `components/profile-workbench.tsx`
- Create: `components/profile-workbench.test.tsx`

**Interfaces:**
- Consumes: Task 2 payloads and Task 3 `apiAssetUrl`
- Produces: `AccountProfile`, `MemberAccountProfile`, `TrainerAccountProfile`
- Produces: `<ProfileWorkbench />`

- [ ] **Step 1: Define the failing navigation and role-shell tests**

```ts
expect(navigationFor("member")).toContainEqual(expect.objectContaining({
  href: "/profile", label: "โปรไฟล์", icon: "profile",
}));
expect(navigationFor("trainer")).toContainEqual(expect.objectContaining({
  href: "/profile", label: "โปรไฟล์", icon: "profile",
}));
expect(navigationFor("admin")).not.toContainEqual(expect.objectContaining({ href: "/profile" }));
```

In `site-header.test.tsx`, open the account menu and expect a `ดูโปรไฟล์` link to `/profile`. In `profile-workbench.test.tsx`, mock `GET /v1/profile` for member and trainer, assert loading first, role-specific heading after resolution, retry after an `ApiError`, `/login` redirect for missing token, and `/admin` redirect when the stored authenticated user has role `admin` without requesting the profile endpoint.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npx vitest run lib/role-navigation.test.ts components/site-header.test.tsx components/profile-workbench.test.tsx`

Expected: FAIL for missing profile icon/item/link/component.

- [ ] **Step 3: Add exact discriminated union types**

```ts
type AccountUser = { displayName: string; email: string };
type CertificateSummary = {
  id: number;
  name: string;
  issuer: string;
  issuedYear: number | null;
  status: VerificationStatus;
};

export type MemberAccountProfile = {
  role: "member";
  user: AccountUser;
  imageUrl: string | null;
  member: {
    firstName: string; lastName: string; phone: string; fitnessGoal: string;
    experienceLevel: string; weight: number | null; height: number | null;
  };
};

export type TrainerAccountProfile = {
  role: "trainer";
  user: AccountUser;
  imageUrl: string | null;
  trainer: {
    legalName: string; phone: string; headline: string; bio: string;
    yearsExperience: number; serviceMode: "freelance" | "gym" | "both";
    gymName: string | null; priceFrom: number | null; trainingTypeIds: number[];
    approvalStatus: TrainerApprovalStatus; approvalNote: string | null;
    certificates: CertificateSummary[];
  };
};

export type AccountProfile = MemberAccountProfile | TrainerAccountProfile;
```

- [ ] **Step 4: Add navigation and route shell**

Extend `NavigationIcon` with `profile`, map it to `UserRound` in the sidebar, add the item to member/trainer desktop and mobile arrays, and add the account-menu link. `app/profile/page.tsx` remains a Server Component that exports metadata and renders the interactive Client Component:

```tsx
import { ProfileWorkbench } from "@/components/profile-workbench";

export const metadata = { title: "โปรไฟล์ของฉัน" };
export default function ProfilePage() { return <ProfileWorkbench />; }
```

- [ ] **Step 5: Implement loading/error/role gate only**

Use `authenticatedRequest<AccountProfile>("/v1/profile")` in an effect guarded by the token. Render `workbench-loading`, `workbench-error[role=alert]` with “ลองใหม่”, or the exact heading “โปรไฟล์สมาชิก” / “โปรไฟล์เทรนเนอร์”. Do not implement fields in this task.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run lib/role-navigation.test.ts components/site-header.test.tsx components/profile-workbench.test.tsx`

Expected: all navigation and shell tests PASS.

```bash
git add lib/types.ts lib/role-navigation.ts lib/role-navigation.test.ts components/site-header.tsx components/site-header.test.tsx app/profile/page.tsx components/profile-workbench.tsx components/profile-workbench.test.tsx
git commit -m "feat: add profile route and navigation"
```

---

### Task 6: Identity header, image upload and session synchronization

**Files:**
- Create: `components/profile-identity.tsx`
- Create: `components/profile-identity.test.tsx`
- Modify: `components/profile-workbench.tsx`
- Modify: `components/profile-workbench.test.tsx`
- Modify: `components/site-header.tsx`
- Modify: `components/site-header.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: `AccountProfile`, `apiAssetUrl`, `POST /v1/profile/image`
- Produces: `<ProfileIdentity profile onProfileChange />`
- Produces: browser event `fitconnect:profile-updated` with `{ displayName, imageUrl }`

- [ ] **Step 1: Write failing identity tests**

Assert visible breadcrumb, avatar alt text, name/email/Thai role badge, `accept="image/jpeg,image/png,image/webp"`, client rejection above 5 MB, upload button disabled while pending, API FormData field `image`, successful preview, and old image retained after an API error.

Add a header test that dispatches:

```ts
window.dispatchEvent(new CustomEvent("fitconnect:profile-updated", {
  detail: { displayName: "ชื่อใหม่", imageUrl: "/v1/profile-images/member/1" },
}));
expect(screen.getByRole("button", { name: "เปิดเมนูบัญชีของ ชื่อใหม่" })).toBeInTheDocument();
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run components/profile-identity.test.tsx components/profile-workbench.test.tsx components/site-header.test.tsx`

Expected: FAIL because the identity component and event subscription are missing.

- [ ] **Step 3: Implement the identity component**

Use the existing Avatar and Button primitives. Use a native visually hidden file input and a visible label/button. Validate `file.type` and `file.size` before creating preview. Revoke every object URL when replaced or unmounted. On API success, replace `profile.imageUrl` and announce “เปลี่ยนรูปโปรไฟล์แล้ว”.

- [ ] **Step 4: Synchronize the stored session and sidebar**

On profile update, merge only `displayName` into `fitconnect_user`; keep id, email, role and status. Store `fitconnect_profile_image` separately keyed by user id or include an optional `imageUrl` on `AuthenticatedUser`. Subscribe/unsubscribe to the custom event in `SiteHeader`, and use initials when the URL is absent or the image errors.

- [ ] **Step 5: Add focused FitConnect styling**

Add `.account-profile`, `.account-profile__breadcrumb`, `.profile-identity`, `.profile-identity__avatar`, and `.profile-role-badge`. Use existing tokens, a compact circular image, one rule-bounded section, no gradient, no heavy shadow, and `prefers-reduced-motion` coverage.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx vitest run components/profile-identity.test.tsx components/profile-workbench.test.tsx components/site-header.test.tsx`

Expected: all identity, upload and session-sync tests PASS.

```bash
git add components/profile-identity.tsx components/profile-identity.test.tsx components/profile-workbench.tsx components/profile-workbench.test.tsx components/site-header.tsx components/site-header.test.tsx app/globals.css
git commit -m "feat: add editable profile identity"
```

---

### Task 7: Member and trainer profile forms

**Files:**
- Create: `components/member-profile-form.tsx`
- Create: `components/member-profile-form.test.tsx`
- Create: `components/trainer-account-form.tsx`
- Create: `components/trainer-account-form.test.tsx`
- Modify: `components/profile-workbench.tsx`
- Modify: `components/profile-workbench.test.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Consumes: Task 2 `PATCH /v1/profile`, `MemberAccountProfile`, `TrainerAccountProfile`
- Produces: role-specific forms with `onSaved(profile: AccountProfile)`

- [ ] **Step 1: Write failing member-form tests**

Assert labels for first name, last name, read-only email, phone, goal, experience level, weight kg and height cm. Submit edited values and expect the exact JSON body:

```ts
expect(authenticatedRequest).toHaveBeenCalledWith("/v1/profile", {
  method: "PATCH",
  body: JSON.stringify({
    firstName: "สมชาย", lastName: "ใจดี", phone: "0812345678",
    fitnessGoal: "เพิ่มความแข็งแรง", experienceLevel: "beginner",
    weight: 70.5, height: 175,
  }),
});
```

Assert empty names, non-positive measurements, pending double-submit prevention, field errors from `ApiError.fields`, success live region, and that `medical_note`, gender, birth date, province and location are absent.

- [ ] **Step 2: Write failing trainer-form tests**

Assert display name, legal name, read-only email, phone, headline, bio, years, service mode, gym name, price and training types. Assert gym name hides for freelance and is required for gym/both. Assert approval note and certificates are read-only. Submit exact JSON and assert no approval or certificate field is sent.

- [ ] **Step 3: Run and verify RED**

Run: `npx vitest run components/member-profile-form.test.tsx components/trainer-account-form.test.tsx components/profile-workbench.test.tsx`

Expected: FAIL because both form components are missing.

- [ ] **Step 4: Implement the member form**

Use controlled values initialized from `profile.member`. Convert blank number fields to `null`, preserve typed values after server errors, map `ApiError.fields` to visible field messages and `aria-describedby`, and call `onSaved()` with the returned profile only after success.

Use these experience values:

```tsx
<option value="">ยังไม่ระบุ</option>
<option value="beginner">เริ่มต้น</option>
<option value="intermediate">มีประสบการณ์</option>
<option value="advanced">ฝึกสม่ำเสมอ</option>
```

- [ ] **Step 5: Implement the trainer form**

Fetch training types from `/v1/training-types` or pass the existing reference list into the form. Render checkbox controls for multiple type ids, keep at least one selected, and do not replace the list with demo fallback on authenticated profile errors. Use the existing Thai approval labels and certificate status patterns.

- [ ] **Step 6: Compose the role-specific page and sync name**

`ProfileWorkbench` renders `MemberProfileForm` only when `profile.role === "member"` and `TrainerAccountForm` only when `profile.role === "trainer"`. After a successful response, replace the whole local profile and dispatch `fitconnect:profile-updated` with the returned display name and image URL.

- [ ] **Step 7: Add responsive form styling**

Add `.profile-section`, `.profile-form-grid`, `.profile-readonly`, `.profile-field-error`, `.profile-certificates`, and `.profile-form-actions`. Use two columns above 48rem and one column below it. Long email, certificate names and Thai errors must wrap normally.

- [ ] **Step 8: Run GREEN and commit**

Run: `npx vitest run components/member-profile-form.test.tsx components/trainer-account-form.test.tsx components/profile-workbench.test.tsx components/site-header.test.tsx`

Expected: all role form, integration and header-sync tests PASS.

```bash
git add components/member-profile-form.tsx components/member-profile-form.test.tsx components/trainer-account-form.tsx components/trainer-account-form.test.tsx components/profile-workbench.tsx components/profile-workbench.test.tsx app/globals.css
git commit -m "feat: edit member and trainer profiles"
```

---

### Task 8: Password form and full-system verification

**Files:**
- Create: `components/password-form.tsx`
- Create: `components/password-form.test.tsx`
- Modify: `components/profile-workbench.tsx`
- Modify: `components/profile-workbench.test.tsx`
- Modify: `app/globals.css`
- Modify: `scripts/api-profile-smoke.ps1`
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 4 `PATCH /v1/profile/password`
- Produces: complete member/trainer profile page and retained XAMPP audit evidence

- [ ] **Step 1: Write failing password-form tests**

Assert three labeled password inputs, local mismatch prevention without an API call, minimum eight-character validation, pending double-submit protection, exact PATCH body without `confirmPassword`, server field error display, success message, and cleared inputs after success.

```ts
expect(authenticatedRequest).toHaveBeenCalledWith("/v1/profile/password", {
  method: "PATCH",
  body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password" }),
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npx vitest run components/password-form.test.tsx components/profile-workbench.test.tsx`

Expected: FAIL because the password form is missing.

- [ ] **Step 3: Implement and compose the password form**

Use `autoComplete="current-password"` and `autoComplete="new-password"`. Keep the profile form independent when password change fails. Render the section after role-specific profile fields and announce success with `role="status"`.

- [ ] **Step 4: Run the complete automated gate once**

Run: `npm test`

Expected: every Vitest file PASS.

Run: `C:\xampp\php\php.exe backend/tests/WorkflowRulesTest.php`

Expected: existing workflow tests PASS unchanged.

Run: `C:\xampp\php\php.exe backend/tests/ProfileRulesTest.php`

Expected: all profile rule tests PASS.

Run: `npm run lint && npm run typecheck && npm run build`

Expected: lint and typecheck exit 0; Next.js 16.3 build completes every route including `/profile`.

- [ ] **Step 5: Run the complete live XAMPP smoke and database audit**

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-profile-smoke.ps1 -Scenario all`

Expected: member/trainer profile update, image, password and cleanup PASS. The audit must print saved member columns, trainer columns, unchanged `medical_note`, unchanged trainer approval, new password hash verification, revoked secondary token, and zero disposable test users after cleanup.

- [ ] **Step 6: Run one bounded browser matrix**

Use fresh member and trainer accounts on a fresh Next dev port. Inspect `/profile` at 1280, 768, 414, 375 and 320px. For both roles verify loading, populated, client validation, server error/retry, save success, image preview/upload, password mismatch/success, keyboard order, visible focus, 200% zoom, reduced motion and `document.documentElement.scrollWidth === window.innerWidth`.

Save only final evidence under ignored `output/playwright/profile/`. If a product defect is found, apply one focused fix batch and run only focused confirmation for the affected state and widths.

- [ ] **Step 7: Update usage instructions**

Add concise README commands for migration and profile smoke:

```markdown
npm run migrate:member-profile
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/api-profile-smoke.ps1 -Scenario all
```

State that Apache and MySQL must be running and that migration creates a recovery backup before DDL.

- [ ] **Step 8: Run hygiene checks and commit**

Run: `git diff --check`

Expected: no whitespace errors.

Run: `git status --short`

Expected: only approved Task 8 files staged; pre-existing `next-env.d.ts`, `.superpowers/` and `graphify-out/` remain unstaged.

```bash
git add components/password-form.tsx components/password-form.test.tsx components/profile-workbench.tsx components/profile-workbench.test.tsx app/globals.css scripts/api-profile-smoke.ps1 README.md
git commit -m "feat: complete account profile management"
```

## Final Self-Review Checklist

- [ ] Every approved member field has a schema column, API mapping, form field and test
- [ ] Trainer edit payload excludes approval state and certificates
- [ ] Gender, birth date, province and appointment location appear only in negative tests or scope documentation
- [ ] Email cannot be edited in UI or PATCH handlers
- [ ] `medical_note` survives member profile updates
- [ ] Image replacement is atomic and path-safe
- [ ] Password change keeps the current session and revokes other tokens
- [ ] Sidebar name/image updates without reload
- [ ] Member, trainer, guest and admin navigation remain role-correct
- [ ] Existing booking, payment, chat, review and trainer approval tests remain green
- [ ] Live MariaDB audit proves saved data and cleanup
