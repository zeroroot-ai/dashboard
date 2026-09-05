/**
 * /dashboard/missions/templates, gallery of mission templates
 * shipped from the ADK. Each card links to a detail page where
 * the user can preview the mission and click "Use this template"
 * to seed a new authoring session.
 *
 * Spec: mission-dashboard-rewrite Requirement 6 AC 1.
 */

import Link from "next/link";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { listTemplates } from "./_lib/templates";

export const metadata = {
  title: "Mission Templates",
  description: "Reusable mission templates shipped by the ADK.",
};

export default function TemplatesGallery() {
  const templates = listTemplates();
  return (
    <div className="px-6 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Mission Templates</h1>
        <p className="text-muted-foreground">
          Start from a known-good mission. Click any template to
          preview, then customize and submit.
        </p>
      </header>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <Link
            key={t.id}
            href={`/dashboard/missions/templates/${t.id}`}
            className="block transition-colors"
          >
            <Card className="h-full hover:border-primary">
              <CardHeader>
                <CardTitle>{t.title}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
