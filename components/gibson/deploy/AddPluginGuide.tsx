'use client';

/**
 * AddPluginGuide
 *
 * Replaces the deleted plugin-registration wizard (manifest upload +
 * bootstrap token, ADR-0065/0066 retired that model). A plugin is now
 * vendor-SDK code authored in the `integrations` monorepo, deployed by
 * adding an entry under `.Values.plugins.<vendor>` in GitOps, and
 * auto-enrolled in-cluster via its SPIFFE SVID, no manifest upload, no
 * bootstrap token, no CLI enroll command.
 *
 * This panel is read-only and informational: it walks the real lifecycle
 * end to end so an operator knows exactly what to do next, and links out to
 * the docs and the example plugin instead of re-deriving them here.
 */

import Link from 'next/link';
import {
  GitForkIcon,
  FileCode2Icon,
  GitPullRequestIcon,
  SettingsIcon,
  ShieldCheckIcon,
  ArrowLeftIcon,
  ExternalLinkIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const EXAMPLE_PLUGIN_URL =
  'https://github.com/zeroroot-ai/integrations/tree/main/plugins/github';

const HANDLER_SNIPPET = `type GetRepositoryRequest struct {
    Owner string
    Repo  string
}

type GetRepositoryResponse struct {
    FullName string
    Stars    int
}

func main() {
    plugin.Serve(
        plugin.WithManifest(manifest),
        plugin.WithHandler("GetRepository", handleGetRepository),
    )
}`;

const VALUES_SNIPPET = `plugins:
  github:
    enabled: true
    image:
      repository: ghcr.io/your-org/integrations/github
      tag: v0.1.0
    runtime: pod`;

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="bg-muted overflow-x-auto rounded-md px-3 py-2 font-mono text-xs leading-relaxed">
      <code>{code}</code>
    </pre>
  );
}

function DocsLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary inline-flex items-center gap-1 text-xs underline underline-offset-2"
    >
      {children}
      <ExternalLinkIcon className="size-3" aria-hidden="true" />
    </a>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span
      className="bg-highlight/15 text-highlight flex size-5 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold"
      aria-hidden="true"
    >
      {n}
    </span>
  );
}

interface AddPluginGuideProps {
  docsPluginsHref: string;
  docsBootstrapHref: string;
  onBack: () => void;
}

export function AddPluginGuide({
  docsPluginsHref,
  docsBootstrapHref,
  onBack,
}: AddPluginGuideProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold tracking-tight font-mono text-glow-green">
          Add a plugin
        </h2>
        <p className="text-sm text-muted-foreground">
          Plugins are vendor-SDK code you author and deploy through GitOps.
          There is no manifest upload and no bootstrap token, follow the
          steps below.
        </p>
      </div>

      <div className="space-y-3">
        <Card className="border-border/60 bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <StepNumber n={1} />
              <GitForkIcon className="text-highlight size-4" aria-hidden="true" />
              Author it in your integrations repo
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 pb-4 text-sm">
            <p>
              Fork or clone <code className="bg-muted rounded px-1 font-mono text-xs">integrations</code>,
              copy the <code className="bg-muted rounded px-1 font-mono text-xs">plugins/github</code> example, and replace its
              handlers with calls to your vendor&apos;s API.
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <DocsLink href={docsPluginsHref}>Plugin authoring docs</DocsLink>
              <DocsLink href={EXAMPLE_PLUGIN_URL}>Example plugin on GitHub</DocsLink>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <StepNumber n={2} />
              <FileCode2Icon className="text-highlight size-4" aria-hidden="true" />
              Write handler.go
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 pb-4 text-sm">
            <p>
              Typed Go request and response structs, one <code className="bg-muted rounded px-1 font-mono text-xs">WithHandler</code> call
              per method, served by <code className="bg-muted rounded px-1 font-mono text-xs">plugin.Serve</code>.
            </p>
            <CodeBlock code={HANDLER_SNIPPET} />
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <StepNumber n={3} />
              <GitPullRequestIcon className="text-highlight size-4" aria-hidden="true" />
              Open a pull request
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 pb-4 text-sm">
            <p>
              Your repo&apos;s CI builds the plugin image and pushes it to your own registry, for example{' '}
              <code className="bg-muted rounded px-1 font-mono text-xs">
                ghcr.io/&lt;org&gt;/integrations/&lt;vendor&gt;
              </code>.
            </p>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <StepNumber n={4} />
              <SettingsIcon className="text-highlight size-4" aria-hidden="true" />
              Enable it in your GitOps values
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 pb-4 text-sm">
            <p>
              Add an entry under <code className="bg-muted rounded px-1 font-mono text-xs">.Values.plugins.&lt;vendor&gt;</code> with
              the image you just built.
            </p>
            <CodeBlock code={VALUES_SNIPPET} />
            <DocsLink href={docsPluginsHref}>Deployment docs</DocsLink>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/60">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <StepNumber n={5} />
              <ShieldCheckIcon className="text-highlight size-4" aria-hidden="true" />
              It auto-enrolls, no manual step
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground space-y-2 pb-4 text-sm">
            <p>
              The plugin authenticates with its SPIFFE SVID the moment it
              starts. There is no token to paste and no CLI command to run.
              It appears on the Plugins page once it is Ready.
            </p>
            <DocsLink href={docsBootstrapHref}>How component bootstrap works</DocsLink>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground">
          <ArrowLeftIcon className="size-4" />
          Back
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard/plugins">View plugins</Link>
        </Button>
      </div>
    </div>
  );
}
