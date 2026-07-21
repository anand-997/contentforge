// lib/logger.ts
// File + console logger with rotation. No `any` anywhere.

import fs from "fs";
import path from "path";
import { DATA_DIR } from "./dataDir";

type LogLevel = "INFO" | "WARN" | "ERROR";

const LOG_DIR = path.join(DATA_DIR, "logs");
const LOG_FILE = path.join(LOG_DIR, "pipeline.log");
const LOG_BACKUP = path.join(LOG_DIR, "pipeline.log.bak");
const MAX_LOG_BYTES = 10 * 1024 * 1024; // 10MB

function ensureLogDir(): void {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      fs.mkdirSync(LOG_DIR, { recursive: true });
    }
  } catch {
    // If we cannot create the directory, fall back to console-only.
  }
}

function rotateIfNeeded(): void {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return;
    }
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_LOG_BYTES) {
      if (fs.existsSync(LOG_BACKUP)) {
        fs.rmSync(LOG_BACKUP, { force: true });
      }
      fs.renameSync(LOG_FILE, LOG_BACKUP);
    }
  } catch {
    // Rotation failures must never crash the pipeline.
  }
}

function formatExtra(extra: unknown[]): string {
  if (extra.length === 0) {
    return "";
  }
  const parts = extra.map((item) => {
    if (item instanceof Error) {
      return item.stack ?? `${item.name}: ${item.message}`;
    }
    if (typeof item === "string") {
      return item;
    }
    try {
      return JSON.stringify(item);
    } catch {
      return String(item);
    }
  });
  return " " + parts.join(" ");
}

function write(level: LogLevel, msg: string, extra: unknown[]): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${msg}${formatExtra(extra)}`;

  // Console output.
  if (level === "ERROR") {
    console.error(line);
  } else if (level === "WARN") {
    console.warn(line);
  } else {
    console.log(line);
  }

  // File output.
  try {
    ensureLogDir();
    rotateIfNeeded();
    fs.appendFileSync(LOG_FILE, line + "\n", { encoding: "utf8" });
  } catch {
    // Never throw from the logger.
  }
}

export const logger: {
  info(msg: string, ...a: unknown[]): void;
  warn(msg: string, ...a: unknown[]): void;
  error(msg: string, ...a: unknown[]): void;
} = {
  info(msg: string, ...a: unknown[]): void {
    write("INFO", msg, a);
  },
  warn(msg: string, ...a: unknown[]): void {
    write("WARN", msg, a);
  },
  error(msg: string, ...a: unknown[]): void {
    write("ERROR", msg, a);
  },
};
