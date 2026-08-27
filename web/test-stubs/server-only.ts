// Vitest stub for the "server-only" package.
//
// `import "server-only"` at the top of a lib file is a real dependency at
// build time — Next.js resolves it through its own bundled copy (there's
// no "server-only" entry in node_modules; Next special-cases the specifier
// in its webpack/turbopack config) and it throws if a file carrying it is
// ever pulled into a browser bundle. Vitest runs outside that pipeline —
// see vitest.config.ts's resolve.alias — so the same import needs
// something to resolve to here. A no-op is correct for tests: nothing
// under test runs in a browser, so there's nothing to guard against.
export {};
