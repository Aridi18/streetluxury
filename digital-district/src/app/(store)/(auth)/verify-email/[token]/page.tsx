import type { Metadata } from "next";
import { db } from "@/lib/db";
import { consumeUserToken } from "@/lib/accounts";
import { Alert, LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Confirm email", robots: { index: false }, referrer: "no-referrer" };

export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const userId = await consumeUserToken((await params).token, "EMAIL_VERIFICATION");
  if (userId) await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
  return (
    <div className="card space-y-4 p-8">
      <h1 className="text-2xl font-bold">Email confirmation</h1>
      {userId ? <Alert tone="success">Thanks — your email address is confirmed.</Alert> : <Alert tone="warning">This link is invalid or has already been used.</Alert>}
      <LinkButton href="/account" className="w-full">Go to my account</LinkButton>
    </div>
  );
}
