import type { Metadata } from "next";
import Link from "next/link";
import { TrackForm } from "@/components/store/track-form";

export const metadata: Metadata = { title: "Track your order" };

export default function TrackPage() {
  return (
    <div className="container-page max-w-md py-16">
      <p className="eyebrow mb-2">Order status</p>
      <h1 className="mb-2 text-3xl font-bold">Track your order</h1>
      <p className="mb-8 text-muted">Enter your order number and the phone number or email you used when ordering.</p>
      <div className="card p-6"><TrackForm /></div>
      <p className="mt-6 text-center text-sm text-muted">Have an account? <Link href="/account/orders" className="text-brand-300">See all your orders</Link></p>
    </div>
  );
}
