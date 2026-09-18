import assert from "node:assert/strict";
import { test } from "node:test";
import { BIFROST_LSP_PROTOCOL_VERSION, requireCompatibleBifrostServer } from "../src/compatibility";

function result(engineVersion: string, protocolVersion = BIFROST_LSP_PROTOCOL_VERSION): unknown {
  return { capabilities: { experimental: { bifrost: { protocolVersion, engineVersion } } } };
}

void test("accepts structured server identity inside the engine range", () => {
  assert.equal(
    requireCompatibleBifrostServer(result("0.11.5"), ">=0.11.0 <1.0.0").engineVersion,
    "0.11.5"
  );
});

void test("rejects missing identity, wrong protocol, and out-of-range engines", () => {
  assert.throws(() => requireCompatibleBifrostServer({}, ">=0.11.0 <1.0.0"), /does not advertise/);
  assert.throws(
    () => requireCompatibleBifrostServer(result("0.11.5", 2), ">=0.11.0 <1.0.0"),
    /protocol 1/
  );
  assert.throws(
    () => requireCompatibleBifrostServer(result("1.0.0"), ">=0.11.0 <1.0.0"),
    /incompatible/
  );
});

void test("fails closed for malformed manifest ranges and server versions", () => {
  assert.throws(() => requireCompatibleBifrostServer(result("0.11"), ">=0.11.0 <1.0.0"));
  assert.throws(() => requireCompatibleBifrostServer(result("0.11.5"), "^0.11.0"));
});
