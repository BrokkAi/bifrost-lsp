#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const extensionRoot = path.resolve(import.meta.dirname, "../..");
const fakeServer = path.join(extensionRoot, "test/live/fake-lsp.mjs");
const proxyServer = path.join(extensionRoot, "test/live/proxy-lsp.mjs");
const code = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
const engineVersion = process.argv[2] ?? "0.11.5";
const expectRejection = process.argv.includes("--expect-rejection");
const liveServer = process.env.BIFROST_LIVE_SERVER;
const configuredServer = liveServer ? proxyServer : fakeServer;
const temp = await mkdtemp(path.join(os.tmpdir(), "bifrost-vscode-live-"));
const workspace = path.join(temp, "workspace");
const marker = path.join(temp, "initialized.txt");
const shutdownMarker = path.join(temp, "shutdown.txt");
await mkdir(path.join(workspace, ".vscode"), { recursive: true });
await chmod(configuredServer, 0o755);
await writeFile(path.join(workspace, "main.js"), "console.log('bifrost live smoke');\n");
await writeFile(
  path.join(workspace, ".vscode/settings.json"),
  JSON.stringify({ "bifrost.launchMode": "path", "bifrost.serverPath": configuredServer }, null, 2)
);

const child = spawn(
  code,
  ["--new-window", "--verbose", `--extensionDevelopmentPath=${extensionRoot}`, `--user-data-dir=${path.join(temp, "user")}`, `--extensions-dir=${path.join(temp, "extensions")}`, workspace, path.join(workspace, "main.js")],
  { env: { ...process.env, BIFROST_FAKE_ENGINE_VERSION: engineVersion, BIFROST_FAKE_MARKER: marker, BIFROST_FAKE_SHUTDOWN_MARKER: shutdownMarker }, stdio: "ignore" }
);

try {
  const timeoutMs = liveServer ? 60_000 : 20_000;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const observed = (await readFile(expectRejection ? shutdownMarker : marker, "utf8")).trim();
      if (observed === engineVersion) {
        process.stdout.write(
          expectRejection
            ? `VS Code rejected and shut down incompatible Bifrost engine ${observed}.\n`
            : `VS Code accepted ${liveServer ? "local" : "fake"} Bifrost engine ${observed}.\n`
        );
        process.exitCode = 0;
        break;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (process.exitCode === undefined) {
    throw new Error(
      expectRejection
        ? `VS Code did not shut down the incompatible server within ${timeoutMs / 1000} seconds`
        : `VS Code extension host did not initialize the compatible ${liveServer ? "local" : "fake"} server within ${timeoutMs / 1000} seconds`
    );
  }
} finally {
  child.kill("SIGTERM");
  await rm(temp, { recursive: true, force: true });
}
