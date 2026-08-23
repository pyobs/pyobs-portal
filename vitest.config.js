import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Excludes vitest's own defaults (node_modules, dist, etc.) plus any
    // .claude/worktrees/ copy of this repo -- without this, running `npm
    // test` from a checkout that has a nested worktree under .claude/ picks
    // up that copy's test files too and runs everything twice.
    exclude: ["**/node_modules/**", "**/.claude/**"],
  },
});
