import { Network, ShieldAlert, Server } from "lucide-react";

const signals = [
  { icon: ShieldAlert, label: "Hardware-isolated microVMs" },
  { icon: Network, label: "One graph every agent shares" },
  { icon: Server, label: "Your cluster, your LLM keys, your data" },
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
