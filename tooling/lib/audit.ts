/**
 * Audit Trail System
 * Tracks predicate discovery, candidate selection, and validation decisions
 */

import { CandidateScore } from "./candidate-selector";
import { HeuristicDefinition } from "./types";

export interface AuditEntry {
  timestamp: string;
  type: "predicate_discovered" | "candidate_ranked" | "candidate_selected" | "validation_passed" | "validation_failed";
  typeText: string;
  details: Record<string, any>;
}

export interface PredicateAudit {
  predicateId: string;
  name: string;
  discoveredAt: string;
  discoveredFrom: string; // "seed" | typeText that discovered it
  confidence: number; // 0-1 scale
  usageCount: number;
  lastUsedAt?: string;
  context?: string; // What constraint did it address
}

export interface CandidateSelectionAudit {
  attempt: number;
  candidateRankings: Array<{
    rank: number;
    name: string;
    totalScore: number;
    complexityScore: number;
    coverageScore: number;
    reusabilityScore: number;
    reasoning: string[];
  }>;
  selectedIndex: number;
  selectedName: string;
  selectedScore: number;
  confidence: number;
  selectionReason: string;
}

export interface ValidationAudit {
  attempt: number;
  valid: boolean;
  errors?: string[];
  feedback?: string;
}

export class AuditLog {
  private entries: AuditEntry[] = [];
  private predicateAudits: Map<string, PredicateAudit> = new Map();
  private candidateAudits: Map<string, CandidateSelectionAudit[]> = new Map();
  private validationAudits: Map<string, ValidationAudit[]> = new Map();

  /**
   * Record a predicate discovery
   */
  recordPredicateDiscovery(
    predicateId: string,
    name: string,
    discoveredFrom: string,
    confidence: number,
    context?: string
  ): void {
    const now = new Date().toISOString();
    const existing = this.predicateAudits.get(predicateId);

    if (existing) {
      existing.usageCount += 1;
      existing.lastUsedAt = now;
      if (confidence > existing.confidence) {
        existing.confidence = confidence;
      }
    } else {
      this.predicateAudits.set(predicateId, {
        predicateId,
        name,
        discoveredAt: now,
        discoveredFrom,
        confidence,
        usageCount: 1,
        lastUsedAt: now,
        context,
      });
    }

    this.entries.push({
      timestamp: now,
      type: "predicate_discovered",
      typeText: discoveredFrom,
      details: {
        predicateId,
        name,
        confidence,
        context,
      },
    });
  }

  /**
   * Record candidate ranking and selection
   */
  recordCandidateSelection(
    typeText: string,
    attempt: number,
    scores: CandidateScore[],
    selectedIndex: number,
    confidence: number,
    selectionReason: string
  ): void {
    const now = new Date().toISOString();
    const selectedScore = scores[selectedIndex];

    const ranking = scores.map((score, rank) => ({
      rank: rank + 1,
      name: score.candidate.name,
      totalScore: score.totalScore,
      complexityScore: score.complexityScore,
      coverageScore: score.coverageScore,
      reusabilityScore: score.reusabilityScore,
      reasoning: score.reasoning,
    }));

    const audit: CandidateSelectionAudit = {
      attempt,
      candidateRankings: ranking,
      selectedIndex,
      selectedName: selectedScore.candidate.name,
      selectedScore: selectedScore.totalScore,
      confidence,
      selectionReason,
    };

    const key = typeText;
    if (!this.candidateAudits.has(key)) {
      this.candidateAudits.set(key, []);
    }
    this.candidateAudits.get(key)!.push(audit);

    this.entries.push({
      timestamp: now,
      type: "candidate_selected",
      typeText,
      details: {
        attempt,
        candidateCount: scores.length,
        selectedName: selectedScore.candidate.name,
        selectedScore: selectedScore.totalScore,
        confidence,
        selectionReason,
      },
    });
  }

  /**
   * Record validation result
   */
  recordValidation(
    typeText: string,
    attempt: number,
    valid: boolean,
    errors?: string[],
    feedback?: string
  ): void {
    const now = new Date().toISOString();

    const audit: ValidationAudit = {
      attempt,
      valid,
      errors,
      feedback,
    };

    const key = typeText;
    if (!this.validationAudits.has(key)) {
      this.validationAudits.set(key, []);
    }
    this.validationAudits.get(key)!.push(audit);

    const type = valid ? "validation_passed" : "validation_failed";
    this.entries.push({
      timestamp: now,
      type,
      typeText,
      details: {
        attempt,
        errors,
        feedback,
      },
    });
  }

  /**
   * Get all entries
   */
  getEntries(): AuditEntry[] {
    return [...this.entries];
  }

  /**
   * Get predicate audit info
   */
  getPredicateAudit(predicateId: string): PredicateAudit | undefined {
    return this.predicateAudits.get(predicateId);
  }

  /**
   * Get all predicate audits
   */
  getAllPredicateAudits(): PredicateAudit[] {
    return Array.from(this.predicateAudits.values());
  }

  /**
   * Get candidate audits for a type
   */
  getCandidateAudits(typeText: string): CandidateSelectionAudit[] {
    return this.candidateAudits.get(typeText) || [];
  }

  /**
   * Get validation audits for a type
   */
  getValidationAudits(typeText: string): ValidationAudit[] {
    return this.validationAudits.get(typeText) || [];
  }

  /**
   * Get summary statistics
   */
  getSummary(): {
    totalEntries: number;
    totalPredicates: number;
    totalCandidateSelections: number;
    totalValidations: number;
    successRate: number;
  } {
    const validations = Array.from(this.validationAudits.values()).flat();
    const passed = validations.filter(v => v.valid).length;
    const total = validations.length;

    return {
      totalEntries: this.entries.length,
      totalPredicates: this.predicateAudits.size,
      totalCandidateSelections: Array.from(this.candidateAudits.values()).reduce((sum, audits) => sum + audits.length, 0),
      totalValidations: total,
      successRate: total > 0 ? passed / total : 0,
    };
  }

  /**
   * Export as JSON for persistence
   */
  toJSON(): {
    entries: AuditEntry[];
    predicateAudits: PredicateAudit[];
    candidateAudits: Record<string, CandidateSelectionAudit[]>;
    validationAudits: Record<string, ValidationAudit[]>;
  } {
    const candidateAuditsObj: Record<string, CandidateSelectionAudit[]> = {};
    const validationAuditsObj: Record<string, ValidationAudit[]> = {};

    for (const [key, value] of this.candidateAudits) {
      candidateAuditsObj[key] = value;
    }
    for (const [key, value] of this.validationAudits) {
      validationAuditsObj[key] = value;
    }

    return {
      entries: this.entries,
      predicateAudits: Array.from(this.predicateAudits.values()),
      candidateAudits: candidateAuditsObj,
      validationAudits: validationAuditsObj,
    };
  }

  /**
   * Clear all audits
   */
  clear(): void {
    this.entries = [];
    this.predicateAudits.clear();
    this.candidateAudits.clear();
    this.validationAudits.clear();
  }
}

/**
 * Global audit log instance
 */
export const globalAuditLog = new AuditLog();
