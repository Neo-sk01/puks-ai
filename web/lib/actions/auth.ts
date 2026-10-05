"use server";

import { signOut } from "@/auth";

/** Passed by reference into UserMenu.tsx's <form action={signOutAction}>.
 *  Server Actions have to live in a "use server" file to be importable from
 *  a Client Component — an inline arrow in the client file isn't allowed. */
export async function signOutAction() {
  await signOut({ redirectTo: "/sign-in" });
}
