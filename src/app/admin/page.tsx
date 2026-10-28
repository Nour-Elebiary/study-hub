import { redirect } from "next/navigation";

export default function AdminHomePage() {
  // The leaders list is the admin home — one less tap for the common task.
  redirect("/admin/leaders");
}
