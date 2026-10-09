import { pino, type Logger, type LoggerOptions } from "pino";

export type { Logger };

export function createLogger(options: { level?: string; name?: string } & LoggerOptions = {}): Logger {
  return pino({
    level: options.level ?? process.env.LOG_LEVEL ?? "info",
    base: { service: options.name },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: ["apiKey", "*.apiKey", "authorization", "*.authorization", "headers.authorization"],
      censor: "[redacted]",
    },
    ...options,
  });
}
