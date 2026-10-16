import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, GitCompareArrows, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { JobStatusPill } from "@/components/Badges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label, Select } from "@/components/ui/input";
import { EmptyState, PageHeader, PageLoader, Spinner } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { fmtDuration, fmtRelative } from "@/lib/format";

export default function Compare() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const recs = useQuery({ queryKey: ["recordings", "all"], queryFn: () => api.recordings(undefined, 200) });
  const list = useQuery({
    queryKey: ["comparisons"],
    queryFn: api.comparisons,
    refetchInterval: (q) => (q.state.data?.items.some((c) => c.status === "queued" || c.status === "running") ? 2000 : false),
  });
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const create = useMutation({
    mutationFn: () => api.compare(a, b),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["comparisons"] });
      navigate(`/app/compare/${c.id}`);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteComparison(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["comparisons"] }),
  });

  if (recs.isLoading) return <PageLoader />;
  const usable = (recs.data?.items ?? []).filter((r) => r.status === "ready" && r.has_audio);
  const label = (r: (typeof usable)[number]) => `${r.title || r.original_filename} · ${fmtDuration(r.duration_seconds)} · ${fmtRelative(r.created_at)}`;

  return (
    <div className="animate-fade-in">
      <PageHeader eyebrow="Comparison" title="Original vs. suspected edit">
        Align an alleged original with a suspect version to locate added, removed, changed and re-ordered audio.
        Differences found this way are confirmed by direct comparison of the two files, unlike the inferred findings of a single-file analysis.
      </PageHeader>

      <Card className="mb-6">
        <CardHeader>
          <div>
            <CardTitle>New comparison</CardTitle>
            <CardDescription>Both recordings must be uploaded first. The comparison does not decide which file is the original.</CardDescription>
          </div>
        </CardHeader>
        <CardBody>
          {usable.length < 2 ? (
            <EmptyState icon={<Upload />} title="Upload two recordings to compare" action={<Link to="/app/new" className={buttonVariants()}>Upload audio</Link>}>
              You currently have {usable.length} recording{usable.length === 1 ? "" : "s"} with audio available.
            </EmptyState>
          ) : (
            <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_1fr_auto]">
              <div>
                <Label htmlFor="orig">Alleged original</Label>
                <Select id="orig" value={a} onChange={(e) => setA(e.target.value)}>
                  <option value="">Choose a recording…</option>
                  {usable.map((r) => <option key={r.id} value={r.id} disabled={r.id === b}>{label(r)}</option>)}
                </Select>
              </div>
              <ArrowRight className="mb-3 hidden size-4 text-faint md:block" />
              <div>
                <Label htmlFor="susp">Suspected edited version</Label>
                <Select id="susp" value={b} onChange={(e) => setB(e.target.value)}>
                  <option value="">Choose a recording…</option>
                  {usable.map((r) => <option key={r.id} value={r.id} disabled={r.id === a}>{label(r)}</option>)}
                </Select>
              </div>
              <Button onClick={() => create.mutate()} disabled={!a || !b || a === b || create.isPending}>
                {create.isPending ? <Spinner className="text-white" /> : <GitCompareArrows />} Compare
              </Button>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Previous comparisons</CardTitle></CardHeader>
        <CardBody className="px-0 pb-2">
          {list.data?.items.length ? (
            <ul className="divide-y divide-line">
              {list.data.items.map((c) => (
                <li key={c.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                  <Link to={`/app/compare/${c.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">
                      {c.original_info?.title || c.original_info?.original_filename} <span className="text-faint">→</span> {c.suspect_info?.title || c.suspect_info?.original_filename}
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">
                      {fmtRelative(c.created_at)}
                      {c.summary && ` · ${c.summary.splice_points} splice point(s) · ${c.summary.added_segments} added · ${c.summary.removed_segments} removed`}
                    </div>
                  </Link>
                  <div className="flex items-center gap-2">
                    <JobStatusPill status={c.status} stage={c.stage} />
                    <Button variant="ghost" size="icon-sm" aria-label="Delete comparison" onClick={() => del.mutate(c.id)}><Trash2 /></Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 pb-4 text-sm text-muted">No comparisons yet.</p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
