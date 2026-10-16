import { Link } from "react-router";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="eyebrow">404</div>
      <h1 className="mt-2 text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted">The page does not exist, or the item was deleted.</p>
      <Link to="/app" className={buttonVariants({ variant: "secondary", className: "mt-6" })}>
        Back to dashboard
      </Link>
    </div>
  );
}
