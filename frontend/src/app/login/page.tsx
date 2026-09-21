"use client";

import { Suspense, useState, useTransition } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, Loader2, Mail, Lock, User, AlertCircle, CheckCircle2 } from "lucide-react";
import Image from "next/image";

type Tab = "login" | "signup";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  );
}

function InputField({ label, type, value, onChange, icon: Icon, placeholder, suffix, disabled, autoComplete }: {
  label: string; type: string; value: string; onChange: (v: string) => void;
  icon: any; placeholder: string; suffix?: React.ReactNode; disabled?: boolean; autoComplete?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1.5 tracking-wide uppercase">{label}</label>
      <div className="relative">
        <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
        <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          disabled={disabled} autoComplete={autoComplete}
          className="w-full pl-10 pr-10 py-3 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 transition-all" />
        {suffix && <div className="absolute right-3.5 top-1/2 -translate-y-1/2">{suffix}</div>}
      </div>
    </div>
  );
}

function LoginForm({ onSwitch }: { onSwitch: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") || "/";
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState("");
  const [pending, startT]       = useTransition();
  const [gBusy, setGBusy]       = useState(false);
  const busy = pending || gBusy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    startT(async () => {
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        if (result.error.includes("GOOGLE_ACCOUNT") || result.error.includes("EMAIL_GOOGLE_ACCOUNT")) setError("This email is linked to a Google account. Please sign in with Google.");
        else if (result.error.includes("SERVICE_UNAVAILABLE")) setError("Cannot reach the server. Please try again later.");
        else setError("Invalid email or password.");
        return;
      }
      if (result?.ok) { router.push(callbackUrl); router.refresh(); }
    });
  }

  async function handleGoogle() { if (busy) return; setGBusy(true); await signIn("google", { callbackUrl }); setGBusy(false); }

  return (
    <div className="space-y-4">
      {error && <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700"><AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /><span>{error}</span></div>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <InputField label="Email" type="email" value={email} onChange={setEmail} icon={Mail} placeholder="you@example.com" disabled={busy} autoComplete="email" />
        <InputField label="Password" type={showPass ? "text" : "password"} value={password} onChange={setPassword} icon={Lock} placeholder="••••••••" disabled={busy} autoComplete="current-password"
          suffix={<button type="button" onClick={() => setShowPass(s => !s)} className="text-gray-400 hover:text-gray-600">{showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>} />
        <button type="submit" disabled={busy || !email || !password}
          className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm mt-1">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Sign In
        </button>
      </form>
      <div className="relative my-1">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
        <div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-gray-400">or</span></div>
      </div>
      <button onClick={handleGoogle} disabled={busy}
        className="w-full flex items-center justify-center gap-3 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 transition-all">
        {gBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />} Continue with Google
      </button>
      <p className="text-center text-sm text-gray-500 pt-1">Don&apos;t have an account?{" "}<button onClick={onSwitch} className="text-indigo-600 font-semibold hover:underline">Sign up</button></p>
    </div>
  );
}

function SignupForm({ onSwitch }: { onSwitch: () => void }) {
  const router = useRouter();
  const [name, setName]       = useState("");
  const [email, setEmail]     = useState("");
  const [password, setPass]   = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPass, setShowP]  = useState(false);
  const [error, setError]     = useState("");
  const [pending, startT]     = useTransition();
  const [gBusy, setGBusy]     = useState(false);
  const busy = pending || gBusy;

  const rules = [{ ok: password.length >= 8, text: "8+ characters" }, { ok: /[A-Z]/.test(password), text: "One uppercase letter" }, { ok: /[0-9]/.test(password), text: "One number" }];
  const passValid = rules.every(r => r.ok);
  const passMatch = password.length > 0 && confirm === password;
  const canSubmit = !busy && name.trim() && email && passValid && passMatch;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault(); if (!canSubmit) return; setError("");
    startT(async () => {
      let res: Response;
      try { res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:3014"}/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.trim(), email, password }) }); }
      catch { setError("Cannot reach the server. Please try again later."); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({})); const code = body?.detail?.code ?? "";
        if (code === "EMAIL_TAKEN") setError("An account with this email already exists.");
        else if (code === "EMAIL_GOOGLE_ACCOUNT") setError("This email is linked to a Google account. Please sign in with Google.");
        else setError(body?.detail?.message || "Registration failed. Please try again."); return;
      }
      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.ok) { router.push("/"); router.refresh(); } else onSwitch();
    });
  }

  async function handleGoogle() { if (busy) return; setGBusy(true); await signIn("google", { callbackUrl: "/" }); setGBusy(false); }

  return (
    <div className="space-y-4">
      {error && <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700"><AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" /><span>{error}</span></div>}
      <form onSubmit={handleSubmit} className="space-y-3">
        <InputField label="Full Name" type="text" value={name} onChange={setName} icon={User} placeholder="Jane Smith" disabled={busy} autoComplete="name" />
        <InputField label="Email" type="email" value={email} onChange={setEmail} icon={Mail} placeholder="you@example.com" disabled={busy} autoComplete="email" />
        <div>
          <InputField label="Password" type={showPass ? "text" : "password"} value={password} onChange={setPass} icon={Lock} placeholder="Min 8 chars, 1 uppercase, 1 number" disabled={busy} autoComplete="new-password"
            suffix={<button type="button" onClick={() => setShowP(s => !s)} className="text-gray-400 hover:text-gray-600">{showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>} />
          {password && <div className="flex gap-3 mt-2">{rules.map(({ ok, text }) => (<span key={text} className={`flex items-center gap-1 text-xs ${ok ? "text-green-600" : "text-gray-400"}`}>{ok ? <CheckCircle2 className="h-3 w-3" /> : <span className="w-3 h-3 rounded-full border border-gray-300 inline-block" />}{text}</span>))}</div>}
        </div>
        <div>
          <InputField label="Confirm Password" type={showPass ? "text" : "password"} value={confirm} onChange={setConfirm} icon={Lock} placeholder="Repeat your password" disabled={busy} autoComplete="new-password" />
          {confirm && <p className={`text-xs mt-1.5 ${passMatch ? "text-green-600" : "text-red-500"}`}>{passMatch ? "✓ Passwords match" : "Passwords do not match"}</p>}
        </div>
        <button type="submit" disabled={!canSubmit}
          className="w-full py-3 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-sm mt-1">
          {pending && <Loader2 className="h-4 w-4 animate-spin" />} Create Account
        </button>
      </form>
      <div className="relative my-1">
        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
        <div className="relative flex justify-center"><span className="bg-white px-3 text-xs text-gray-400">or</span></div>
      </div>
      <button onClick={handleGoogle} disabled={busy}
        className="w-full flex items-center justify-center gap-3 py-3 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 transition-all">
        {gBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />} Continue with Google
      </button>
      <p className="text-center text-sm text-gray-500 pt-1">Already have an account?{" "}<button onClick={onSwitch} className="text-indigo-600 font-semibold hover:underline">Sign in</button></p>
    </div>
  );
}

function LoginPageInner() {
  const params = useSearchParams();
  const [tab, setTab] = useState<Tab>(params.get("tab") === "signup" ? "signup" : "login");
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-violet-600/20 rounded-full blur-3xl" />
      </div>
      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white rounded-2xl shadow-lg shadow-indigo-500/30 mb-4 overflow-hidden border border-white/20">
            <Image src="/smart-mom.png" alt="Smart MoM" width={56} height={56} priority />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Smart MoM</h1>
          <p className="text-indigo-300 mt-1.5 text-sm">AI-powered meeting intelligence</p>
        </div>
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-white/10">
          <div className="flex border-b border-gray-100 bg-gray-50/80">
            {(["login", "signup"] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`flex-1 py-4 text-sm font-semibold transition-all ${tab === t ? "text-indigo-700 bg-white border-b-2 border-indigo-600" : "text-gray-500 hover:text-gray-700"}`}>
                {t === "login" ? "Sign In" : "Create Account"}
              </button>
            ))}
          </div>
          <div className="p-7">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-gray-900">{tab === "login" ? "Welcome back" : "Get started today"}</h2>
              <p className="text-sm text-gray-500 mt-1">{tab === "login" ? "Sign in to your Smart MoM account" : "Create your free account to get started"}</p>
            </div>
            {tab === "login" ? <LoginForm onSwitch={() => setTab("signup")} /> : <SignupForm onSwitch={() => setTab("login")} />}
          </div>
        </div>
        <p className="text-center text-indigo-400/50 text-xs mt-6">Powered by INT.</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-indigo-400" /></div>}>
      <LoginPageInner />
    </Suspense>
  );
}
