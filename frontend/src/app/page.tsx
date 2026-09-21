import { redirect } from "next/navigation";
import { auth } from "@/auth";

// The root URL has no content of its own.
// Normal users land on /dashboard/record (recording view), admin users on /dashboard.
// Unauthenticated visitors are redirected to /login by middleware.
export default async function RootPage() {
  const session = await auth();
  if (!session) {
    // Will be caught by middleware and redirected to /login
    redirect("/dashboard");
  }

  const role = (session as any)?.role;

  // Normal users go directly to recording page
  if (role === "user") {
    redirect("/dashboard/record");
  }

  // Admin users go to dashboard
  redirect("/dashboard");
}
