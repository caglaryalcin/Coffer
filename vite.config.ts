import type { IncomingMessage } from "node:http";
import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";
import packageMetadata from "./package.json" with { type: "json" };

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
};

const EXTENSION_API_METHODS = new Map([
  ["/api/service-brands", new Set(["GET", "OPTIONS"])],
  ["/api/vault", new Set(["POST", "OPTIONS"])],
]);

// Keep this aligned with lib/server/extension-origin.ts. The dev shim only
// bypasses Vinext; the API still performs its own canonical origin validation.
const EXTENSION_ORIGIN_PATTERN = /^(?:moz|chrome)-extension:\/\/[A-Za-z0-9-]+$/u;

function setForwardedHost(request: IncomingMessage, hostname: string) {
  // Vinext's Connect and RSC guards read different header representations.
  request.headers["x-forwarded-host"] = hostname;

  for (let index = request.rawHeaders.length - 2; index >= 0; index -= 2) {
    if (request.rawHeaders[index].toLowerCase() === "x-forwarded-host") {
      request.rawHeaders.splice(index, 2);
    }
  }
  request.rawHeaders.push("X-Forwarded-Host", hostname);
}

function allowBrowserExtensionDevOrigins(): Plugin {
  return {
    name: "coffer:allow-browser-extension-dev-origins",
    apply: "serve",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const origin = request.headers.origin;
        const method = request.method?.toUpperCase() ?? "";
        let pathname = "";
        try {
          pathname = new URL(request.url ?? "/", "http://coffer.local").pathname;
        } catch {
          next();
          return;
        }

        if (
          typeof origin === "string" &&
          EXTENSION_ORIGIN_PATTERN.test(origin) &&
          EXTENSION_API_METHODS.get(pathname)?.has(method)
        ) {
          setForwardedHost(request, new URL(origin).hostname.toLowerCase());
        }
        next();
      });
    },
  };
}

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const plugins = [allowBrowserExtensionDevOrigins(), vinext()];

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
    cacheDir: "node_modules/.vite",
    define: {
      __COFFER_VERSION__: JSON.stringify(packageMetadata.version),
    },
    plugins,
  };
});
