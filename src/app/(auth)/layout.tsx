import Image from "next/image";
import { brand } from "@/config/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,520px)]">
      <div className="relative hidden overflow-hidden border-r bg-brand-soft lg:block">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-accent" aria-hidden />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(var(--surface)),transparent_70%)]" aria-hidden />
        <div className="relative flex h-full flex-col items-center justify-center p-12 text-center">
          <Image src={brand.fullLogoPath} alt={brand.name} width={brand.fullLogoSize.width} height={brand.fullLogoSize.height} priority className="h-auto w-full max-w-[360px]" />
          <p className="mt-10 max-w-md text-2xl font-semibold leading-tight tracking-tight text-brand">Service operations, documentation and billing in one place.</p>
          <p className="mt-3 text-[15px] text-muted-foreground">{brand.tagline}.</p>
          <p className="absolute bottom-8 text-[13px] text-muted-foreground">© {new Date().getFullYear()} {brand.legalName}</p>
        </div>
      </div>
      <main id="main" className="flex items-center justify-center bg-surface px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          <Image src={brand.logoPath} alt={brand.name} width={brand.logoSize.width} height={brand.logoSize.height} priority className="mb-10 h-14 w-auto lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
