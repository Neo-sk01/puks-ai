"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/** Class-based theming: next-themes toggles `.dark` on <html>, which is what
 *  globals.css's `@custom-variant dark` and `.dark { … }` token overrides key
 *  on. `system` is the default so first-time visitors get their OS preference
 *  with no flash — next-themes injects a tiny pre-paint script for that. */
export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
