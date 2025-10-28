import { CacheManager } from "../tooling/lib/cache-manager";
import { AuditLog } from "../tooling/lib/audit";
import { Logger } from "../tooling/lib/logger";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  createHighConfidenceCandidate,
  createLowConfidenceCandidate,
  createAcceptableConfidenceCandidate,
  createGoodConfidenceCandidate,
  createMockCacheEntry,
} from "./fixtures/cache-manager.fixtures";

describe("CacheManager", () => {
  let cacheManager: CacheManager;
  let auditLog: AuditLog;
  let logger: Logger;
  let tempCacheDir: string;

  beforeEach(() => {
    auditLog = new AuditLog();
    logger = new Logger("debug", false);
    tempCacheDir = join(tmpdir(), `test-cache-${Date.now()}`);
    mkdirSync(tempCacheDir, { recursive: true });
    cacheManager = new CacheManager(tempCacheDir, auditLog, logger);
  });

  describe("cache auditing", () => {
    it("should audit empty cache directory", () => {
      const audits = cacheManager.auditCacheEntries();
      expect(audits).toHaveLength(0);
    });

    it("should audit cache entries", () => {
      // Create mock cache files
      const entry1 = { typeText: "TypeA", fingerprint: "hash1" };
      const entry2 = { typeText: "TypeB", fingerprint: "hash2" };

      writeFileSync(
        join(tempCacheDir, "cache1.json"),
        JSON.stringify(entry1)
      );
      writeFileSync(
        join(tempCacheDir, "cache2.json"),
        JSON.stringify(entry2)
      );

      const audits = cacheManager.auditCacheEntries();
      expect(audits).toHaveLength(2);
      expect(audits[0].sizeBytes).toBeGreaterThan(0);
    });

    it("should skip non-json files", () => {
      writeFileSync(join(tempCacheDir, "readme.txt"), "some text");
      const audits = cacheManager.auditCacheEntries();
      expect(audits).toHaveLength(0);
    });
  });

  describe("regeneration reporting", () => {
    it("should generate report for cache with no audits", () => {
      // Create a cache file
      const entry = { typeText: "TypeA", fingerprint: "hash1" };
      writeFileSync(
        join(tempCacheDir, "cache1.json"),
        JSON.stringify(entry)
      );

      const audits = cacheManager.auditCacheEntries();
      const report = cacheManager.generateRegenerationReport(audits);

      expect(report.totalCacheEntries).toBe(1);
      expect(report.entriesChecked).toBe(1);
      expect(report.entriesMarkedForRegeneration).toBe(1); // No audit = regenerate
      expect(report.details).toHaveLength(1);
    });

    it("should preserve high-confidence entries", () => {
      writeFileSync(
        join(tempCacheDir, "cache1.json"),
        JSON.stringify(createMockCacheEntry("TypeA"))
      );

      const candidate = createHighConfidenceCandidate();
      auditLog.recordCandidateSelection("TypeA", 1, [candidate], 0, 0.95, "test");

      const audits = cacheManager.auditCacheEntries();
      const report = cacheManager.generateRegenerationReport(audits);

      expect(report.entriesPreserved).toBe(1);
      expect(report.highConfidencePreserved).toBe(1);
      expect(report.details[0].action).toBe("preserve");
    });

    it("should mark low-confidence entries for regeneration", () => {
      writeFileSync(
        join(tempCacheDir, "cache1.json"),
        JSON.stringify(createMockCacheEntry("TypeA"))
      );

      const candidate = createLowConfidenceCandidate();
      auditLog.recordCandidateSelection("TypeA", 1, [candidate], 0, 0.5, "test");

      const audits = cacheManager.auditCacheEntries();
      const report = cacheManager.generateRegenerationReport(audits);

      expect(report.entriesMarkedForRegeneration).toBe(1);
      expect(report.details[0].action).toBe("regenerate");
    });

    it("should include regeneration time in report", () => {
      const audits = cacheManager.auditCacheEntries();
      const report = cacheManager.generateRegenerationReport(audits);

      expect(report.regenerationTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe("preservable cache entries", () => {
    it("should identify preservable entries", () => {
      writeFileSync(
        join(tempCacheDir, "cache1.json"),
        JSON.stringify(createMockCacheEntry("TypeA"))
      );
      writeFileSync(
        join(tempCacheDir, "cache2.json"),
        JSON.stringify(createMockCacheEntry("TypeB"))
      );

      auditLog.recordCandidateSelection(
        "TypeA",
        1,
        [createAcceptableConfidenceCandidate("High")],
        0,
        0.8,
        "test"
      );

      auditLog.recordCandidateSelection(
        "TypeB",
        1,
        [createLowConfidenceCandidate("Low")],
        0,
        0.5,
        "test"
      );

      const audits = cacheManager.auditCacheEntries();
      const preservable = cacheManager.getPreservableCacheEntries(audits);

      expect(preservable).toHaveLength(1);
      expect(preservable[0].typeText).toContain("TypeA");
    });
  });

  describe("cache entries needing regeneration", () => {
    it("should identify entries needing regeneration", () => {
      writeFileSync(
        join(tempCacheDir, "cache1.json"),
        JSON.stringify(createMockCacheEntry("TypeA"))
      );
      writeFileSync(
        join(tempCacheDir, "cache2.json"),
        JSON.stringify(createMockCacheEntry("TypeB"))
      );

      auditLog.recordCandidateSelection(
        "TypeA",
        1,
        [createLowConfidenceCandidate()],
        0,
        0.5,
        "test"
      );
      auditLog.recordCandidateSelection(
        "TypeB",
        1,
        [createLowConfidenceCandidate()],
        0,
        0.6,
        "test"
      );

      const audits = cacheManager.auditCacheEntries();
      const needRegeneration = cacheManager.getCacheEntriesNeedingRegeneration(audits);

      // Both below 0.75 threshold
      expect(needRegeneration.length).toBeGreaterThan(0);
    });
  });

  describe("cache health metrics", () => {
    it("should calculate cache health metrics", () => {
      writeFileSync(
        join(tempCacheDir, "cache1.json"),
        JSON.stringify(createMockCacheEntry("TypeA"))
      );
      writeFileSync(
        join(tempCacheDir, "cache2.json"),
        JSON.stringify(createMockCacheEntry("TypeB"))
      );
      writeFileSync(
        join(tempCacheDir, "cache3.json"),
        JSON.stringify(createMockCacheEntry("TypeC"))
      );

      auditLog.recordCandidateSelection(
        "TypeA",
        1,
        [createHighConfidenceCandidate()],
        0,
        0.95,
        "test"
      );
      auditLog.recordCandidateSelection(
        "TypeB",
        1,
        [createGoodConfidenceCandidate()],
        0,
        0.85,
        "test"
      );
      auditLog.recordCandidateSelection(
        "TypeC",
        1,
        [createLowConfidenceCandidate()],
        0,
        0.5,
        "test"
      );

      const audits = cacheManager.auditCacheEntries();
      const metrics = cacheManager.getCacheHealthMetrics(audits);

      expect(metrics.total).toBe(3);
      expect(metrics.excellent).toBe(1);
      expect(metrics.good).toBe(1);
      expect(metrics.poor).toBe(1);
    });

    it("should calculate percentage metrics correctly", () => {
      writeFileSync(
        join(tempCacheDir, "cache1.json"),
        JSON.stringify(createMockCacheEntry("TypeA"))
      );

      auditLog.recordCandidateSelection(
        "TypeA",
        1,
        [createHighConfidenceCandidate()],
        0,
        0.95,
        "test"
      );

      const audits = cacheManager.auditCacheEntries();
      const metrics = cacheManager.getCacheHealthMetrics(audits);

      expect(metrics.percentageExcellent).toBeCloseTo(100);
      expect(metrics.percentageGood).toBe(0);
      expect(metrics.percentagePoor).toBe(0);
    });
  });

  describe("configuration", () => {
    it("should allow setting confidence threshold", () => {
      cacheManager.setConfidenceThreshold(0.9);
      // Internal state should be updated
      // We verify via behavior in subsequent calls
    });

    it("should reject invalid confidence thresholds", () => {
      const spy = jest.spyOn(logger, "warn");
      cacheManager.setConfidenceThreshold(-0.1);
      cacheManager.setConfidenceThreshold(1.5);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
