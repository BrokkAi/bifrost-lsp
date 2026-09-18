#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";

const server = process.env.BIFROST_LIVE_SERVER;
const marker = process.env.BIFROST_FAKE_MARKER;
if (!server) throw new Error("BIFROST_LIVE_SERVER is required");

const child = spawn(server, process.argv.slice(2), { stdio: ["pipe", "pipe", "inherit"] });
let buffer = Buffer.alloc(0);

process.stdin.pipe(child.stdin);
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) return;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const length = Number(/Content-Length:\s*(\d+)/iu.exec(header)?.[1]);
    if (!Number.isFinite(length) || buffer.length < headerEnd + 4 + length) return;
    const bodyStart = headerEnd + 4;
    const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString("utf8"));
    buffer = buffer.subarray(bodyStart + length);
    const identity = message?.result?.capabilities?.experimental?.bifrost;
    if (marker && identity?.engineVersion) fs.writeFileSync(marker, identity.engineVersion);
  }
});

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
