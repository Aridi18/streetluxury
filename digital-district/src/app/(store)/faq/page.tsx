import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getSettings } from "@/lib/settings";
import { waLink } from "@/lib/whatsapp";
import { Markdown } from "@/components/markdown";
import { WhatsAppIcon } from "@/components/store/icons";
import { buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Frequently asked questions" };

export default async function FaqPage() {
  const [faqs, s] = await Promise.all([db.faqItem.findMany({ where: { isVisible: true }, orderBy: { sortOrder: "asc" } }), getSettings()]);
  const jsonLd = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) };
  return (
    <div className="container-page max-w-3xl py-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <p className="eyebrow mb-2">Help</p>
      <h1 className="mb-2 text-3xl font-bold sm:text-4xl">Frequently asked questions</h1>
      <p className="mb-10 text-muted">Everything you need to know before ordering.</p>
      <div className="space-y-3">
        {faqs.map((f) => (
          <details key={f.id} className="card group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-white">
              {f.question}
              <span className="text-xl text-brand-300 transition group-open:rotate-45">+</span>
            </summary>
            <div className="mt-3"><Markdown source={f.answer} /></div>
          </details>
        ))}
      </div>
      <div className="mt-12 rounded-2xl border border-line bg-surface p-6 text-center">
        <p className="mb-4 font-semibold">Still have a question?</p>
        <a href={waLink(s.whatsappNumber, s.whatsappDefaultMessage)} target="_blank" rel="noopener noreferrer" className={buttonClass("whatsapp", "md")}><WhatsAppIcon className="size-4" /> Ask us on WhatsApp</a>
      </div>
    </div>
  );
}
