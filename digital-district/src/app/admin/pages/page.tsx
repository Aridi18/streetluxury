import type { Metadata } from "next";
import type { Page } from "@prisma/client";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { saveFaqAction, savePageAction } from "@/app/admin/_actions/content";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Badge, Checkbox, Field, Input, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Pages & FAQs" };

function PageFields({ p }: { p?: Page }) {
  const k = p?.id ?? "new";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="Title" htmlFor={`pt-${k}`} required><Input id={`pt-${k}`} name="title" defaultValue={p?.title} required /></Field>
      <Field label="Web address" htmlFor={`ps-${k}`} hint="digitaldistrict.store/…"><Input id={`ps-${k}`} name="slug" defaultValue={p?.slug} /></Field>
      <Field label="Content" htmlFor={`pb-${k}`} className="md:col-span-2" hint="## Heading · - bullet · **bold** · [link](https://…)"><Textarea id={`pb-${k}`} name="body" defaultValue={p?.body} className="min-h-64 font-mono text-sm" /></Field>
      <Field label="SEO title" htmlFor={`pst-${k}`}><Input id={`pst-${k}`} name="seoTitle" defaultValue={p?.seoTitle ?? ""} /></Field>
      <Field label="SEO description" htmlFor={`psd-${k}`}><Input id={`psd-${k}`} name="seoDescription" defaultValue={p?.seoDescription ?? ""} /></Field>
      <Checkbox name="isPublished" defaultChecked={p ? p.isPublished : true} label="Published" />
      <Checkbox name="showInFooter" defaultChecked={p ? p.showInFooter : true} label="Link in footer" />
    </div>
  );
}

export default async function PagesAdmin() {
  await requireStaffPage("content.manage");
  const [pages, faqs] = await Promise.all([db.page.findMany({ orderBy: { title: "asc" } }), db.faqItem.findMany({ orderBy: { sortOrder: "asc" } })]);
  return (
    <div className="max-w-5xl space-y-8">
      <div>
        <PageHeader title="Pages" description="About us, terms, privacy, refund policy, delivery information and any other page. Have your legal pages reviewed by a professional." />
        <div className="space-y-2">
          {pages.map((p) => (
            <details key={p.id} className="rounded-2xl border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                <span className="flex-1 font-semibold text-white">{p.title}</span>
                <Link href={`/${p.slug}`} target="_blank" className="text-xs text-brand-300">/{p.slug}</Link>
                {!p.isPublished && <Badge>Unpublished</Badge>}
              </summary>
              <div className="border-t border-line p-4"><ActionForm action={savePageAction} submitLabel="Save page"><PageFields p={p} /></ActionForm></div>
            </details>
          ))}
          <details className="rounded-2xl border border-dashed border-line-strong p-4">
            <summary className="cursor-pointer font-semibold">Add a page</summary>
            <ActionForm action={savePageAction} submitLabel="Create page" className="mt-4" resetOnSuccess><PageFields /></ActionForm>
          </details>
        </div>
      </div>
      <div>
        <PageHeader title="Frequently asked questions" />
        <div className="space-y-2">
          {faqs.map((q) => (
            <Panel key={q.id}>
              <ActionForm action={saveFaqAction} submitLabel="Save" submitVariant="secondary">
                <input type="hidden" name="id" value={q.id} />
                <div className="grid gap-3 md:grid-cols-[1fr_90px]">
                  <Input name="question" defaultValue={q.question} aria-label="Question" />
                  <Input name="sortOrder" defaultValue={q.sortOrder} aria-label="Order" />
                </div>
                <Textarea name="answer" defaultValue={q.answer} className="min-h-16" aria-label="Answer" />
                <div className="flex gap-6"><Checkbox name="isVisible" defaultChecked={q.isVisible} label="Visible" /><Checkbox name="delete" label="Delete this question" /></div>
              </ActionForm>
            </Panel>
          ))}
          <Panel title="Add a question">
            <ActionForm action={saveFaqAction} submitLabel="Add question" resetOnSuccess>
              <Input name="question" placeholder="Question" required aria-label="Question" />
              <Textarea name="answer" placeholder="Answer" required className="min-h-16" aria-label="Answer" />
              <Input name="sortOrder" defaultValue={faqs.length + 1} className="w-24" aria-label="Order" />
              <Checkbox name="isVisible" defaultChecked label="Visible" />
            </ActionForm>
          </Panel>
        </div>
      </div>
    </div>
  );
}
