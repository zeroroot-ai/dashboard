import { Network, ShieldAlert, Server } from "lucide-react";

const signals = [
  { icon: Network, label: "The graph your agents share" },
  { icon: ShieldAlert, label: "A sandbox you'd point at malware" },
  { icon: Server, label: "Your cluster, your LLM keys" },
] as const;

export function TrustSignals() {
  return (
    <section className="flex justify-center gap-12 py-16 text-muted-foreground px-4 flex-wrap">
      {signals.map(({ icon: Icon, label }) => (
        <div key={label} className="flex items-center gap-2">
          <Icon className="h-5 w-5 shrink-0" />
          <span className="text-sm font-medium">{label}</span>
        </div>
      ))}
    </section>
  );
}
