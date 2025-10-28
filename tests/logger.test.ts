import { Logger } from "../tooling/lib/logger";

describe("Logger", () => {
  let logger: Logger;

  beforeEach(() => {
    logger = new Logger("debug", false); // Disable console output for tests
  });

  describe("logging levels", () => {
    it("should log at debug level", () => {
      logger.debug("Debug message", { value: 42 });
      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("debug");
      expect(entries[0].message).toBe("Debug message");
    });

    it("should log at info level", () => {
      logger.info("Info message");
      const entries = logger.getEntries();
      expect(entries[0].level).toBe("info");
    });

    it("should log at warn level", () => {
      logger.warn("Warning message");
      const entries = logger.getEntries();
      expect(entries[0].level).toBe("warn");
    });

    it("should log at error level", () => {
      logger.error("Error message");
      const entries = logger.getEntries();
      expect(entries[0].level).toBe("error");
    });
  });

  describe("log levels filtering", () => {
    it("should only log at or above configured level", () => {
      const infoLogger = new Logger("info", false);
      infoLogger.debug("Debug message");
      infoLogger.info("Info message");
      infoLogger.warn("Warn message");

      const entries = infoLogger.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].level).toBe("info");
      expect(entries[1].level).toBe("warn");
    });
  });

  describe("context management", () => {
    it("should set and maintain context", () => {
      logger.setContext({ typeText: "EvenNumber", attempt: 1 });
      logger.info("Message");

      const entries = logger.getEntries();
      expect(entries[0].context).toEqual({ typeText: "EvenNumber", attempt: 1 });
    });

    it("should merge context updates", () => {
      logger.setContext({ typeText: "EvenNumber" });
      logger.pushContext({ attempt: 1 });
      logger.info("Message");

      const entries = logger.getEntries();
      expect(entries[0].context).toEqual({ typeText: "EvenNumber", attempt: 1 });
    });

    it("should clear context keys", () => {
      logger.setContext({ typeText: "EvenNumber", attempt: 1, phase: "synthesis" });
      logger.popContext(["attempt"]);
      logger.info("Message");

      const entries = logger.getEntries();
      expect(entries[0].context).toEqual({ typeText: "EvenNumber", phase: "synthesis" });
    });

    it("should clear all context", () => {
      logger.setContext({ typeText: "EvenNumber", attempt: 1 });
      logger.clearContext();
      logger.info("Message");

      const entries = logger.getEntries();
      expect(entries[0].context).toBeUndefined();
    });
  });

  describe("data attachments", () => {
    it("should attach data to log entries", () => {
      logger.info("Message", { value: 42, status: "active" });

      const entries = logger.getEntries();
      expect(entries[0].data).toEqual({ value: 42, status: "active" });
    });
  });

  describe("timers", () => {
    it("should start and end timers", () => {
      logger.startTimer("operation");

      // Small delay to ensure measurable time
      const delay = new Promise(resolve => setTimeout(resolve, 50));

      return delay.then(() => {
        const duration = logger.endTimer("operation", "Operation completed");
        expect(duration).toBeGreaterThanOrEqual(50);

        const entries = logger.getEntries();
        expect(entries).toHaveLength(1);
        expect(entries[0].data?.duration).toBeGreaterThanOrEqual(50);
      });
    });
  });

  describe("entry filtering", () => {
    it("should filter entries by type", () => {
      logger.setContext({ typeText: "EvenNumber" });
      logger.info("Message 1");

      logger.setContext({ typeText: "PrimeNumber" });
      logger.info("Message 2");

      const evenEntries = logger.getEntriesForType("EvenNumber");
      expect(evenEntries).toHaveLength(1);
      expect(evenEntries[0].context?.typeText).toBe("EvenNumber");
    });

    it("should filter entries by level", () => {
      logger.debug("Debug");
      logger.info("Info");
      logger.warn("Warn");
      logger.error("Error");

      const warnAndAbove = logger.getEntriesAtLevel("warn");
      expect(warnAndAbove).toHaveLength(2);
      expect(warnAndAbove[0].level).toBe("warn");
      expect(warnAndAbove[1].level).toBe("error");
    });
  });

  describe("summary", () => {
    it("should provide accurate statistics", () => {
      logger.debug("Debug");
      logger.info("Info 1");
      logger.info("Info 2");
      logger.warn("Warn");
      logger.error("Error");

      const summary = logger.getSummary();
      expect(summary.totalEntries).toBe(5);
      expect(summary.debugCount).toBe(1);
      expect(summary.infoCount).toBe(2);
      expect(summary.warnCount).toBe(1);
      expect(summary.errorCount).toBe(1);
    });
  });

  describe("export", () => {
    it("should export entries as JSON", () => {
      logger.setContext({ typeText: "Test" });
      logger.info("Message", { data: "value" });

      const json = logger.toJSON();
      expect(json).toHaveLength(1);
      expect(json[0].message).toBe("Message");
      expect(json[0].context?.typeText).toBe("Test");
      expect(json[0].data?.data).toBe("value");
    });
  });

  describe("clearing", () => {
    it("should clear all entries", () => {
      logger.info("Message 1");
      logger.info("Message 2");

      expect(logger.getEntries()).toHaveLength(2);

      logger.clear();
      expect(logger.getEntries()).toHaveLength(0);
    });
  });

  describe("level setting", () => {
    it("should change logging level dynamically", () => {
      logger.setLevel("warn");
      logger.debug("Debug");
      logger.info("Info");
      logger.warn("Warn");

      const entries = logger.getEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("warn");
    });
  });
});
