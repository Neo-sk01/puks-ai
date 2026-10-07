"use client";

// Replaces the entire root layout when it crashes, so it renders its own
// <html>/<body> and deliberately avoids anything from app/layout.tsx
// (ThemeProvider, fonts, etc.) — the whole point is to still work when
// those have failed. Next.js auto-generates one of these if it's missing;
// with output: "standalone" that auto-generated page fails to prerender
// (TypeError: Cannot read properties of null (reading 'useContext')), so
// this exists to replace it rather than to add new behavior.
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem 1.5rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
        <p style={{ color: "#666", marginBottom: "1.5rem" }}>Please try again.</p>
        <button
          onClick={() => reset()}
          style={{ padding: "0.5rem 1.25rem", borderRadius: "0.375rem", border: "1px solid #ccc", cursor: "pointer" }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
