import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [cloudflare()],
  server: {
    hmr: {
      overlay: false,
    },
  },
  build: {
    target: "es2022",
  },
});
