import { ArrowRight, CalendarDays, ChevronRight, Megaphone, SquareTerminal } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { generateMeta } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export async function generateMetadata() {
  return generateMeta({
    title: "Empty State 02",
    additionalTitle: true,
    description:
      "Empty states show placeholder content when no data is available. Built with shadcn/ui, Tailwind CSS, Next.js and React.",
    canonical: "/pages/empty-states/02"
  });
}

const templates = [
  {
    icon: Megaphone,
    iconBg: "bg-pink-500",
    title: "Marketing Campaign",
    description: "Plan and launch engaging campaigns to reach your audience."
  },
  {
    icon: SquareTerminal,
    iconBg: "bg-purple-500",
    title: "Engineering Project",
    description: "Manage complex builds and bring your technical ideas to life."
  },
  {
    icon: CalendarDays,
    iconBg: "bg-orange-500",
    title: "Event",
    description: "Organize and track events that matter — from meetups to conferences."
  }
] as const;

export default function Page() {
  return (
    <div className="flex h-(--content-full-height) flex-col items-center justify-center">
      <div className="mx-auto max-w-md space-y-4 text-center">
        <header className="space-y-1">
          <h2 className="text-2xl font-bold">Create your first project</h2>
          <p className="text-muted-foreground text-sm">
            Start by selecting a template or begin with a blank canvas.
          </p>
        </header>

        <div className="space-y-3">
          {templates.map(({ icon: Icon, iconBg, title, description }) => (
            <Card
              key={title}
              className="group hover:bg-muted flex cursor-pointer flex-row items-center gap-4 p-4">
              <div
                className={`flex size-10 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
                <Icon className="size-4 text-white" />
              </div>
              <div className="grow text-left">
                <h3 className="text-base font-medium">{title}</h3>
                <p className="text-muted-foreground text-sm">{description}</p>
              </div>
              <span className="group-hover:bg-background ml-auto flex size-6 shrink-0 items-center justify-center rounded-full border">
                <ChevronRight className="text-muted-foreground size-4" />
              </span>
            </Card>
          ))}
        </div>

        <div>
          <Button variant="link" asChild>
            <Link href="#">
              or start from an empty project
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
