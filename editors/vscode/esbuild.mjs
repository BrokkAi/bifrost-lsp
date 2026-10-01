// @ts-check

import * as esbuild from "esbuild";
import { copyOpenPacksRuntime } from "./scripts/copy-open-packs.mjs";

const watch = process.argv.includes("--watch");

/** @type {esbuild.Plugin} */
const copyOpenPackRuntimePlugin = {
  name: "copy-open-pack-runtime",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length === 0) {
        await copyOpenPacksRuntime("out");
      }
    });
  }
};

/** @type {esbuild.BuildOptions} */
const extensionOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  target: "node18",
  supported: { "dynamic-import": true },
  sourcemap: true,
  minify: !watch,
  plugins: [copyOpenPackRuntimePlugin]
};

if (watch) {
  const context = await esbuild.context(extensionOptions);
  await context.watch();
  console.log("Watching Bifrost VS Code extension...");
} else {
  await esbuild.build(extensionOptions);
  console.log("Build complete.");
}
