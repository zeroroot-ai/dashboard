import { promises as fs } from "fs";
import path from "path";

import Link from "next/link";
import { generateMeta } from "@/lib/utils";

import { PlusCircledIcon } from "@radix-ui/react-icons";
import { Button } from "@/components/ui/button";
import UsersDataTable from "./data-table";

export async function generateMetadata() {
  return generateMeta({
    title: "Users List",
    additionalTitle: true,
    description:
      "Manage user records and list data efficiently. A professional admin dashboard page built with React, TypeScript, Tailwind CSS, shadcn/ui, and Tanstack Table.",
    canonical: "/pages/users"
  });
}

async function getUsers() {
  const data = await fs.readFile(
    path.join(process.cwd(), "app/dashboard/(auth)/pages/users/data.json")
  );
  return JSON.parse(data.toString());
}

export default async function Page() {
  const users = await getUsers();

  return (
    <>
      <div className="flex items-center justify-between space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Users</h1>
        <Button asChild>
          <Link href="#">
            <PlusCircledIcon /> Add New User
          </Link>
        </Button>
      </div>
      <UsersDataTable data={users} />
    </>
  );
}
