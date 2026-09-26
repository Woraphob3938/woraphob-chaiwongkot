import { TrainerApplyAccess } from "@/components/trainer-apply-access";

export const metadata = { title: "สมัครเป็นเทรนเนอร์" };
export default function TrainerApplyPage() {
  return (
    <main className="page-shell form-page">
      <TrainerApplyAccess />
    </main>
  );
}
