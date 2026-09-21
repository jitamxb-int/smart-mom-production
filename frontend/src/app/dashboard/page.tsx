"use client";

import { useAppSelector } from "@/store/hooks";
import { useStats } from "@/hooks/useMeetings";
import { Loader2, Mic, MessageSquare, Radio, CheckCircle2, Brain, GitBranch } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";

export default function DashboardPage() {
  const sessionUser = useAppSelector(s => s.session.user);
  const role        = useAppSelector(s => s.session.role);
  const name        = sessionUser?.name?.split(" ")[0] || "";
  const isSimpleUser = role === "user";

  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const { stats, isLoading } = useStats();

  const statCards = [
    { label: "Total Meetings",  value: stats?.total,        icon: Mic,          color: "indigo", desc: "All time"              },
    { label: "Transcribed",     value: stats?.transcribed,  icon: CheckCircle2, color: "teal",   desc: "Ready to analyze"      },
    { label: "Chat Ready",      value: stats?.indexed,      icon: Brain,        color: "violet", desc: "AI-indexed"            },
    { label: "With Diagram",    value: stats?.with_diagram, icon: GitBranch,    color: "amber",  desc: "Visual flow generated" },
  ];

  const colorMap: Record<string, string> = {
    indigo: "bg-indigo-50 border-indigo-100 text-indigo-600",
    teal:   "bg-teal-50   border-teal-100   text-teal-600",
    violet: "bg-violet-50 border-violet-100 text-violet-600",
    amber:  "bg-amber-50  border-amber-100  text-amber-600",
  };
  const iconBg: Record<string, string> = {
    indigo: "bg-indigo-100 text-indigo-600",
    teal:   "bg-teal-100   text-teal-600",
    violet: "bg-violet-100 text-violet-600",
    amber:  "bg-amber-100  text-amber-600",
  };

  return (
    <div className="min-h-full bg-slate-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">

        {/* Header */}
        <div className="mb-6 sm:mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
              {greeting}{name ? `, ${name}` : ""} 👋
            </h1>
            <p className="text-gray-500 text-sm mt-1">Here&apos;s an overview of your meeting intelligence.</p>
          </div>
          {isSimpleUser && (
            <Link
              href="/dashboard/record"
              className="flex-shrink-0 inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-semibold text-sm shadow-sm transition-colors"
            >
              <Radio className="h-4 w-4" /> Recording
            </Link>
          )}
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {statCards.map(({ label, value, icon: Icon, color, desc }) => (
            <div key={label} className={`rounded-2xl border p-4 sm:p-5 ${colorMap[color]}`}>
              <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center mb-2 sm:mb-3 ${iconBg[color]}`}>
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-xl sm:text-2xl font-bold mt-0.5">
                {isLoading ? <Loader2 className="h-5 w-5 animate-spin inline" /> : (value ?? 0)}
              </p>
              <p className="text-xs font-semibold mt-0.5 opacity-90 leading-tight">{label}</p>
              <p className="text-xs opacity-60 mt-0.5 hidden sm:block">{desc}</p>
            </div>
          ))}
        </div>

        {/* Quick actions */}
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3">Quick Actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {[
              { href: "/dashboard/record",   icon: Radio,          title: "Record Meeting",  desc: "Start recording and get AI transcription",       color: "indigo" },
              { href: "/dashboard/meetings", icon: Mic,            title: "View Meetings",   desc: "Browse and manage all your recordings",           color: "teal"   },
              { href: "/dashboard/chat",     icon: MessageSquare,  title: "Ask Smart MoM",    desc: "Chat across all your indexed transcripts",        color: "violet" },
            ].map(({ href, icon: Icon, title, desc, color }) => (
              <Link key={href} href={href} prefetch={true}
                className="flex items-start gap-4 p-5 bg-white border border-gray-200 rounded-2xl hover:border-indigo-300 hover:shadow-md transition-all group">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg[color]}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-gray-800 group-hover:text-indigo-700 transition-colors">{title}</p>
                  <p className="text-sm text-gray-500 mt-0.5">{desc}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>

        {/* Getting started CTA */}
        {!isLoading && (stats?.total ?? 0) === 0 && (
          <div className="bg-gradient-to-br from-indigo-600 to-violet-700 rounded-2xl p-6 text-white">
            <h3 className="font-bold text-lg mb-1">Welcome to MeetMind!</h3>
            <p className="text-indigo-200 text-sm mb-4">
              Record your first meeting to get started with AI transcription, summaries, and intelligent chat.
            </p>
            <Link href="/dashboard/record" prefetch={true}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-white text-indigo-700 font-semibold rounded-xl text-sm hover:bg-indigo-50 transition-colors">
              <Radio className="h-4 w-4" /> Record Your First Meeting
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
