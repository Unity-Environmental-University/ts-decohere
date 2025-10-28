/**
 * Structured Logging for Decohere Build
 * Provides contextual, hierarchical logging with optional detail levels
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  typeText?: string;
  attempt?: number;
  phase?: string;
  component?: string;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  data?: Record<string, any>;
  duration?: number; // milliseconds
}

export class Logger {
  private entries: LogEntry[] = [];
  private level: LogLevel = "info";
  private context: LogContext = {};
  private timerStack: Map<string, number> = new Map();
  private shouldLog: boolean = true;

  constructor(level: LogLevel = "info", shouldLog: boolean = true) {
    this.level = level;
    this.shouldLog = shouldLog;
  }

  /**
   * Set logging level
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Set context for all subsequent logs
   */
  setContext(context: Partial<LogContext>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Clear context
   */
  clearContext(): void {
    this.context = {};
  }

  /**
   * Push a new context layer
   */
  pushContext(context: Partial<LogContext>): void {
    this.context = { ...this.context, ...context };
  }

  /**
   * Pop context (restore previous context)
   */
  popContext(keys: (keyof LogContext)[]): void {
    keys.forEach(key => {
      delete this.context[key];
    });
  }

  /**
   * Start a timer
   */
  startTimer(name: string): void {
    this.timerStack.set(name, Date.now());
  }

  /**
   * End a timer and log duration
   */
  endTimer(name: string, message: string, level: LogLevel = "debug"): number {
    const start = this.timerStack.get(name);
    if (!start) {
      console.warn(`Timer "${name}" not found`);
      return 0;
    }

    const duration = Date.now() - start;
    this.timerStack.delete(name);
    this.log(level, message, undefined, { duration });
    return duration;
  }

  /**
   * Log at debug level
   */
  debug(message: string, data?: Record<string, any>): void {
    this.log("debug", message, data);
  }

  /**
   * Log at info level
   */
  info(message: string, data?: Record<string, any>): void {
    this.log("info", message, data);
  }

  /**
   * Log at warn level
   */
  warn(message: string, data?: Record<string, any>): void {
    this.log("warn", message, data);
  }

  /**
   * Log at error level
   */
  error(message: string, data?: Record<string, any>): void {
    this.log("error", message, data);
  }

  /**
   * Log with specific level
   */
  private log(level: LogLevel, message: string, data?: Record<string, any>, extra?: Record<string, any>): void {
    const levels = ["debug", "info", "warn", "error"];
    if (levels.indexOf(level) < levels.indexOf(this.level)) {
      return; // Skip if below threshold
    }

    const timestamp = new Date().toISOString();
    const mergedData = { ...(data || {}), ...(extra || {}) };
    const entry: LogEntry = {
      timestamp,
      level,
      message,
      context: Object.keys(this.context).length > 0 ? { ...this.context } : undefined,
      data: Object.keys(mergedData).length > 0 ? mergedData : undefined,
    };

    this.entries.push(entry);

    // Console output (with context prefix if available)
    if (this.shouldLog) {
      const prefix = this.buildPrefix(entry);
      const formatted = this.formatLog(entry, prefix);
      this.consoleLog(level, formatted);
    }
  }

  /**
   * Build a context prefix for logging
   */
  private buildPrefix(entry: LogEntry): string {
    if (!entry.context) return "";

    const parts: string[] = [];
    if (entry.context.phase) parts.push(`[${entry.context.phase}]`);
    if (entry.context.component) parts.push(`<${entry.context.component}>`);
    if (entry.context.typeText) parts.push(`${entry.context.typeText}`);
    if (entry.context.attempt) parts.push(`Attempt ${entry.context.attempt}`);

    return parts.length > 0 ? parts.join(" ") + ": " : "";
  }

  /**
   * Format a log entry for display
   */
  private formatLog(entry: LogEntry, prefix: string): string {
    let result = prefix + entry.message;

    if (entry.data) {
      const dataStr = this.formatData(entry.data);
      if (dataStr) {
        result += "\n  " + dataStr;
      }
    }

    return result;
  }

  /**
   * Format data for display
   */
  private formatData(data: Record<string, any>): string {
    const parts: string[] = [];

    for (const [key, value] of Object.entries(data)) {
      if (key === "duration" && typeof value === "number") {
        parts.push(`${key}: ${value}ms`);
      } else if (Array.isArray(value)) {
        parts.push(`${key}: [${value.length} items]`);
      } else if (typeof value === "object" && value !== null) {
        parts.push(`${key}: ${JSON.stringify(value)}`);
      } else {
        parts.push(`${key}: ${value}`);
      }
    }

    return parts.join(", ");
  }

  /**
   * Output to console
   */
  private consoleLog(level: LogLevel, message: string): void {
    switch (level) {
      case "debug":
        console.debug(message);
        break;
      case "info":
        console.log(message);
        break;
      case "warn":
        console.warn(message);
        break;
      case "error":
        console.error(message);
        break;
    }
  }

  /**
   * Get all entries
   */
  getEntries(): LogEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries for a specific type
   */
  getEntriesForType(typeText: string): LogEntry[] {
    return this.entries.filter(entry => entry.context?.typeText === typeText);
  }

  /**
   * Get entries at or above a specific level
   */
  getEntriesAtLevel(level: LogLevel): LogEntry[] {
    const levels = ["debug", "info", "warn", "error"];
    const index = levels.indexOf(level);
    return this.entries.filter(entry => levels.indexOf(entry.level) >= index);
  }

  /**
   * Export as JSON
   */
  toJSON(): LogEntry[] {
    return this.getEntries();
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get summary
   */
  getSummary(): {
    totalEntries: number;
    debugCount: number;
    infoCount: number;
    warnCount: number;
    errorCount: number;
  } {
    return {
      totalEntries: this.entries.length,
      debugCount: this.entries.filter(e => e.level === "debug").length,
      infoCount: this.entries.filter(e => e.level === "info").length,
      warnCount: this.entries.filter(e => e.level === "warn").length,
      errorCount: this.entries.filter(e => e.level === "error").length,
    };
  }
}

/**
 * Global logger instance
 */
export const globalLogger = new Logger("info", true);
