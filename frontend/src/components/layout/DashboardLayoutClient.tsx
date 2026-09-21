"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Session } from "@/types";

interface DashboardLayoutClientProps {
  session: Session;
  children: React.ReactNode;
}

export function DashboardLayoutClient({ session, children }: DashboardLayoutClientProps) {
  const pathname = usePathname();
  const role = (session as any)?.role;
  const isAdmin = role !== "user";
  const isRecordPage = pathname === "/dashboard/record" || pathname.startsWith("/dashboard/record/");

  // Admin: always show sidebar
  if (isAdmin) {
    return (
      <div className="flex h-screen bg-slate-50 overflow-hidden">
        <Sidebar session={session} />
        <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
          {children}
        </main>
      </div>
    );
  }

  // Normal user on record page: no sidebar
  if (isRecordPage) {
    return (
      <div className="h-screen bg-slate-50 overflow-hidden">
        <main className="h-full overflow-y-auto">
          {children}
        </main>
      </div>
    );
  }

  // Normal user on other dashboard pages: show sidebar
  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <Sidebar session={session} />
      <main className="flex-1 overflow-y-auto pt-14 lg:pt-0">
        {children}
      </main>
    </div>
  );
}
