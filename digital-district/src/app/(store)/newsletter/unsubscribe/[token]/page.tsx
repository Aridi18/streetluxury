import type { Metadata } from "next";
import { db } from "@/lib/db";
import { Alert } from "@/components/ui";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false } };

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await db.newsletterSubscriber.updateMany({ where: { unsubscribeToken: token, unsubscribedAt: null }, data: { unsubscribedAt: new Date() } });
  const exists = result.count > 0 || (await db.newsletterSubscriber.count({ where: { unsubscribeToken: token } })) > 0;
  return (
    <div className="container-page max-w-md py-20">
      <h1 className="mb-4 text-2xl font-bold">Newsletter</h1>
      {exists ? <Alert tone="success">You have been unsubscribed. You won&apos;t receive marketing emails from us any more.</Alert> : <Alert tone="warning">This unsubscribe link is not valid.</Alert>}
    </div>
  );
}
