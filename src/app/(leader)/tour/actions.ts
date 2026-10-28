"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export async function finishTourAction(): Promise<void> {
  const session = await getSession();
  if (!session) return;

  // RLS limits the leader to their own row, and the column grant only
  // allows display_name and tour_done.
  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ tour_done: true })
    .eq("id", session.userId);

  if (error) {
    console.error("could not save tour state:", error.message);
    return;
  }
  revalidatePath("/");
}
