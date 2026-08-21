import vinext from "vinext";
import { defineConfig } from "vite";
import packageMetadata from "./package.json" with { type: "json" };

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const plugins = [vinext()];

  // Hosted builds use the Cloudflare adapter; standalone builds use the
  // Node.js runtime emitted by vinext for Docker.
  if (process.env.COFFER_LOCAL_STANDALONE !== "1") {
    // Wrangler snapshots its log path while the Cloudflare plugin is imported.
    const { cloudflare } = await import("@cloudflare/vite-plugin");
    plugins.push(cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
      config: localBindingConfig,
    }));
  }

  return {
    cacheDir: process.env.COFFER_DEMO_MODE === "1"
      ? "node_modules/.vite-demo"
      : "node_modules/.vite",
    define: {
      __COFFER_VERSION__: JSON.stringify(packageMetadata.version),
    },
    plugins,
  };
});
