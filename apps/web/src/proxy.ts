import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const isAuthPage = req.nextUrl.pathname.startsWith("/login");

  // 1. If trying to access dashboard but not logged in -> Redirect to Login
  if (!isLoggedIn && !isAuthPage) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }

  // 2. If logged in but trying to access Login page -> Redirect to Dashboard
  if (isLoggedIn && isAuthPage) {
    return NextResponse.redirect(new URL("/", req.nextUrl));
  }

  return NextResponse.next();
});

// 3. Define which routes trigger this guard
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
