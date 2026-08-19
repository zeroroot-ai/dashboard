import React from "react";
import { cn } from "@/lib/utils";
import GoogleAnalyticsInit from "@/lib/ga";
import NextTopLoader from "nextjs-toploader";
import { GibsonProviders } from "@/app/providers";

import "./globals.css";

import { Toaster } from "@/components/ui/sonner";

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  // One immutable brand, now light (ADR-0064). Still no theme toggle, no theme
  // cookie and no next-themes script: #650/#651 removed that and it stays
  // removed. The statically applied brand class is gone with the dark brand.
  //
  // No font variables either. The brand package self-hosts Inter Tight and
  // JetBrains Mono, so the twelve next/font Google downloads that used to be
  // injected here are gone along with lib/fonts.ts.
  return (
    <html lang="en">
      <body className={cn("bg-background group/layout font-sans")}>
        <GibsonProviders>
          {children}
        </GibsonProviders>
        <Toaster position="top-center" richColors />
        <NextTopLoader color="var(--primary)" showSpinner={false} height={2} shadow-sm="none" />
        {process.env.NODE_ENV === "production" ? <GoogleAnalyticsInit /> : null}
      </body>
    </html>
  );
}
