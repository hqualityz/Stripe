import { defineConfig } from "vite";
import fs from "node:fs";
import path from "node:path";

// Convert a URL to an html pathname with the parameters
function htmlFallbackPlugin() {
  return {
    name: "html-fallback",
    configureServer(server) {
      return () => {
        server.middlewares.use((req, res, next) => {
          const url = new URL(req.url, `http://${req.headers.host}`);
          const pathname = url.pathname;

          if (pathname.match(/^\/\w+$/)) {
            const htmlPath = path.join(
              process.cwd(),
              "public",
              pathname + ".html"
            );
            if (fs.existsSync(htmlPath)) {
              url.pathname += ".html";
              req.url = url.pathname + url.search;
            }
          }
          next();
        });
      };
    },
    resolveId(id) {
      const [pathname] = id.split("?");
      if (pathname.match(/^\/\w+$/)) {
        const htmlPath = path.join(process.cwd(), "public", pathname + ".html");
        if (fs.existsSync(htmlPath)) {
          return htmlPath;
        }
      }
      return null;
    },
  };
}

export default defineConfig({
  root: "public",
  envDir: "./..",
  plugins: [htmlFallbackPlugin()],
  server: {
    // Proxy API requests to server
    proxy: {
      "/api": "http://[::1]:4242",
    },
  },
});
