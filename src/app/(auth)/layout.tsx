import Image from "next/image";
import { brand } from "@/config/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,520px)]">
      <div className="relative hidden overflow-hidden bg-brand-strong lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,hsl(var(--brand)/0.9),transparent_60%)]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-brand-foreground">
          <Image src={brand.markPath} alt="" width={40} height={40} className="rounded-lg ring-1 ring-white/20" />
          <div className="max-w-md">
            <p className="text-3xl font-semibold leading-tight tracking-tight">Service operations, documentation and billing in one place.</p>
            <p className="mt-4 text-[15px] text-white/70">{brand.tagline}.</p>
          </div>
          <p className="text-[13px] text-white/50">© {new Date().getFullYear()} {brand.legalName}</p>
        </div>
      </div>
      <main id="main" className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Image src={brand.logoPath} alt={brand.name} width={168} height={32} priority className="mb-10 h-8 w-auto" />
          {children}
        </div>
      </main>
    </div>
  );
}
