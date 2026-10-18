"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="max-w-md text-muted">Please try again. If the problem continues, message us on WhatsApp and we&apos;ll help right away.</p>
      <button type="button" onClick={reset} className="rounded-xl bg-brand-500 px-5 py-2.5 font-semibold text-white hover:bg-brand-400">Try again</button>
    </div>
  );
}
