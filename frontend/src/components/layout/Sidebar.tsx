"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  LayoutDashboard, Mic, MessageSquare, LogOut, Shield,
  Radio, ChevronRight, Menu, X,
} from "lucide-react";
import Image from "next/image";
import { Session } from "@/types";
import { useState, useEffect, useRef } from "react";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { uiActions } from "@/store/slices/uiSlice";

const LOGO_SRC = "/smart-mom.png";

const baseNav = [
  { href: "/dashboard",          icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/meetings", icon: Mic,             label: "Meetings"  },
  { href: "/dashboard/record",   icon: Radio,           label: "Record"    },
  { href: "/dashboard/chat",     icon: MessageSquare,   label: "Chat"      },
];

// Normal users see a simplified navigation (no "Record" - it's a separate view)
const userNav = [
  { href: "/dashboard",          icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/meetings", icon: Mic,             label: "Meetings"  },
  { href: "/dashboard/chat",     icon: MessageSquare,   label: "Chat"      },
];
const adminNav = [
  { href: "/dashboard/admin", icon: Shield, label: "Admin Panel" },
];

function NavContent({ session, onNavClick }: { session: Session; onNavClick?: () => void }) {
  const pathname  = usePathname();
  const router    = useRouter();
  const dispatch  = useAppDispatch();
  const reduxRole = useAppSelector(s => s.session.role);
  const isAdmin   = reduxRole === "admin" || (session as any)?.role === "admin";
  const nav       = isAdmin ? [...baseNav, ...adminNav] : userNav;

  useEffect(() => { nav.forEach(({ href }) => router.prefetch(href)); }, []); // eslint-disable-line

  const handleNavClick = (href: string) => {
    if (href !== pathname) {
      dispatch(uiActions.setNavigating(true));
      dispatch(uiActions.markRouteVisited(href));
    }
    onNavClick?.();
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-5 py-5 border-b border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl overflow-hidden flex items-center justify-center flex-shrink-0 shadow-sm bg-white border border-gray-100">
            <Image src={LOGO_SRC} alt="Smart MoM" width={32} height={32} priority />
          </div>
          <div>
            <h1 className="text-base font-bold text-gray-900 leading-none">Smart MoM</h1>
            <p className="text-xs text-gray-400 mt-0.5">Meeting Intelligence</p>
          </div>
        </div>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ href, icon: Icon, label }) => {
          const active   = pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
          const isAdminL = label === "Admin Panel";
          return (
            <div key={href}>
              {isAdminL && <div className="border-t border-gray-100 my-2" />}
              <Link href={href} prefetch={true} onClick={() => handleNavClick(href)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  active ? (isAdminL ? "bg-amber-50 text-amber-700" : "bg-indigo-50 text-indigo-700")
                         : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"}`}>
                <Icon className={`h-4 w-4 flex-shrink-0 ${active ? (isAdminL ? "text-amber-600" : "text-indigo-600") : "text-gray-400"}`} />
                <span className="flex-1">{label}</span>
                {active && <ChevronRight className={`h-3.5 w-3.5 ${isAdminL ? "text-amber-400" : "text-indigo-400"}`} />}
              </Link>
            </div>
          );
        })}
      </nav>
      {isAdmin && (
        <div className="mx-3 mb-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-xl flex-shrink-0">
          <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
            <Shield className="h-3 w-3" /> ADMIN ACCESS
          </p>
        </div>
      )}
      <div className="p-3 border-t border-gray-100 flex-shrink-0">
        <div className="flex items-center gap-3 px-2 py-2 rounded-xl hover:bg-gray-50 transition-colors">
          {session?.user?.image ? (
            <Image src={session.user.image} alt="avatar" width={32} height={32} className="rounded-full flex-shrink-0" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 text-xs font-bold flex-shrink-0">
              {session?.user?.name?.[0] || "U"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-gray-800 truncate">{session?.user?.name}</p>
            <p className="text-xs text-gray-400 truncate">{session?.user?.email}</p>
          </div>
          <button onClick={() => signOut({ callbackUrl: "/login" })} title="Sign out"
            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function Sidebar({ session }: { session: Session }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    const h = (e: MouseEvent) => { if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) setMobileOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [mobileOpen]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  return (
    <>
      <aside className="hidden lg:flex w-60 flex-shrink-0 flex-col h-full bg-white border-r border-gray-100">
        <NavContent session={session} />
      </aside>
      <div className="lg:hidden fixed top-0 left-0 right-0 z-40 bg-white border-b border-gray-100 flex items-center px-4 h-14 shadow-sm">
        <button onClick={() => setMobileOpen(true)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-600" aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2 ml-3">
          <div className="w-6 h-6 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-white border border-gray-100">
            <Image src={LOGO_SRC} alt="Smart MoM" width={24} height={24} priority />
          </div>
          <span className="font-bold text-gray-900 text-sm">Smart MoM</span>
        </div>
      </div>
      {mobileOpen && <div className="lg:hidden fixed inset-0 bg-black/40 z-40 backdrop-blur-sm" aria-hidden="true" />}
      <div ref={drawerRef} className={`lg:hidden fixed top-0 left-0 h-full w-72 bg-white z-50 shadow-2xl transform transition-transform duration-300 ease-in-out ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <button onClick={() => setMobileOpen(false)} className="absolute top-3 right-3 p-2 rounded-lg hover:bg-gray-100 text-gray-500" aria-label="Close menu">
          <X className="h-5 w-5" />
        </button>
        <NavContent session={session} onNavClick={() => setMobileOpen(false)} />
      </div>
    </>
  );
}
