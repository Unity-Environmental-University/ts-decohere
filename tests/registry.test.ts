/**
 * Test suite for Registry system
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { Registry } from "../tooling/lib/registry";
import { PredicateRegistryEntry } from "../tooling/lib/types";
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

describe("Registry", () => {
  let registryPath: string;
  let indexPath: string;
  let registry: Registry<PredicateRegistryEntry>;
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `registry-test-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    registryPath = join(tempDir, `registry.json`);
    indexPath = join(tempDir, `index.ts`);

    const indexGenerator = (entries: PredicateRegistryEntry[]) => {
      return `export const entries = ${JSON.stringify(entries)};`;
    };

    registry = new Registry(registryPath, indexPath, indexGenerator);
  });

  afterEach(() => {
    if (existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should create an empty registry", () => {
    expect(registry.size()).toBe(0);
    expect(registry.all()).toEqual([]);
  });

  it("should register a new entry", () => {
    const entry: PredicateRegistryEntry = {
      id: "test-id",
      name: "testPredicate",
      description: "Test predicate",
      predicateSource: "(x) => x > 0",
    };

    registry.register(entry);
    expect(registry.size()).toBe(1);
    expect(registry.get("test-id")).toEqual(entry);
  });

  it("should mark registry dirty when registering", () => {
    const entry: PredicateRegistryEntry = {
      id: "test-id",
      name: "testPredicate",
      description: "Test predicate",
      predicateSource: "(x) => x > 0",
    };

    expect(registry.isDirty()).toBe(false);
    registry.register(entry);
    expect(registry.isDirty()).toBe(true);
  });

  it("should not mark dirty when registering identical entry", () => {
    const entry: PredicateRegistryEntry = {
      id: "test-id",
      name: "testPredicate",
      description: "Test predicate",
      predicateSource: "(x) => x > 0",
    };

    registry.register(entry);
    const dirty1 = registry.isDirty();
    expect(dirty1).toBe(true);

    // Clear dirty flag
    registry.persist();
    expect(registry.isDirty()).toBe(false);

    // Register same entry again
    registry.register(entry);
    expect(registry.isDirty()).toBe(false);
  });

  it("should persist registry to files", () => {
    const entry: PredicateRegistryEntry = {
      id: "test-id",
      name: "testPredicate",
      description: "Test predicate",
      predicateSource: "(x) => x > 0",
    };

    registry.register(entry);
    registry.persist();

    expect(existsSync(registryPath)).toBe(true);
    expect(existsSync(indexPath)).toBe(true);

    const registryContent = require(registryPath);
    expect(registryContent).toContainEqual(entry);
  });

  it("should load existing registry from disk", () => {
    const entry: PredicateRegistryEntry = {
      id: "test-id",
      name: "testPredicate",
      description: "Test predicate",
      predicateSource: "(x) => x > 0",
    };

    // First registry instance writes data
    registry.register(entry);
    registry.persist();

    // Second registry instance loads data
    const indexGenerator = (entries: PredicateRegistryEntry[]) => {
      return `export const entries = ${JSON.stringify(entries)};`;
    };
    const registry2 = new Registry(registryPath, indexPath, indexGenerator);

    expect(registry2.size()).toBe(1);
    expect(registry2.get("test-id")).toEqual(entry);
  });

  it("should handle multiple entries", () => {
    const entries: PredicateRegistryEntry[] = [
      {
        id: "id-1",
        name: "pred1",
        description: "First predicate",
        predicateSource: "(x) => x > 0",
      },
      {
        id: "id-2",
        name: "pred2",
        description: "Second predicate",
        predicateSource: "(x) => x < 100",
      },
      {
        id: "id-3",
        name: "pred3",
        description: "Third predicate",
        predicateSource: "(x) => x % 2 === 0",
      },
    ];

    for (const entry of entries) {
      registry.register(entry);
    }

    expect(registry.size()).toBe(3);
    expect(registry.all()).toHaveLength(3);
  });

  it("should clear all entries", () => {
    const entry: PredicateRegistryEntry = {
      id: "test-id",
      name: "testPredicate",
      description: "Test predicate",
      predicateSource: "(x) => x > 0",
    };

    registry.register(entry);
    expect(registry.size()).toBe(1);

    registry.clear();
    expect(registry.size()).toBe(0);
    expect(registry.isDirty()).toBe(true);
  });
});
