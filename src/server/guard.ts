// Server modules are shared by Next route handlers and the plain-Node worker, so the
// `server-only` package (which throws outside the react-server condition) can't be used.
// This runtime guard + the ESLint import restriction keep them out of the browser.
if (typeof window !== "undefined") {
  throw new Error("Server module imported in the browser");
}
export {};
