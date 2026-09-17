#!/usr/bin/env node
import fs from "node:fs";

const engineVersion = process.env.BIFROST_FAKE_ENGINE_VERSION ?? "0.11.5";
const marker = process.env.BIFROST_FAKE_MARKER;
const shutdownMarker = process.env.BIFROST_FAKE_SHUTDOWN_MARKER;
let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk) => {
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
    handle(message);
  }
});

function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function handle(message) {
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        capabilities: {
          experimental: { bifrost: { protocolVersion: 1, engineVersion } }
        }
      }
    });
    return;
  }
  if (message.method === "initialized") {
    if (marker) fs.writeFileSync(marker, engineVersion);
    return;
  }
  if (message.method === "shutdown") {
    if (shutdownMarker) fs.writeFileSync(shutdownMarker, engineVersion);
    send({ jsonrpc: "2.0", id: message.id, result: null });
    return;
  }
  if (message.method === "exit") process.exit(0);
  if (message.id !== undefined) send({ jsonrpc: "2.0", id: message.id, result: null });
}
