import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { updateProfileAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Checkbox, Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Profile" };

export default async function ProfilePage() {
  const user = await requireUser("/account/profile");
  return (
    <div className="card max-w-xl p-6">
      <h2 className="mb-4 text-xl font-semibold">Profile</h2>
      <ActionForm action={updateProfileAction} submitLabel="Save profile">
        <Field label="Email" htmlFor="email" hint="Contact us if you need to change your email address."><Input id="email" value={user.email} disabled readOnly /></Field>
        <Field label="Full name" htmlFor="name"><Input id="name" name="name" required defaultValue={user.name} /></Field>
        <Field label="Phone / WhatsApp" htmlFor="phone"><Input id="phone" name="phone" type="tel" defaultValue={user.phone ? formatPhone(user.phone) : ""} /></Field>
        <Checkbox name="marketing" defaultChecked={user.marketingOptIn} label="Email me occasional offers" />
      </ActionForm>
    </div>
  );
}
