/**
 * Design system reference page (#52, single dark brand #653). Authoritative
 * visual ledger for the dashboard's tokens + typography + Shadcn primitives.
 *
 * There is one immutable dark brand. Each card inherits the live `:root`
 * tokens (no inline override), so this page documents the real rendered
 * brand and cannot drift from globals.css. Editing happens in
 * `app/globals.css` only.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";

type Token = { name: string; description: string };

const semanticTokens: Token[] = [
  { name: "--background", description: "Page background" },
  { name: "--foreground", description: "Body text on background" },
  { name: "--card", description: "Card / panel surface" },
  { name: "--card-foreground", description: "Body text on card" },
  { name: "--popover", description: "Popover / dropdown surface" },
  { name: "--popover-foreground", description: "Body text on popover" },
  { name: "--primary", description: "Primary action (violet)" },
  { name: "--primary-foreground", description: "Text on primary action" },
  { name: "--secondary", description: "Secondary action" },
  { name: "--secondary-foreground", description: "Text on secondary action" },
  { name: "--muted", description: "Muted surface" },
  { name: "--muted-foreground", description: "Subtle / helper text" },
  { name: "--accent", description: "Accent surface (hover / selected)" },
  { name: "--accent-foreground", description: "Text on accent" },
  { name: "--destructive", description: "Destructive action / error" },
  { name: "--border", description: "Default border" },
  { name: "--input", description: "Input border" },
  { name: "--ring", description: "Focus ring" },
];

const sidebarTokens: Token[] = [
  { name: "--sidebar", description: "Sidebar surface" },
  { name: "--sidebar-foreground", description: "Sidebar text" },
  { name: "--sidebar-primary", description: "Sidebar primary action" },
  { name: "--sidebar-primary-foreground", description: "Text on sidebar primary" },
  { name: "--sidebar-accent", description: "Sidebar hover / selected" },
  { name: "--sidebar-accent-foreground", description: "Text on sidebar accent" },
  { name: "--sidebar-border", description: "Sidebar border" },
  { name: "--sidebar-ring", description: "Sidebar focus ring" },
];

const chartTokens: Token[] = [
  { name: "--chart-1", description: "Series 1 (violet)" },
  { name: "--chart-2", description: "Series 2 (emerald)" },
  { name: "--chart-3", description: "Series 3 (cyan-blue)" },
  { name: "--chart-4", description: "Series 4 (amber)" },
  { name: "--chart-5", description: "Series 5 (red)" },
];

const specialtyTokens: Token[] = [
  { name: "--highlight", description: "Violet emphasis" },
  { name: "--alt", description: "Emerald accent" },
  { name: "--link", description: "Cyan link / cursor" },
  { name: "--glow-strength", description: "Glow scalar (premium-restrained)" },
  { name: "--scanline-opacity", description: "CRT scanline opacity" },
];

const typographyScale: Array<{ name: string; className: string; sample: string }> = [
  { name: "display / h1", className: "font-display text-4xl font-bold", sample: "Zero Root AI" },
  { name: "h2", className: "font-display text-2xl font-bold", sample: "Section heading" },
  { name: "h3", className: "font-display text-xl font-semibold", sample: "Subsection" },
  { name: "body", className: "text-base", sample: "The quick brown fox jumps over the lazy dog." },
  { name: "meta", className: "text-sm text-muted-foreground", sample: "helper / caption text" },
  { name: "code", className: "font-mono text-sm", sample: "GET /v1/missions/123" },
];

function BrandCard({ children }: { children: ReactNode }) {
  return (
    <div className="bg-background text-foreground rounded-lg border border-border p-6 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <span className="font-display text-sm font-bold uppercase tracking-widest text-muted-foreground">
          dark
        </span>
        <span className="text-xs text-muted-foreground">
          background · foreground · border · primary
        </span>
      </div>
      {children}
    </div>
  );
}

function TokenSwatchRow({ token }: { token: Token }) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card p-2">
      <div
        aria-hidden="true"
        className="h-10 w-10 flex-none rounded border border-border"
        style={{ backgroundColor: `var(${token.name})` }}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-card-foreground">{token.name}</div>
        <div className="truncate text-xs text-muted-foreground">{token.description}</div>
      </div>
    </div>
  );
}

function TokenGrid({ tokens }: { tokens: Token[] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {tokens.map((t) => (
        <TokenSwatchRow key={t.name} token={t} />
      ))}
    </div>
  );
}

function PrimitiveShowcase() {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Card title</CardTitle>
          <CardDescription>Card description sits on muted-foreground.</CardDescription>
          <CardAction>
            <Button size="sm" variant="outline">
              Action
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dt-input">Input</Label>
            <Input id="dt-input" placeholder="placeholder text" />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="dt-check" defaultChecked />
            <Label htmlFor="dt-check">Checkbox</Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="dt-switch" defaultChecked />
            <Label htmlFor="dt-switch">Switch</Label>
          </div>
        </CardContent>
        <CardFooter className="flex gap-2">
          <Badge>default</Badge>
          <Badge variant="secondary">secondary</Badge>
          <Badge variant="outline">outline</Badge>
          <Badge variant="destructive">destructive</Badge>
        </CardFooter>
      </Card>
    </div>
  );
}

function ChartStrip() {
  return (
    <div className="flex h-8 overflow-hidden rounded border border-border">
      {chartTokens.map((t) => (
        <div
          key={t.name}
          className="flex-1"
          style={{ backgroundColor: `var(${t.name})` }}
          aria-label={t.name}
          title={t.name}
        />
      ))}
    </div>
  );
}

function EffectsShowcase() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded border border-border bg-card p-6">
        <div className="text-zd-glow font-display text-xl text-highlight">Glow text</div>
        <div className="mt-2 text-xs text-muted-foreground">
          <code>.text-zd-glow</code> · uses <code>--glow-strength</code>
        </div>
      </div>
      <div className="rounded border border-border bg-card p-6">
        <div className="font-display text-xl text-foreground">
          Blinking cursor <span className="zd-cursor" aria-hidden="true" />
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          <code>.zd-cursor</code>
        </div>
      </div>
      <div className="rounded border border-border bg-card p-6">
        <div className="font-display text-base text-foreground">
          <span className="text-highlight">[</span>
          <span className="text-alt">gibson</span>
          <span className="text-highlight">@</span>
          <span className="text-highlight">zeroroot</span>
          <span className="text-alt">]: </span>
          <span className="text-highlight"> ~ </span>
          <span className="text-alt">$</span>
          <span className="zd-cursor ml-1" aria-hidden="true" />
        </div>
        <div className="mt-2 text-xs text-muted-foreground">terminal-prompt logo</div>
      </div>
      <div className="rounded border border-border bg-card p-6">
        <a className="font-display text-link underline underline-offset-4" href="#">
          Anchor link
        </a>
        <div className="mt-2 text-xs text-muted-foreground">
          <code>text-link</code>
        </div>
      </div>
    </div>
  );
}

export default function DesignTokensPage() {
  return (
    <div className="bg-zd-gradient min-h-screen px-6 py-12">
      <div className="mx-auto max-w-6xl space-y-12">
        <header className="rounded-lg border border-border bg-card p-6 text-card-foreground">
          <h1 className="font-display text-3xl font-bold text-highlight text-zd-glow">
            Design system reference
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Authoritative visual ledger for the dashboard&apos;s semantic + specialty tokens.
            Every Shadcn primitive auto-themes from these tokens. There is one immutable
            dark brand, editing happens in{" "}
            <code className="text-alt">app/globals.css</code> only.
          </p>
        </header>

        <section>
          <h2 className="mb-4 font-display text-2xl font-bold text-foreground">Semantic tokens</h2>
          <BrandCard>
            <TokenGrid tokens={semanticTokens} />
          </BrandCard>
        </section>

        <section>
          <h2 className="mb-4 font-display text-2xl font-bold text-foreground">Sidebar tokens</h2>
          <BrandCard>
            <TokenGrid tokens={sidebarTokens} />
          </BrandCard>
        </section>

        <section>
          <h2 className="mb-4 font-display text-2xl font-bold text-foreground">Chart tokens</h2>
          <BrandCard>
            <TokenGrid tokens={chartTokens} />
            <div className="mt-4">
              <ChartStrip />
            </div>
          </BrandCard>
        </section>

        <section>
          <h2 className="mb-4 font-display text-2xl font-bold text-foreground">Specialty tokens</h2>
          <BrandCard>
            <TokenGrid tokens={specialtyTokens} />
          </BrandCard>
        </section>

        <section>
          <h2 className="mb-4 font-display text-2xl font-bold text-foreground">Typography</h2>
          <BrandCard>
            <div className="space-y-3">
              {typographyScale.map((row) => (
                <div key={row.name} className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-widest text-muted-foreground">
                    {row.name}
                  </span>
                  <div className={row.className}>{row.sample}</div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Single mono-like family everywhere: <code>--font-display</code> ={" "}
              <code>--font-sans</code> = <code>--font-mono</code> = JetBrains Mono.
            </p>
          </BrandCard>
        </section>

        <section>
          <h2 className="mb-4 font-display text-2xl font-bold text-foreground">Shadcn primitives</h2>
          <BrandCard>
            <PrimitiveShowcase />
          </BrandCard>
        </section>

        <section>
          <h2 className="mb-4 font-display text-2xl font-bold text-foreground">Effects</h2>
          <BrandCard>
            <EffectsShowcase />
          </BrandCard>
        </section>
      </div>
    </div>
  );
}
