import React from "react";
import { cn } from "@/lib/utils";
import GoogleAnalyticsInit from "@/lib/ga";
import { fontVariables } from "@/lib/fonts";
import NextTopLoader from "nextjs-toploader";
import { GibsonProviders } from "@/app/providers";

import "./globals.css";

import { Toaster } from "@/components/ui/sonner";

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  // One immutable dark brand (#651). There is no light mode, no theme
  // toggle, and no theme cookie. The `dark` class is applied statically so
  // the first paint is the brand on every cold load, no flash, no
  // next-themes inline script, no per-user/per-device theme state.
  return (
    <html lang="en" className="dark">
      <body className={cn("bg-background group/layout font-sans", fontVariables)}>
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
