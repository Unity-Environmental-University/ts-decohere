/**
 * Unified registry system for both predicates and helpers
 * Provides a reusable pattern for storing, loading, and persisting typed entries
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import { PredicateRegistryEntry, HelperRegistryEntry } from "./types";

export type RegistryEntry = PredicateRegistryEntry | HelperRegistryEntry;

export class Registry<T extends RegistryEntry> {
  private entries: Record<string, T> = {};
  private dirty = false;

  constructor(
    private registryPath: string,
    private indexPath: string,
    private indexGenerator: (entries: T[]) => string
  ) {
    this.load();
  }

  private load(): void {
    if (!existsSync(this.registryPath)) {
      this.entries = {};
      return;
    }
    try {
      const raw = readFileSync(this.registryPath, "utf8");
      const parsed = JSON.parse(raw) as T[];
      this.entries = {};
      for (const entry of parsed) {
        if (entry && (entry as PredicateRegistryEntry).id) {
          this.entries[(entry as PredicateRegistryEntry).id] = entry;
        }
      }
    } catch {
      this.entries = {};
    }
  }

  register(entry: T): void {
    const id = (entry as PredicateRegistryEntry).id;
    if (!id) return;

    const existing = this.entries[id];
    if (!existing) {
      this.entries[id] = entry;
      this.dirty = true;
      return;
    }

    // Check if anything changed
    const changed = Object.keys(entry).some(
      (key) => (entry as any)[key] !== (existing as any)[key]
    );
    if (changed) {
      this.entries[id] = entry;
      this.dirty = true;
    }
  }

  get(id: string): T | undefined {
    return this.entries[id];
  }

  all(): T[] {
    return Object.values(this.entries);
  }

  isDirty(): boolean {
    return this.dirty;
  }

  persist(): void {
    if (!this.dirty) {
      return;
    }

    mkdirSync(dirname(this.registryPath), { recursive: true });

    // Write registry file
    const entries = this.all().sort((a, b) => {
      const idA = (a as PredicateRegistryEntry).id;
      const idB = (b as PredicateRegistryEntry).id;
      return idA.localeCompare(idB);
    });
    const json = JSON.stringify(entries, null, 2);
    writeFileSync(this.registryPath, json, "utf8");

    // Write index file
    const indexContent = this.indexGenerator(entries);
    writeFileSync(this.indexPath, indexContent, "utf8");

    this.dirty = false;
  }

  clear(): void {
    this.entries = {};
    this.dirty = true;
  }

  size(): number {
    return Object.keys(this.entries).length;
  }
}
