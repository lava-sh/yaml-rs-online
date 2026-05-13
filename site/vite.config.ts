import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  plugins: [vue()],
  server: {
    allowedHosts: true,
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
