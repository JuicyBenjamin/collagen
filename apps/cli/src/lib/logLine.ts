// A line of collagen's own log, as the logger writes it
// ("2026-11-17T10:04:05.123Z [INFO] text"), taken apart for showing: when,
// whether it is a warning or an error, and what it says. Pure.

export interface LogEntry {
  /** when it was written; null for a line that does not start with a time */
  readonly at: number | null;
  /** a warning or an error */
  readonly trouble: boolean;
  readonly text: string;
}

const LINE = /^(\d{4}-\d{2}-\d{2}T[\d:.]+Z) \[([A-Z]+)\] (.*)$/s;

export const logEntry = (line: string): LogEntry => {
  const parts = LINE.exec(line);
  if (!parts) return { at: null, trouble: false, text: line };
  const at = Date.parse(parts[1]!);
  return { at: Number.isNaN(at) ? null : at, trouble: parts[2] === "WARN" || parts[2] === "ERROR" || parts[2] === "FATAL", text: parts[3]! };
};
