type Value = string | number | boolean | undefined;

/**
 * Structured logging to stdout. Only primitive fields are accepted on purpose:
 * log claim IDs and status words, never invoice contents or personal data.
 */
export function log(
  level: 'info' | 'warn' | 'error',
  message: string,
  fields: Record<string, Value> = {},
): void {
  if (process.env.LOG_SILENT === '1') return;
  process.stdout.write(`${JSON.stringify({ level, message, ...fields })}\n`);
}
