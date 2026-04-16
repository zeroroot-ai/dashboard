import Link from "next/link";
import { Settings } from "lucide-react";
import { CompleteYourProfileCard } from "./components/complete-your-profile";
import { generateMeta } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { CardSkills } from "./components/card-skills";
import { LatestActivity } from "./components/latest-activity";
import { AboutMe } from "./components/about-me";
import { Connections } from "./components/connections";
import { ProfileCard } from "./components/profile-card";

export async function generateMetadata() {
  return generateMeta({
    title: "Profile Page",
    additionalTitle: true,
    description:
      "Manage user profiles, skills, and activity feeds. A comprehensive admin dashboard page built with React, TypeScript, Tailwind CSS, and shadcn/ui components.",
    canonical: "/pages/profile"
  });
}

export default function Page() {
  return (
    <div className="space-y-4">
      <div className="flex flex-row items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight lg:text-2xl">Profile Page</h1>
        <div className="flex items-center space-x-2">
          <Button asChild>
            <Link href="/dashboard/pages/settings">
              <Settings />
              Settings
            </Link>
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="projects">Projects</TabsTrigger>
          <TabsTrigger value="activities">Activities</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          <ProfileCard />
          <CompleteYourProfileCard />
          <CardSkills />
        </div>
        <div className="space-y-4 xl:col-span-2">
          <LatestActivity />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <AboutMe />
            <Connections />
          </div>
        </div>
      </div>
    </div>
  );
}
