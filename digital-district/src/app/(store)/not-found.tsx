import { LinkButton } from "@/components/ui";
import { SearchBox } from "@/components/store/search-box";

export default function NotFound() {
  return (
    <div className="container-page flex max-w-xl flex-col items-center py-24 text-center">
      <p className="font-display text-7xl font-bold text-brand-500/40">404</p>
      <h1 className="mt-4 text-2xl font-bold">We couldn&apos;t find that page</h1>
      <p className="mt-2 text-muted">It may have moved, or the link may be incomplete. Try searching instead:</p>
      <SearchBox className="mt-6 w-full" />
      <LinkButton href="/" variant="outline" className="mt-6">Back to the homepage</LinkButton>
    </div>
  );
}
