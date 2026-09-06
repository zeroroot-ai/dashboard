"use server";
// Legal: server action uses the canonical gibson-client wrapper.
// Walker should find ZERO findings on this file.
import { listMyMemberships } from "@/lib/gibson-client";

export async function action() {
  return listMyMemberships();
}
