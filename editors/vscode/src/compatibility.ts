export const BIFROST_LSP_PROTOCOL_VERSION = 1;

export interface BifrostServerIdentity {
  protocolVersion: number;
  engineVersion: string;
}

export interface BifrostEngineCompatibility {
  minimum: string;
  maximumExclusive: string;
}

export function decodeBifrostServerIdentity(initializeResult: unknown): BifrostServerIdentity {
  const result = initializeResult as {
    capabilities?: { experimental?: { bifrost?: Partial<BifrostServerIdentity> } };
  };
  const identity = result?.capabilities?.experimental?.bifrost;
  if (
    identity?.protocolVersion !== BIFROST_LSP_PROTOCOL_VERSION ||
    typeof identity.engineVersion !== "string"
  ) {
    throw new Error(
      `The language server does not advertise the required Bifrost LSP protocol ${BIFROST_LSP_PROTOCOL_VERSION} identity.`
    );
  }
  parseVersion(identity.engineVersion, "server engineVersion");
  return { protocolVersion: identity.protocolVersion, engineVersion: identity.engineVersion };
}

export function parseEngineCompatibility(value: string): BifrostEngineCompatibility {
  const match = /^>=(\S+)\s+<(\S+)$/u.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid bifrost.engineCompatibility range: ${value}`);
  }
  const minimum = parseVersion(match[1], "minimum engine version");
  const maximum = parseVersion(match[2], "maximum engine version");
  if (compareVersions(minimum, maximum) >= 0) {
    throw new Error(`Invalid bifrost.engineCompatibility range: ${value}`);
  }
  return { minimum: match[1], maximumExclusive: match[2] };
}

export function requireCompatibleBifrostServer(
  initializeResult: unknown,
  rangeText: string
): BifrostServerIdentity {
  const identity = decodeBifrostServerIdentity(initializeResult);
  const range = parseEngineCompatibility(rangeText);
  const version = parseVersion(identity.engineVersion, "server engineVersion");
  if (
    compareVersions(version, parseVersion(range.minimum, "minimum engine version")) < 0 ||
    compareVersions(version, parseVersion(range.maximumExclusive, "maximum engine version")) >= 0
  ) {
    throw new Error(
      `Bifrost engine ${identity.engineVersion} is incompatible with this extension; required ${rangeText}.`
    );
  }
  return identity;
}

type Version = readonly [number, number, number];

function parseVersion(value: string, label: string): Version {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(value.trim());
  if (!match) throw new Error(`Invalid ${label}: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: Version, right: Version): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}
