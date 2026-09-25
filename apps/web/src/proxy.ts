import { auth } from "@/auth";
import { NextResponse } from "next/server";
export default auth((req) => {
  const pathname = req.nextUrl.pathname;
  const publicPages = ["/login", "/register", "/register/workspace", "/register/invite", "/verify-email", "/forgot-password", "/reset-password"];
  if (!req.auth && !publicPages.includes(pathname)) return NextResponse.redirect(new URL("/login", req.nextUrl));
  if (req.auth && ["/login", "/register", "/register/workspace"].includes(pathname)) return NextResponse.redirect(new URL("/", req.nextUrl));
  const response = NextResponse.next();
  if (publicPages.includes(pathname)) {
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Robots-Tag", "noindex");
  }
  return response;
});
export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"] };
