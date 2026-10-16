import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, ShieldCheck, Trash2, UserX } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { ErrorBox, PageHeader, PageLoader } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";

function Row({ title, children, control }: { title: string; children: ReactNode; control: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b border-line py-4 last:border-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="max-w-xl">
        <div className="text-[14px] font-medium">{title}</div>
        <div className="mt-1 text-[13px] leading-relaxed text-muted">{children}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

function PasswordDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, busy, error }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: (pw: string) => void;
  busy: boolean;
  error: string | null;
}) {
  const [pw, setPw] = useState("");
  return (
    <Dialog open={open} onOpenChange={(v) => { setPw(""); onOpenChange(v); }} title={title} description={description}>
      <form onSubmit={(e) => { e.preventDefault(); onConfirm(pw); }} className="space-y-4">
        {error && <ErrorBox>{error}</ErrorBox>}
        <div>
          <Label htmlFor="confirm-pw">Confirm with your password</Label>
          <Input id="confirm-pw" type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="danger" disabled={busy || !pw}>{confirmLabel}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const q = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const sys = useQuery({ queryKey: ["system"], queryFn: api.system, staleTime: 60_000 });
  const [dlg, setDlg] = useState<null | "data" | "account">(null);
  const [dlgError, setDlgError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: api.updateSettings,
    onSuccess: (u) => {
      qc.setQueryData(["settings"], u);
      refresh();
      toast.success("Settings saved");
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const wipe = useMutation({
    mutationFn: (pw: string) => api.deleteAllData(pw),
    onSuccess: (r) => {
      setDlg(null);
      qc.invalidateQueries();
      toast.success(`Deleted ${r.deleted_recordings} recording(s) with all analyses and reports`);
    },
    onError: (e) => setDlgError((e as Error).message),
  });
  const close = useMutation({
    mutationFn: (pw: string) => api.deleteAccount(pw),
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(["me"], null);
      navigate("/");
    },
    onError: (e) => setDlgError((e as Error).message),
  });

  if (q.isLoading) return <PageLoader />;
  const u = q.data!;
  const maxDays = sys.data?.retention.max_days ?? 365;
  const options = [1, 7, 14, 30, 60, 90, 180, 365].filter((d) => d <= maxDays);

  return (
    <div className="mx-auto max-w-3xl animate-fade-in">
      <PageHeader eyebrow="Privacy & settings" title="Your data">
        Uploaded audio is treated as sensitive personal information. You control how long it is kept and can delete it at any time.
      </PageHeader>

      <Card className="mb-6">
        <CardHeader>
          <div>
            <CardTitle>Retention</CardTitle>
            <CardDescription>Audio is deleted automatically when its retention period ends. Analysis results stay until you delete them.</CardDescription>
          </div>
        </CardHeader>
        <CardBody className="pt-1">
          <Row
            title="Keep audio for"
            control={
              <Select value={u.retention_days} onChange={(e) => save.mutate({ retention_days: Number(e.target.value) })} className="w-40" aria-label="Retention period">
                {options.map((d) => <option key={d} value={d}>{d === 1 ? "1 day" : `${d} days`}</option>)}
              </Select>
            }
          >
            Applies to new and existing recordings (counted from upload). Shortening it can delete audio at the next retention sweep.
          </Row>
          <Row title="Delete audio right after analysis" control={<Switch checked={u.delete_audio_after_analysis} onCheckedChange={(v) => save.mutate({ delete_audio_after_analysis: v })} label="Delete audio after analysis" />}>
            Keeps only the results and the file's SHA-256. Playback, re-analysis and comparison will no longer be possible.
          </Row>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div>
            <CardTitle>Model training</CardTitle>
            <CardDescription>Audio Sentinel does not train or fine-tune models on user recordings.</CardDescription>
          </div>
        </CardHeader>
        <CardBody className="pt-1">
          <Row
            title="Allow research use of my recordings"
            control={<Switch checked={u.research_consent} onCheckedChange={(v) => save.mutate({ research_consent: v })} label="Research consent" />}
          >
            Off by default. This only records your informed consent in case the operator of this server later runs a documented,
            opt-in research programme; no part of this application uses your audio for training. You can withdraw at any time.
            {u.research_consent && u.research_consent_at && <> Consent given {fmtDate(u.research_consent_at)}.</>}
          </Row>
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader><CardTitle>How your data is protected</CardTitle></CardHeader>
        <CardBody>
          <ul className="space-y-3 text-[13px] leading-relaxed text-ink-soft">
            <li className="flex gap-3"><Lock className="mt-0.5 size-4 shrink-0 text-accent-soft" /> Files are encrypted at rest ({sys.data?.storage.encryption ?? "AES-256-GCM"}) in private {sys.data?.storage.backend === "s3" ? "object storage" : "server storage"}. There are no public or shareable file links.</li>
            <li className="flex gap-3"><KeyRound className="mt-0.5 size-4 shrink-0 text-accent-soft" /> Audio is only streamed to you after sign-in and an ownership check. Sessions use HttpOnly, SameSite=Strict cookies.</li>
            <li className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-soft" /> Processing uses private temporary files that are deleted when each job finishes. PDF reports are generated on demand and not stored.</li>
            <li className="flex gap-3"><UserX className="mt-0.5 size-4 shrink-0 text-accent-soft" /> Voice-clone detection is not speaker identification. Audio Sentinel never tries to identify who is speaking.</li>
          </ul>
        </CardBody>
      </Card>

      <Card className="border-sev-high/25">
        <CardHeader><CardTitle>Delete data</CardTitle></CardHeader>
        <CardBody className="pt-1">
          <Row title="Delete all recordings and reports" control={<Button variant="danger" onClick={() => { setDlgError(null); setDlg("data"); }}><Trash2 /> Delete all data</Button>}>
            Permanently deletes every recording, derived file, analysis and comparison in your account. Your account remains.
          </Row>
          <Row title="Delete account" control={<Button variant="danger" onClick={() => { setDlgError(null); setDlg("account"); }}><UserX /> Delete account</Button>}>
            Deletes your account, all data and the chain-of-custody log. This cannot be undone.
          </Row>
        </CardBody>
      </Card>

      <PasswordDialog
        open={dlg === "data"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="Delete all recordings and reports?"
        description="This permanently deletes all audio, analyses and comparisons in your account."
        confirmLabel="Delete all data"
        busy={wipe.isPending}
        error={dlgError}
        onConfirm={(pw) => wipe.mutate(pw)}
      />
      <PasswordDialog
        open={dlg === "account"}
        onOpenChange={(v) => !v && setDlg(null)}
        title="Delete your account?"
        description="Your account and everything in it will be permanently deleted."
        confirmLabel="Delete account"
        busy={close.isPending}
        error={dlgError}
        onConfirm={(pw) => close.mutate(pw)}
      />
    </div>
  );
}
