"use client";

import { Suspense } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { Loader2, MessageSquare, Radio } from "lucide-react";
import Link from "next/link";
import { useAppSelector } from "@/store/hooks";

function ChatPageInner() {
  const role = useAppSelector(s => s.session.role);
  const isSimpleUser = role === "user";

  return (
    <div className="min-h-full bg-slate-50 flex flex-col">
      <div className="px-4 sm:px-6 py-4 sm:py-5 border-b border-gray-200 bg-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2.5">
              <div className="w-7 h-7 sm:w-8 sm:h-8 bg-violet-600 rounded-xl flex items-center justify-center flex-shrink-0">
                <MessageSquare className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-white" />
              </div>
              Smart MoM Chat
            </h1>
            <p className="text-gray-500 text-sm mt-1 ml-9 sm:ml-10">
              Ask questions across your indexed meeting transcripts.
            </p>
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
      </div>
      <div className="flex-1 min-h-0 p-3 sm:p-6">
        <ChatInterface />
      </div>
    </div>
  );
}

export default function GlobalChatPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-violet-600" />
      </div>
    }>
      <ChatPageInner />
    </Suspense>
  );
}
