/**
 * Cache Manager for Selective Regeneration
 * Uses audit trail to determine what needs regeneration
 * Preserves high-confidence cached values across rebuilds
 */

import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { AuditLog } from "./audit";
import { Logger } from "./logger";

export interface CacheAudit {
  path: string;
  typeText: string;
  createdAt: Date;
  lastModified: Date;
  sizeBytes: number;
  confidence: number;
  selectedCandidate?: string;
  selectedScore?: number;
  predicateIds?: string[]; // IDs of predicates used in validation
}

export interface RegenerationReport {
  totalCacheEntries: number;
  entriesChecked: number;
  entriesPreserved: number;
  entriesMarkedForRegeneration: number;
  highConfidencePreserved: number;
  averageConfidence: number;
  details: Array<{
    typeText: string;
    cacheKey: string;
    action: "preserve" | "regenerate" | "unknown";
    reason: string;
    confidence?: number;
  }>;
  regenerationTime?: number;
}

export class CacheManager {
  private auditLog: AuditLog;
  private logger: Logger;
  private cacheDir: string;
  private confidenceThreshold: number = 0.75; // Preserve if confidence >= threshold
  private highConfidenceThreshold: number = 0.9; // Very safe to preserve

  constructor(cacheDir: string, auditLog: AuditLog, logger: Logger) {
    this.cacheDir = cacheDir;
    this.auditLog = auditLog;
    this.logger = logger;
  }

  /**
   * Audit all cache entries in the cache directory
   */
  auditCacheEntries(): CacheAudit[] {
    this.logger.info(`Starting cache audit`, { dir: this.cacheDir });

    if (!existsSync(this.cacheDir)) {
      this.logger.warn(`Cache directory does not exist`, { dir: this.cacheDir });
      return [];
    }

    const audits: CacheAudit[] = [];
    const files = readdirSync(this.cacheDir);

    for (const file of files) {
      if (!file.endsWith(".json")) continue;

      try {
        const path = join(this.cacheDir, file);
        const stat = statSync(path);

        // Read the cache entry to extract typeText
        const content = readFileSync(path, "utf8");
        const entry = JSON.parse(content);
        const typeText = entry.typeText || this.extractTypeFromCacheKey(file.replace(".json", ""));

        audits.push({
          path,
          typeText,
          createdAt: stat.birthtime,
          lastModified: stat.mtime,
          sizeBytes: stat.size,
          confidence: 0.5, // Will be updated from candidate selection audits
        });
      } catch (e) {
        this.logger.warn(`Failed to audit cache file`, {
          file,
          error: String(e),
        });
      }
    }

    this.logger.info(`Cache audit complete`, {
      total: audits.length,
      types: new Set(audits.map(a => a.typeText)).size,
    });

    return audits;
  }

  /**
   * Generate a regeneration report based on audit data
   */
  generateRegenerationReport(cacheAudits: CacheAudit[]): RegenerationReport {
    const startTime = Date.now();
    this.logger.info(`Generating regeneration report`, {
      cacheEntries: cacheAudits.length,
    });

    const details: RegenerationReport["details"] = [];
    let entriesPreserved = 0;
    let entriesMarkedForRegeneration = 0;
    let highConfidencePreserved = 0;
    let totalConfidence = 0;

    for (const audit of cacheAudits) {
      const candidateAudits = this.auditLog.getCandidateAudits(audit.typeText);
      const latestCandidate = candidateAudits[candidateAudits.length - 1];

      if (latestCandidate) {
        audit.confidence = latestCandidate.confidence;
        audit.selectedCandidate = latestCandidate.selectedName;
        audit.selectedScore = latestCandidate.selectedScore;

        totalConfidence += latestCandidate.confidence;

        // Decide whether to preserve or regenerate
        if (latestCandidate.confidence >= this.highConfidenceThreshold) {
          entriesPreserved++;
          highConfidencePreserved++;
          details.push({
            typeText: audit.typeText,
            cacheKey: audit.path.split("/").pop() || "unknown",
            action: "preserve",
            reason: `High confidence (${(latestCandidate.confidence * 100).toFixed(1)}%)`,
            confidence: latestCandidate.confidence,
          });
        } else if (latestCandidate.confidence >= this.confidenceThreshold) {
          entriesPreserved++;
          details.push({
            typeText: audit.typeText,
            cacheKey: audit.path.split("/").pop() || "unknown",
            action: "preserve",
            reason: `Meets confidence threshold (${(latestCandidate.confidence * 100).toFixed(1)}%)`,
            confidence: latestCandidate.confidence,
          });
        } else {
          entriesMarkedForRegeneration++;
          details.push({
            typeText: audit.typeText,
            cacheKey: audit.path.split("/").pop() || "unknown",
            action: "regenerate",
            reason: `Low confidence (${(latestCandidate.confidence * 100).toFixed(1)}%)`,
            confidence: latestCandidate.confidence,
          });
        }
      } else {
        entriesMarkedForRegeneration++;
        details.push({
          typeText: audit.typeText,
          cacheKey: audit.path.split("/").pop() || "unknown",
          action: "unknown",
          reason: "No candidate selection audit found",
        });
      }
    }

    const regenerationTime = Date.now() - startTime;

    const report: RegenerationReport = {
      totalCacheEntries: cacheAudits.length,
      entriesChecked: cacheAudits.length,
      entriesPreserved,
      entriesMarkedForRegeneration,
      highConfidencePreserved,
      averageConfidence:
        cacheAudits.length > 0 ? totalConfidence / cacheAudits.length : 0,
      details,
      regenerationTime,
    };

    this.logger.info(`Regeneration report generated`, {
      preserved: entriesPreserved,
      regenerate: entriesMarkedForRegeneration,
      avgConfidence: (report.averageConfidence * 100).toFixed(1),
    });

    return report;
  }

  /**
   * Query which cache entries can be safely preserved
   */
  getPreservableCacheEntries(cacheAudits: CacheAudit[]): CacheAudit[] {
    const preservable: CacheAudit[] = [];

    for (const audit of cacheAudits) {
      const candidateAudits = this.auditLog.getCandidateAudits(audit.typeText);
      const latestCandidate = candidateAudits[candidateAudits.length - 1];

      if (
        latestCandidate &&
        latestCandidate.confidence >= this.confidenceThreshold
      ) {
        preservable.push(audit);
      }
    }

    return preservable;
  }

  /**
   * Query which cache entries need regeneration
   */
  getCacheEntriesNeedingRegeneration(cacheAudits: CacheAudit[]): CacheAudit[] {
    const needRegeneration: CacheAudit[] = [];

    for (const audit of cacheAudits) {
      const candidateAudits = this.auditLog.getCandidateAudits(audit.typeText);
      const latestCandidate = candidateAudits[candidateAudits.length - 1];

      if (!latestCandidate || latestCandidate.confidence < this.confidenceThreshold) {
        needRegeneration.push(audit);
      }
    }

    return needRegeneration;
  }

  /**
   * Get confidence-based statistics on cache health
   */
  getCacheHealthMetrics(cacheAudits: CacheAudit[]): {
    total: number;
    excellent: number; // >= 0.95
    good: number; // 0.85-0.95
    acceptable: number; // 0.75-0.85
    poor: number; // < 0.75
    percentageExcellent: number;
    percentageGood: number;
    percentageAcceptable: number;
    percentagePoor: number;
  } {
    const confidences = cacheAudits.map(a => {
      const candidateAudits = this.auditLog.getCandidateAudits(a.typeText);
      const latest = candidateAudits[candidateAudits.length - 1];
      return latest?.confidence ?? 0;
    });

    const excellent = confidences.filter(c => c >= 0.95).length;
    const good = confidences.filter(c => c >= 0.85 && c < 0.95).length;
    const acceptable = confidences.filter(
      c => c >= 0.75 && c < 0.85
    ).length;
    const poor = confidences.filter(c => c < 0.75).length;
    const total = cacheAudits.length;

    return {
      total,
      excellent,
      good,
      acceptable,
      poor,
      percentageExcellent: total > 0 ? (excellent / total) * 100 : 0,
      percentageGood: total > 0 ? (good / total) * 100 : 0,
      percentageAcceptable: total > 0 ? (acceptable / total) * 100 : 0,
      percentagePoor: total > 0 ? (poor / total) * 100 : 0,
    };
  }

  /**
   * Get types that changed recently and might need regeneration
   */
  getRecentlyChangedTypes(
    withinLastHours: number = 24
  ): { typeText: string; lastChange: Date }[] {
    const cutoff = new Date(Date.now() - withinLastHours * 60 * 60 * 1000);
    const changed: Map<string, Date> = new Map();

    // Check audit trail for recent validations
    const allValidations = this.auditLog.getValidationAudits("");
    for (const validation of allValidations) {
      // Note: Would need to enhance getValidationAudits to support date filtering
      // For now, this is a placeholder for the concept
    }

    return Array.from(changed.entries()).map(([typeText, lastChange]) => ({
      typeText,
      lastChange,
    }));
  }

  /**
   * Set confidence threshold for preservation
   */
  setConfidenceThreshold(threshold: number): void {
    if (threshold < 0 || threshold > 1) {
      this.logger.warn(`Invalid confidence threshold`, { threshold });
      return;
    }
    this.confidenceThreshold = threshold;
    this.logger.info(`Confidence threshold updated`, { threshold });
  }

  /**
   * Extract type text from cache key (format: hash or typeText-hash)
   */
  private extractTypeFromCacheKey(cacheKey: string): string {
    // Cache keys are typically hashes, try to extract type if available
    // For now, return a generic label and the key
    return `Type_${cacheKey.substring(0, 8)}`;
  }
}

/**
 * Global cache manager instance
 */
export let globalCacheManager: CacheManager | null = null;

export function initializeCacheManager(
  cacheDir: string,
  auditLog: AuditLog,
  logger: Logger
): CacheManager {
  globalCacheManager = new CacheManager(cacheDir, auditLog, logger);
  return globalCacheManager;
}
