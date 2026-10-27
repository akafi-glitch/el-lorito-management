import "server-only";

import { parseServerEnv, type ServerEnv } from "./env-schema";

let cached: ServerEnv | undefined;

/** Validated server configuration. Throws a clear error listing every missing or wrong value. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/** True when configuration is valid. Never returns the values themselves. */
export function isServerEnvValid(): boolean {
  try {
    serverEnv();
    return true;
  } catch {
    return false;
  }
}
