import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth";
import { safeNext } from "@/lib/accounts";
import { ActionForm } from "@/components/action-form";
import { Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(safeNext(next));
  return (
    <div className="card p-8">
      <h1 className="mb-1 text-2xl font-bold">Welcome back</h1>
      <p className="mb-6 text-sm text-muted">Sign in to see your orders, downloads and saved addresses.</p>
      <ActionForm action={loginAction} submitLabel="Sign in" pendingLabel="Signing in…" submitClassName="w-full">
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" required autoComplete="email" autoFocus /></Field>
        <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" required autoComplete="current-password" /></Field>
        <div className="text-right text-sm"><Link href="/forgot-password" className="text-brand-300 hover:text-brand-200">Forgot your password?</Link></div>
      </ActionForm>
      <p className="mt-6 text-center text-sm text-muted">
        New here? <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="font-semibold text-brand-300">Create an account</Link>
      </p>
      <p className="mt-2 text-center text-xs text-subtle">You can also check out as a guest — no account needed.</p>
    </div>
  );
}
