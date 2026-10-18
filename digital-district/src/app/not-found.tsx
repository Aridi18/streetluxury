import Link from "next/link";

export default function RootNotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="font-display text-6xl font-bold text-brand-500/50">404</p>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <Link href="/" className="text-brand-300 underline">Go to the homepage</Link>
    </div>
  );
}
