import { ToolsContent } from '@/components/gibson/tools/ToolsContent';
import { generateMeta } from '@/lib/utils';

export function generateMetadata() {
  return generateMeta({ title: "Tools", description: "Registered security tools", canonical: "/tools" });
}

export default function ToolsPage() {
  return <ToolsContent />;
}
