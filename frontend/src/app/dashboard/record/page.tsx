import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { RecordClient } from "./RecordClient";

export default async function RecordPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <RecordClient
      initialRole={(session as any)?.role ?? "user"}
      initialUser={{
        name: session.user?.name,
        email: session.user?.email,
      }}
    />
  );
}
