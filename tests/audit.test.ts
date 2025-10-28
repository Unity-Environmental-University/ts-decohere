import { AuditLog } from "../tooling/lib/audit";
import { CandidateScore } from "../tooling/lib/candidate-selector";

describe("AuditLog", () => {
  let auditLog: AuditLog;

  beforeEach(() => {
    auditLog = new AuditLog();
  });

  describe("recordPredicateDiscovery", () => {
    it("should record a new predicate discovery", () => {
      auditLog.recordPredicateDiscovery(
        "pred_123",
        "isEven",
        "EvenNumber",
        0.95,
        "Checks if number is even"
      );

      const audit = auditLog.getPredicateAudit("pred_123");
      expect(audit).toBeDefined();
      expect(audit!.name).toBe("isEven");
      expect(audit!.discoveredFrom).toBe("EvenNumber");
      expect(audit!.confidence).toBe(0.95);
      expect(audit!.usageCount).toBe(1);
    });

    it("should increment usage count for existing predicate", () => {
      auditLog.recordPredicateDiscovery("pred_123", "isEven", "EvenNumber", 0.9, "");
      auditLog.recordPredicateDiscovery("pred_123", "isEven", "EvenNumber", 0.95, "");

      const audit = auditLog.getPredicateAudit("pred_123");
      expect(audit!.usageCount).toBe(2);
      expect(audit!.confidence).toBe(0.95); // Updated to higher confidence
    });

    it("should update lastUsedAt timestamp", () => {
      auditLog.recordPredicateDiscovery("pred_123", "isEven", "EvenNumber", 0.9, "");
      const firstAudit = auditLog.getPredicateAudit("pred_123");
      const firstTime = new Date(firstAudit!.lastUsedAt!).getTime();

      // Small delay to ensure different timestamps
      const delay = new Promise(resolve => setTimeout(resolve, 10));
      return delay.then(() => {
        auditLog.recordPredicateDiscovery("pred_123", "isEven", "EvenNumber", 0.9, "");
        const secondAudit = auditLog.getPredicateAudit("pred_123");
        const secondTime = new Date(secondAudit!.lastUsedAt!).getTime();
        expect(secondTime).toBeGreaterThanOrEqual(firstTime);
      });
    });
  });

  describe("recordCandidateSelection", () => {
    it("should record candidate selection with ranking", () => {
      const scores: CandidateScore[] = [
        {
          candidate: { name: "candidate_1", description: "First", predicate: "(v) => true" },
          complexityScore: 1.0,
          coverageScore: 0.9,
          reusabilityScore: 0.85,
          totalScore: 0.91,
          reasoning: ["Simple", "Good coverage"],
        },
        {
          candidate: { name: "candidate_2", description: "Second", predicate: "(v) => v > 0" },
          complexityScore: 0.8,
          coverageScore: 0.7,
          reusabilityScore: 0.75,
          totalScore: 0.75,
          reasoning: ["More complex"],
        },
      ];

      auditLog.recordCandidateSelection(
        "EvenNumber",
        1,
        scores,
        0,
        0.91,
        "Best candidate"
      );

      const audits = auditLog.getCandidateAudits("EvenNumber");
      expect(audits).toHaveLength(1);
      expect(audits[0].selectedName).toBe("candidate_1");
      expect(audits[0].candidateRankings).toHaveLength(2);
      expect(audits[0].candidateRankings[0].rank).toBe(1);
    });
  });

  describe("recordValidation", () => {
    it("should record successful validation", () => {
      auditLog.recordValidation("EvenNumber", 1, true);

      const audits = auditLog.getValidationAudits("EvenNumber");
      expect(audits).toHaveLength(1);
      expect(audits[0].valid).toBe(true);
      expect(audits[0].errors).toBeUndefined();
    });

    it("should record failed validation with errors", () => {
      auditLog.recordValidation(
        "EvenNumber",
        1,
        false,
        ["Value is not even", "Value is negative"],
        "Retry with different approach"
      );

      const audits = auditLog.getValidationAudits("EvenNumber");
      expect(audits).toHaveLength(1);
      expect(audits[0].valid).toBe(false);
      expect(audits[0].errors).toEqual(["Value is not even", "Value is negative"]);
      expect(audits[0].feedback).toBe("Retry with different approach");
    });
  });

  describe("getSummary", () => {
    it("should return correct statistics", () => {
      auditLog.recordPredicateDiscovery("pred_1", "isEven", "EvenNumber", 0.9, "");
      auditLog.recordPredicateDiscovery("pred_2", "isPositive", "PositiveNumber", 0.85, "");

      const scores: CandidateScore[] = [
        {
          candidate: { name: "c1", description: "", predicate: "" },
          complexityScore: 1,
          coverageScore: 1,
          reusabilityScore: 1,
          totalScore: 1,
          reasoning: [],
        },
      ];

      auditLog.recordCandidateSelection("EvenNumber", 1, scores, 0, 1, "");
      auditLog.recordValidation("EvenNumber", 1, true);
      auditLog.recordValidation("PrimeNumber", 1, false);

      const summary = auditLog.getSummary();
      expect(summary.totalPredicates).toBe(2);
      expect(summary.totalValidations).toBe(2);
      expect(summary.successRate).toBe(0.5); // 1 success / 2 total
    });
  });

  describe("toJSON", () => {
    it("should export complete audit data", () => {
      auditLog.recordPredicateDiscovery("pred_1", "isEven", "EvenNumber", 0.9, "");

      const json = auditLog.toJSON();
      expect(json.predicateAudits).toHaveLength(1);
      expect(json.predicateAudits[0].name).toBe("isEven");
    });
  });

  describe("clear", () => {
    it("should clear all audit data", () => {
      auditLog.recordPredicateDiscovery("pred_1", "isEven", "EvenNumber", 0.9, "");
      auditLog.recordValidation("EvenNumber", 1, true);

      auditLog.clear();

      expect(auditLog.getAllPredicateAudits()).toHaveLength(0);
      expect(auditLog.getValidationAudits("EvenNumber")).toHaveLength(0);
    });
  });
});
