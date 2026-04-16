import { Metadata } from "next";
import { generateMeta } from "@/lib/utils";
import { Link2, MoreHorizontal, Pencil, Share2, UserPlus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ProfileHeader } from "./components/profile-header";
import { ProfileSidebar } from "./components/profile-sidebar";
import { ActivityStream } from "./components/activity-stream";
import { ConnectionsTeams } from "./components/connections-teams";
import { ProjectsTable } from "./components/projects-table";

export async function generateMetadata(): Promise<Metadata> {
  return generateMeta({
    title: "User Profile Page",
    additionalTitle: true,
    description:
      "Manage detailed user profiles, activity streams, and projects. A professional dashboard page built with React, TypeScript, Tailwind CSS, and shadcn/ui components.",
    canonical: "/pages/profile-v2"
  });
}

export default function Page() {
  return (
    <div className="mx-auto min-h-screen lg:max-w-7xl xl:pt-6">
      <div className="space-y-4">
        <div className="bg-card overflow-hidden rounded-md border">
          <ProfileHeader />

          <div className="border-t">
            <div className="flex items-center justify-between px-4">
              <Tabs defaultValue="profile" className="flex-1">
                <TabsList className="-mb-0.5 h-auto! gap-6 border-none bg-transparent p-0">
                  <TabsTrigger
                    value="profile"
                    className="data-[state=active]:border-b-primary data-[state=active]:text-foreground text-muted-foreground rounded-none border-0 border-b-2 border-transparent bg-transparent! px-0 py-4 shadow-none!">
                    Profile
                  </TabsTrigger>
                  <TabsTrigger
                    value="teams"
                    className="data-[state=active]:border-b-primary data-[state=active]:text-foreground text-muted-foreground rounded-none border-0 border-b-2 border-transparent bg-transparent! px-0 py-4 shadow-none!">
                    Teams
                  </TabsTrigger>
                  <TabsTrigger
                    value="projects"
                    className="data-[state=active]:border-b-primary data-[state=active]:text-foreground text-muted-foreground rounded-none border-0 border-b-2 border-transparent bg-transparent! px-0 py-4 shadow-none!">
                    Projects
                    <Badge variant="secondary" className="rounded-full">
                      3
                    </Badge>
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex items-center gap-2">
                <Button size="sm">
                  <UserPlus />
                  <span className="hidden md:inline">Connect</span>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="icon-sm">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem>
                      <Pencil />
                      Edit profile
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Share2 />
                      Share profile
                    </DropdownMenuItem>
                    <DropdownMenuItem>
                      <Link2 />
                      Copy link
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
        </div>

        <div className="gap-4 space-y-4 lg:grid lg:space-y-0 xl:grid-cols-[300px_1fr]">
          <ProfileSidebar />

          <main className="space-y-4">
            <ActivityStream />
            <ConnectionsTeams />
            <ProjectsTable />
          </main>
        </div>
      </div>
    </div>
  );
}
