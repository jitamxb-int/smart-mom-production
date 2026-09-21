import { auth } from "@/auth";
import { NextResponse } from "next/server";

function getRole(authObj: any): string | undefined {
  return (
    authObj?.role ??
    authObj?.user?.role ??
    authObj?.token?.role ??
    authObj?.session?.role
  );
}

export const middleware = auth((req) => {
  const { nextUrl } = req;
  const pathname = nextUrl.pathname;

  // next-auth "auth" wrapper will already handle unauthenticated access based on your auth config.
  // We only apply role-based routing constraints here.
  const role = getRole((req as any).auth);

  // Normal users can access: record (default), dashboard, meetings, chat
  if (role === "user" && pathname.startsWith("/dashboard")) {
    const allowed =
      pathname === "/dashboard" ||
      pathname === "/dashboard/record" ||
      pathname.startsWith("/dashboard/record/") ||
      pathname === "/dashboard/meetings" ||
      pathname.startsWith("/dashboard/meetings/") ||
      pathname === "/dashboard/chat";
    if (!allowed) {
      const url = nextUrl.clone();
      url.pathname = "/dashboard/record";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Protect all dashboard routes
    "/dashboard/:path*",
    // Protect API routes that are server-side (not NextAuth internal routes)
    "/api/((?!auth).)*",
  ],
};
