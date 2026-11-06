import next from "eslint-config-next";

const config = [
  { ignores: [".next/**", "node_modules/**", "storage/**", "data/**", ".cache/**", "coverage/**"] },
  ...next,
  {
    rules: {
      // Plan §1 [v2.2]: user text must only ever be rendered as escaped text nodes.
      "react/no-danger": "error",
    },
  },
  {
    // Client code must never import server modules (DB, fal, ffmpeg, renderer, secrets).
    files: ["src/components/**/*.{ts,tsx}", "src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [{ group: ["@/server/*", "@/worker/*"], message: "Server-only module imported from client-safe code." }] }],
    },
  },
];

export default config;
