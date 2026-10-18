import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { AccountNav } from "@/components/store/account-nav";
import { signOutAction } from "@/app/actions/account";
import { Button } from "@/components/ui";

export const metadata: Metadata = { title: { default: "My account", template: "%s · My account" }, robots: { index: false } };

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="container-page py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">My account</p>
          <h1 className="text-3xl font-bold">Hi, {user.name.split(" ")[0]}</h1>
        </div>
        <form action={signOutAction}><Button variant="outline" size="sm">Sign out</Button></form>
      </div>
      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside className="lg:sticky lg:top-36 lg:self-start"><AccountNav /></aside>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
