import React from "react";
import { cookies, headers } from "next/headers";
import { cn } from "@/lib/utils";
import { ThemeProvider } from "next-themes";
import GoogleAnalyticsInit from "@/lib/ga";
import { fontVariables } from "@/lib/fonts";
import NextTopLoader from "nextjs-toploader";
import { GibsonProviders } from "@/app/providers";

import "./globals.css";

import { ActiveThemeProvider } from "@/components/active-theme";
import { DEFAULT_THEME } from "@/lib/themes";
import type { ThemeType } from "@/lib/themes";
import { Toaster } from "@/components/ui/sonner";

export default async function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const themeChoice = cookieStore.get("theme_choice")?.value ?? "dark";

  // Pre-apply the theme class to <html> server-side so the first paint
  // matches the user's stored preference (or the dark default). Without
  // this, body's bg-background CSS variable resolves against :root (light)
  // until next-themes' inline script runs and adds the .dark class — a
  // visible white flash on every cold load. The script still runs and
  // syncs localStorage; if a user's localStorage diverges from the
  // cookie they get a single tiny flip on hydration. New visitors (no
  // cookie) see dark immediately, which is what the brand defaults to.
  //
  // For themeChoice="system" we still server-render dark and let the
  // client-side script flip to light if the user's OS prefers light —
  // the alternative (white flash, then maybe dark) is worse than the
  // reverse on the rare system-preference-is-light case.
  const initialThemeClass = themeChoice === "light" ? "" : "dark";

  const themeSettings = {
    preset: cookieStore.get("theme_preset")?.value ?? DEFAULT_THEME.preset,
    scale: cookieStore.get("theme_scale")?.value ?? DEFAULT_THEME.scale,
    radius: cookieStore.get("theme_radius")?.value ?? DEFAULT_THEME.radius,
    contentLayout: cookieStore.get("theme_content_layout")?.value ?? DEFAULT_THEME.contentLayout,
  } as ThemeType;

  const bodyAttributes = Object.fromEntries(
    Object.entries(themeSettings)
      .filter(([_, value]) => value)
      .map(([key, value]) => [`data-theme-${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`, value])
  );

  return (
    <html lang="en" suppressHydrationWarning className={initialThemeClass}>
      <body
        suppressHydrationWarning
        className={cn("bg-background group/layout font-sans", fontVariables)}
        {...bodyAttributes}>
        <ThemeProvider
          attribute="class"
          defaultTheme={themeChoice}
          enableSystem
          disableTransitionOnChange
          nonce={nonce}>
          <ActiveThemeProvider initialTheme={themeSettings}>
            <GibsonProviders>
              {children}
            </GibsonProviders>
            <Toaster position="top-center" richColors />
            <NextTopLoader color="var(--primary)" showSpinner={false} height={2} shadow-sm="none" />
            {process.env.NODE_ENV === "production" ? <GoogleAnalyticsInit /> : null}
          </ActiveThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
