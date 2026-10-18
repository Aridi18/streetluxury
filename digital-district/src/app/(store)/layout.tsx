import { Header } from "@/components/store/header";
import { Footer } from "@/components/store/footer";
import { getSettings } from "@/lib/settings";
import { waLink } from "@/lib/whatsapp";
import { WhatsAppIcon } from "@/components/store/icons";

export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const s = await getSettings();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-brand-500 focus:px-4 focus:py-2 focus:text-white">
        Skip to content
      </a>
      <Header />
      <main id="main" className="min-h-[60vh]">{children}</main>
      <Footer />
      <a
        href={waLink(s.whatsappNumber, s.whatsappDefaultMessage)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Chat with us on WhatsApp"
        className="fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-[#25D366] text-[#05290f] shadow-[0_12px_32px_-8px_rgb(37_211_102/0.6)] transition hover:scale-105"
      >
        <WhatsAppIcon className="size-7" />
      </a>
    </>
  );
}
