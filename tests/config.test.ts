/**
 * Test suite for ConfigManager
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { ConfigManager, DEFAULT_ENV_SEARCH_PATHS, DEFAULT_FACTORY_CACHE_DIR, DEFAULT_MAX_ATTEMPTS } from "../tooling/lib/config";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("ConfigManager", () => {
  let configPath: string;
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = join(tmpdir(), `project-${Date.now()}`);
    mkdirSync(projectRoot, { recursive: true });
    configPath = join(projectRoot, "decohere.config.json");
  });

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("should load default config when file does not exist", () => {
    const manager = new ConfigManager(projectRoot, configPath);

    expect(manager.getEnvSearchPaths()).toEqual(DEFAULT_ENV_SEARCH_PATHS);
    expect(manager.getFactoryCacheDir()).toBe(DEFAULT_FACTORY_CACHE_DIR);
    expect(manager.getMaxLLMAttempts()).toBe(DEFAULT_MAX_ATTEMPTS);
  });

  it("should load custom config from file", () => {
    const customConfig = {
      envSearchPaths: [".env.custom"],
      factoryCacheDir: "custom/cache",
      maxLLMAttempts: 10,
    };

    writeFileSync(configPath, JSON.stringify(customConfig), "utf8");
    const manager = new ConfigManager(projectRoot, configPath);

    expect(manager.getEnvSearchPaths()).toEqual([".env.custom"]);
    expect(manager.getFactoryCacheDir()).toBe("custom/cache");
    expect(manager.getMaxLLMAttempts()).toBe(10);
  });

  it("should expand relative paths", () => {
    const manager = new ConfigManager(projectRoot, configPath);
    const expanded = manager.expandPath("subdir/file.txt");

    expect(expanded).toBe(join(projectRoot, "subdir/file.txt"));
  });

  it("should expand home directory paths", () => {
    const manager = new ConfigManager(projectRoot, configPath);
    const expanded = manager.expandPath("~/Documents/test.txt");

    expect(expanded).toContain("Documents/test.txt");
    expect(expanded).not.toContain("~");
  });

  it("should leave absolute paths unchanged", () => {
    const manager = new ConfigManager(projectRoot, configPath);
    const absolutePath = "/absolute/path/to/file.txt";
    const expanded = manager.expandPath(absolutePath);

    expect(expanded).toBe(absolutePath);
  });

  it("should handle invalid JSON gracefully", () => {
    writeFileSync(configPath, "{ invalid json }", "utf8");
    const manager = new ConfigManager(projectRoot, configPath);

    expect(manager.getEnvSearchPaths()).toEqual(DEFAULT_ENV_SEARCH_PATHS);
  });

  it("should return full config object", () => {
    const customConfig = {
      envSearchPaths: [".env"],
      factoryCacheDir: "cache",
    };

    writeFileSync(configPath, JSON.stringify(customConfig), "utf8");
    const manager = new ConfigManager(projectRoot, configPath);
    const config = manager.getConfig();

    expect(config).toEqual(customConfig);
  });
});
