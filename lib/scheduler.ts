// lib/scheduler.ts
// Singleton node-cron scheduler driven by config schedule + timezone.

import cron from "node-cron";
import { readConfig } from "./configManager";
import { runPipeline } from "./pipeline";
import { logger } from "./logger";

let currentJob: cron.ScheduledTask | null = null;

export function startScheduler(): void {
  if (currentJob) {
    currentJob.stop();
    currentJob = null;
  }

  const config = readConfig();
  const { cronSchedule, timezone } = config.scheduler;

  if (!cron.validate(cronSchedule)) {
    logger.error(`Invalid cron expression: ${cronSchedule}`);
    return;
  }

  currentJob = cron.schedule(
    cronSchedule,
    () => {
      logger.info(`Cron triggered — running pipeline (${cronSchedule})`);
      void runPipeline();
    },
    { timezone },
  );

  logger.info(`Scheduler started: ${cronSchedule} (${timezone})`);
}

export function stopScheduler(): void {
  currentJob?.stop();
  currentJob = null;
}

// Best-effort human-readable description of the next run.
// Handles the common "m h * * *" daily form; otherwise returns the raw cron.
export function getNextRunDescription(): string {
  const config = readConfig();
  const { cronSchedule, timezone } = config.scheduler;

  const tzAbbrev = timezoneAbbrev(timezone);
  const parts = cronSchedule.trim().split(/\s+/);

  if (parts.length === 5) {
    const [minRaw, hourRaw, dom, mon, dow] = parts;
    const minute = Number(minRaw);
    const hour = Number(hourRaw);
    const isDaily =
      Number.isInteger(minute) &&
      Number.isInteger(hour) &&
      dom === "*" &&
      mon === "*" &&
      dow === "*";

    if (isDaily && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      const period = hour < 12 ? "AM" : "PM";
      let displayHour = hour % 12;
      if (displayHour === 0) {
        displayHour = 12;
      }
      const mm = String(minute).padStart(2, "0");
      return `${displayHour}:${mm} ${period} ${tzAbbrev}`;
    }
  }

  return `${cronSchedule} (${timezone})`;
}

function timezoneAbbrev(timezone: string): string {
  // Map a few common zones to friendly abbreviations; fall back to the IANA id.
  const map: Record<string, string> = {
    "Asia/Kolkata": "IST",
    "Asia/Calcutta": "IST",
    "UTC": "UTC",
    "Etc/UTC": "UTC",
    "America/New_York": "ET",
    "America/Los_Angeles": "PT",
    "Europe/London": "GMT",
  };
  return map[timezone] ?? timezone;
}
