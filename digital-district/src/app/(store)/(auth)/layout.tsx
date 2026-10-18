export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative overflow-hidden">
      <div className="absolute left-1/2 top-0 h-80 w-[700px] -translate-x-1/2 rounded-full bg-brand-700/20 blur-[100px]" />
      <div className="container-page relative flex justify-center py-16">
        <div className="w-full max-w-md">{children}</div>
      </div>
    </div>
  );
}
