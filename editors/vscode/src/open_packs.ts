import path from "node:path";
import { pathToFileURL } from "node:url";

export interface OpenPacksHelperOptions {
  cacheDir: string;
  engineProfile: unknown;
  fetchImpl?: typeof fetch;
  offline: boolean;
  refresh: boolean;
}

export interface OpenPacksHelperResult {
  env: Record<string, string>;
  receipt: unknown;
}

export interface OpenPacksHelperApi {
  readEnginePackProfile(binaryPath: string, options: { env: NodeJS.ProcessEnv }): Promise<unknown>;
  prepareOpenPacks(options: OpenPacksHelperOptions): Promise<OpenPacksHelperResult>;
}

export type OpenPacksHelperLoader = () => Promise<OpenPacksHelperApi>;

export interface PrepareOpenPacksForServerOptions {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  cacheDir: string;
  offline: boolean;
  refresh: boolean;
  fetchImpl?: typeof fetch;
  helperPath?: string;
  loadHelper?: OpenPacksHelperLoader;
}

export interface OpenPacksForServerResult {
  engineProfile: Record<string, unknown> | null;
  engineVersion: string | null;
  env: Record<string, string>;
  receipt: unknown;
  status: "ready" | "unavailable";
  diagnostic: string | null;
}

const NON_FATAL_PACK_ERROR_CODES = new Set(["no-compatible-release", "unavailable", "pending"]);

export async function prepareOpenPacksForServer(
  options: PrepareOpenPacksForServerOptions
): Promise<OpenPacksForServerResult> {
  const helper = await (options.loadHelper ?? (() => loadOpenPacksHelper(options.helperPath)))();
  let engineProfile: unknown;
  try {
    engineProfile = await helper.readEnginePackProfile(
      selectedBinaryPath(options.command, options.cwd),
      {
        env: options.env
      }
    );
  } catch (error) {
    if (openPacksErrorCode(error) === "unsupported") {
      return unavailable(
        `The selected server does not provide pack-engine-profile: ${formatError(error)}`
      );
    }
    throw error;
  }

  const engineVersion = engineVersionFromProfile(engineProfile);
  const profile = engineProfile as Record<string, unknown>;
  try {
    const prepared = await helper.prepareOpenPacks({
      cacheDir: options.cacheDir,
      engineProfile,
      fetchImpl: options.fetchImpl,
      offline: options.offline,
      refresh: options.refresh
    });
    return {
      engineProfile: profile,
      engineVersion,
      env: prepared.env,
      receipt: prepared.receipt,
      status: "ready",
      diagnostic: null
    };
  } catch (error) {
    const code = openPacksErrorCode(error);
    if (!code || !NON_FATAL_PACK_ERROR_CODES.has(code)) {
      throw error;
    }
    return unavailable(
      `Open semantic packs are unavailable (${code}) for engine ${engineVersion}: ${formatError(error)}`,
      profile,
      engineVersion
    );
  }
}

export function engineVersionFromProfile(profile: unknown): string {
  if (typeof profile !== "object" || profile === null || Array.isArray(profile)) {
    throw new TypeError("The open-pack helper returned a malformed engine profile.");
  }
  const engineVersion = (profile as Record<string, unknown>).engine_version;
  if (typeof engineVersion !== "string" || engineVersion.length === 0) {
    throw new TypeError("The open-pack helper returned a malformed engine profile.");
  }
  return engineVersion;
}

export function profileMatchesNegotiatedEngine(
  profileEngineVersion: string,
  negotiatedEngineVersion: string
): boolean {
  return profileEngineVersion === negotiatedEngineVersion;
}

async function loadOpenPacksHelper(
  helperPath = path.join(__dirname, "open-packs.mjs")
): Promise<OpenPacksHelperApi> {
  return (await import(pathToFileURL(path.resolve(helperPath)).href)) as OpenPacksHelperApi;
}

function selectedBinaryPath(command: string, cwd: string): string {
  if (path.isAbsolute(command) || command.includes("/") || command.includes("\\")) {
    return path.resolve(cwd, command);
  }
  return command;
}

function unavailable(
  diagnostic: string,
  engineProfile: Record<string, unknown> | null = null,
  engineVersion: string | null = null
): OpenPacksForServerResult {
  return {
    engineProfile,
    engineVersion,
    env: {},
    receipt: null,
    status: "unavailable",
    diagnostic
  };
}

function openPacksErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
