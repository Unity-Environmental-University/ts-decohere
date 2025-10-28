/**
 * Configuration loading and path expansion utilities
 */

import { existsSync, readFileSync } from "fs";
import { isAbsolute, join } from "path";
import { Config } from "./types";

export const DEFAULT_ENV_SEARCH_PATHS = [".env", "~/Documents/repos/tools/.env"];
export const DEFAULT_FACTORY_CACHE_DIR = "generated/decohere-cache";
export const DEFAULT_MAX_ATTEMPTS = 5;

export class ConfigManager {
  private config: Config;
  private projectRoot: string;

  constructor(projectRoot: string, configPath: string) {
    this.projectRoot = projectRoot;
    this.config = this.readConfig(configPath);
  }

  private readConfig(configPath: string): Config {
    if (!existsSync(configPath)) {
      return { envSearchPaths: DEFAULT_ENV_SEARCH_PATHS };
    }

    try {
      const raw = readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw) as Config;
      return parsed;
    } catch {
      return { envSearchPaths: DEFAULT_ENV_SEARCH_PATHS };
    }
  }

  expandPath(rawPath: string): string {
    if (rawPath.startsWith("~/")) {
      const home = process.env.HOME;
      if (!home) {
        return rawPath.slice(2);
      }
      return join(home, rawPath.slice(2));
    }

    if (isAbsolute(rawPath)) {
      return rawPath;
    }

    return join(this.projectRoot, rawPath);
  }

  getEnvSearchPaths(): string[] {
    return this.config.envSearchPaths ?? DEFAULT_ENV_SEARCH_PATHS;
  }

  getFactoryCacheDir(): string {
    return this.config.factoryCacheDir ?? DEFAULT_FACTORY_CACHE_DIR;
  }

  getMaxLLMAttempts(): number {
    return this.config.maxLLMAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  getConfig(): Config {
    return this.config;
  }
}
