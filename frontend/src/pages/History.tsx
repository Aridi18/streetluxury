import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileAudio, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { JobStatusPill, VerdictBadge } from "@/components/Badges";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/input";
import { EmptyState, PageHeader, PageLoader } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { fmtBytes, fmtDate, fmtDuration, fmtTime } from "@/lib/format";
import type { Recording } from "@/lib/types";
import { SOURCE_LABEL } from "@/lib/verdict";

function AnalysesTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [verdict, setVerdict] = useState("");
  const q = useQuery({
    queryKey: ["analyses", status, verdict],
    queryFn: () => api.analyses({ status, verdict, limit: 200 }),
    refetchInterval: (s) => (s.state.data?.items.some((a) => a.status === "queued" || a.status === "running") ? 2500 : false),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteAnalysis(id),
    onSuccess: () => {
      toast.success("Analysis and its report deleted");
      qc.invalidateQueries({ queryKey: ["analyses"] });
    },
  });
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Filter by status">
          <option value="">All statuses</option>
          {["queued", "running", "succeeded", "failed", "cancelled"].map((s) => <option key={s} value={s}>{s}</option>)}
        </Select>
        <Select value={verdict} onChange={(e) => setVerdict(e.target.value)} className="w-56" aria-label="Filter by result">
          <option value="">All results</option>
          <option value="none">No significant indicators</option>
          <option value="possible">Possible manipulation</option>
          <option value="strong">Strong indicators</option>
          <option value="inconclusive">Inconclusive</option>
        </Select>
      </div>
      {q.isLoading ? <PageLoader /> : !q.data?.items.length ? (
        <EmptyState title="No analyses match">Run an analysis from a recording's workspace.</EmptyState>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-faint">
              <tr className="border-b border-line">
                <th className="px-5 py-3 font-medium">Recording</th>
                <th className="px-3 py-3 font-medium">Scope</th>
                <th className="px-3 py-3 font-medium">Created</th>
                <th className="px-3 py-3 font-medium">Result</th>
                <th className="px-3 py-3 font-medium">Findings</th>
                <th className="px-5 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.items.map((a) => (
                <tr key={a.id} className="hover:bg-elevated">
                  <td className="max-w-[260px] px-5 py-3">
                    <Link to={a.status === "succeeded" ? `/app/analyses/${a.id}` : `/app/recordings/${a.recording_id}?analysis=${a.id}`} className="block truncate font-medium hover:text-accent-soft">
                      {a.recording_info?.title || a.recording_info?.original_filename}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-muted">{a.segment_start != null ? `${fmtTime(a.segment_start, false)}–${fmtTime(a.segment_end, false)}` : "Entire"}</td>
                  <td className="px-3 py-3 text-muted">{fmtDate(a.created_at)}</td>
                  <td className="px-3 py-3">{a.status === "succeeded" ? <VerdictBadge status={a.verdict} /> : <JobStatusPill status={a.status} stage={a.stage} />}</td>
                  <td className="tabular px-3 py-3 text-muted">{a.status === "succeeded" ? a.findings_count : "—"}</td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      {a.status === "succeeded" && (
                        <a href={api.reportUrl(a.id)} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label="Download PDF report"><Download /></a>
                      )}
                      <Button variant="ghost" size="icon-sm" aria-label="Delete analysis" onClick={() => del.mutate(a.id)}><Trash2 /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function RecordingsTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [toDelete, setToDelete] = useState<Recording | null>(null);
  const q = useQuery({ queryKey: ["recordings", search], queryFn: () => api.recordings(search || undefined, 200) });
  const del = useMutation({
    mutationFn: (id: string) => api.deleteRecording(id),
    onSuccess: () => {
      toast.success("Recording and all its analyses deleted");
      setToDelete(null);
      qc.invalidateQueries();
    },
  });
  return (
    <>
      <div className="relative mb-4 max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
        <Input placeholder="Search by file name or label" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>
      {q.isLoading ? <PageLoader /> : !q.data?.items.length ? (
        <EmptyState icon={<FileAudio />} title="No recordings" action={<Link to="/app/new" className={buttonVariants()}>Upload audio</Link>} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-[13px]">
            <thead className="text-[11px] uppercase tracking-wide text-faint">
              <tr className="border-b border-line">
                <th className="px-5 py-3 font-medium">Recording</th>
                <th className="px-3 py-3 font-medium">Source</th>
                <th className="px-3 py-3 font-medium">Duration</th>
                <th className="px-3 py-3 font-medium">Size</th>
                <th className="px-3 py-3 font-medium">Audio retained until</th>
                <th className="px-3 py-3 font-medium">Latest result</th>
                <th className="px-5 py-3 text-right font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {q.data.items.map((r) => (
                <tr key={r.id} className="hover:bg-elevated">
                  <td className="max-w-[280px] px-5 py-3">
                    <Link to={`/app/recordings/${r.id}`} className="block truncate font-medium hover:text-accent-soft">{r.title || r.original_filename}</Link>
                    <div className="truncate text-[11.5px] text-faint">{r.title ? r.original_filename : `${r.detected_format} · ${r.codec}`}</div>
                  </td>
                  <td className="px-3 py-3 text-muted">{SOURCE_LABEL[r.source]}</td>
                  <td className="px-3 py-3 text-muted">{fmtDuration(r.duration_seconds)}</td>
                  <td className="px-3 py-3 text-muted">{fmtBytes(r.size_bytes)}</td>
                  <td className="px-3 py-3 text-muted">{r.audio_purged_at ? <span className="text-faint">Deleted</span> : fmtDate(r.audio_expires_at, false)}</td>
                  <td className="px-3 py-3">{r.latest_analysis?.status === "succeeded" ? <VerdictBadge status={r.latest_analysis.verdict} /> : r.latest_analysis ? <JobStatusPill status={r.latest_analysis.status} /> : <span className="text-faint">—</span>}</td>
                  <td className="px-5 py-3 text-right">
                    <Button variant="ghost" size="icon-sm" aria-label="Delete recording" onClick={() => setToDelete(r)}><Trash2 /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <Dialog open={!!toDelete} onOpenChange={(v) => !v && setToDelete(null)} title="Delete recording?" description={`"${toDelete?.title || toDelete?.original_filename}" and all of its analyses, comparisons and reports will be permanently deleted.`}>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setToDelete(null)}>Keep</Button>
          <Button variant="danger" onClick={() => toDelete && del.mutate(toDelete.id)} disabled={del.isPending}>Delete permanently</Button>
        </div>
      </Dialog>
    </>
  );
}

export default function HistoryPage() {
  return (
    <div className="animate-fade-in">
      <PageHeader eyebrow="History" title="Analysis history">
        Every analysis keeps the exact pipeline version and model versions it ran with. Reports are generated from these stored results.
      </PageHeader>
      <Tabs defaultValue="analyses">
        <TabsList>
          <TabsTrigger value="analyses">Analyses</TabsTrigger>
          <TabsTrigger value="recordings">Recordings</TabsTrigger>
        </TabsList>
        <TabsContent value="analyses"><AnalysesTab /></TabsContent>
        <TabsContent value="recordings"><RecordingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
