import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  build: {
    lib: {
      entry: "./src/extension.ts",
      formats: ["cjs"],
      fileName: "extension",
    },
    rollupOptions: {
      external: [
        "vscode",
        "axios",
        "http",
        "https",
        "crypto",
        "stream",
        "util",
        "buffer",
        "fs",
        "path",
        "os",
        "node:fs",
        "node:path",
        "node:os",
        "node:assert",
        "mocha",
        "sinon",
        "assert",
      ],
    },
    sourcemap: true,
    outDir: "out",
    target: "node16",
  },
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: "resources/*",
          dest: "resources"
        }
      ]
    })
  ],
});

