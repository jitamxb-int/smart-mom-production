import Link from "next/link";
import { WifiOff, Mic, RefreshCw } from "lucide-react";

export const metadata = {
  title: "Offline — Smart MoM",
};

export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-3xl shadow-sm p-8 text-center">
        <div className="mx-auto w-20 h-20 rounded-full bg-amber-50 ring-4 ring-amber-100 flex items-center justify-center">
          <WifiOff className="h-9 w-9 text-amber-600" />
        </div>

        <h1 className="mt-5 text-xl font-bold text-gray-900">You&apos;re offline</h1>
        <p className="mt-2 text-sm text-gray-500">
          This page isn&apos;t available without a connection. You can still record a
          meeting — the audio is saved on this device and uploaded automatically once
          you&apos;re back online.
        </p>

        <Link
          href="/dashboard/record"
          className="mt-6 w-full inline-flex items-center justify-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-semibold transition-colors"
        >
          <Mic className="h-4 w-4" /> Go to Recording
        </Link>

        <p className="mt-4 text-xs text-gray-400 flex items-center justify-center gap-1.5">
          <RefreshCw className="h-3 w-3" /> Reconnect and reload to continue.
        </p>
      </div>
    </div>
  );
}
