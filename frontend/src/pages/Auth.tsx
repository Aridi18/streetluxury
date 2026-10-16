import { useState, type FormEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { ErrorBox, Spinner } from "@/components/ui/misc";
import { useAuth } from "@/hooks/useAuth";

function Frame({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-12">
      <Link to="/" className="mb-8">
        <Logo />
      </Link>
      <div className="card w-full max-w-sm p-7 animate-fade-in">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
        <div className="mt-6">{children}</div>
      </div>
      <div className="mt-6 text-sm text-muted">{footer}</div>
    </div>
  );
}

function safeNext(next: string | null): string {
  return next && next.startsWith("/app") ? next : "/app";
}

export function Login() {
  const { user, login } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={safeNext(params.get("next"))} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame title="Sign in" subtitle="Access your forensic workspace." footer={<>No account? <Link to="/register" className="text-accent-soft hover:underline">Create one</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Spinner className="text-white" />} Sign in
        </Button>
      </form>
    </Frame>
  );
}

export function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/app" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10) {
      setError("Use at least 10 characters for your password.");
      return;
    }
    setBusy(true);
    try {
      await register(email, password, name || undefined);
      navigate("/app", { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Frame title="Create account" subtitle="Recordings you upload are private to your account." footer={<>Already registered? <Link to="/login" className="text-accent-soft hover:underline">Sign in</Link></>}>
      <form onSubmit={submit} className="space-y-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div>
          <Label htmlFor="name">Name (optional)</Label>
          <Input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" autoComplete="new-password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="mt-1.5 text-[12px] text-faint">At least 10 characters.</p>
        </div>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy && <Spinner className="text-white" />} Create account
        </Button>
      </form>
    </Frame>
  );
}
