import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";

type PendingCookie = {
  name: string;
  value: string;
  options: CookieOptions;
};

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({
    request,
  });

  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders = new Headers();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          pendingCookies.splice(0, pendingCookies.length, ...cookiesToSet);

          response = NextResponse.next({
            request,
          });

          pendingCookies.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });

          if (headers instanceof Headers) {
            headers.forEach((value, key) => {
              pendingHeaders.set(key, value);
              response.headers.set(key, value);
            });
          } else if (headers) {
            Object.entries(headers).forEach(([key, value]) => {
              pendingHeaders.set(key, value);
              response.headers.set(key, value);
            });
          }
        },
      },
    },
  );

  await supabase.auth.getClaims();

  pendingHeaders.forEach((value, key) => {
    response.headers.set(key, value);
  });

  return response;
}
