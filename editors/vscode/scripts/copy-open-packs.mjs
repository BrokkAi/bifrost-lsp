import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceDirectory = fileURLToPath(new URL("../vendor/", import.meta.url));
const runtimeFiles = ["open-packs.mjs", "pack-release.schema.json"];

/** @param {string} destination */
export async function copyOpenPacksRuntime(destination) {
  const targetDirectory = path.resolve(destination);
  await mkdir(targetDirectory, { recursive: true });
  await Promise.all(
    runtimeFiles.map((file) =>
      cp(path.join(sourceDirectory, file), path.join(targetDirectory, file))
    )
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await copyOpenPacksRuntime(process.argv[2] ?? "out");
}
