"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";

const ERROR_MESSAGES: Record<string, string> = {
  Configuration:       "There is a problem with the server configuration.",
  AccessDenied:        "You do not have permission to sign in.",
  Verification:        "The sign-in link is no longer valid.",
  CredentialsSignin:   "Invalid email or password.",
  INVALID_CREDENTIALS: "Invalid email or password.",
  GOOGLE_ACCOUNT:      "This account uses Google sign-in. Please continue with Google.",
  EMAIL_GOOGLE_ACCOUNT:"This email is linked to a Google account. Please sign in with Google.",
  SERVICE_UNAVAILABLE: "The server is unavailable. Please try again later.",
  Default:             "An unexpected error occurred. Please try again.",
};

function ErrorContent() {
  const params  = useSearchParams();
  const code    = params.get("error") || "Default";
  const message = ERROR_MESSAGES[code] || ERROR_MESSAGES.Default;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-2xl p-8 text-center">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="h-7 w-7 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Sign In Failed</h2>
          <p className="text-gray-600 text-sm mb-6">{message}</p>
          <Link
            href="/login"
            className="inline-block w-full py-2.5 bg-indigo-600 text-white font-medium
                       rounded-xl hover:bg-indigo-700 transition-colors text-sm text-center"
          >
            Back to Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
      </div>
    }>
      <ErrorContent />
    </Suspense>
  );
}
