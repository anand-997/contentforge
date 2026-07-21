// lib/pipelineLock.ts
// In-memory pipeline mutex + cooperative stop signaling.

let locked = false;
let stopRequested = false;

export function acquireLock(): void {
  locked = true;
  // A fresh run always starts with a clear stop flag.
  stopRequested = false;
}

export function releaseLock(): void {
  locked = false;
  stopRequested = false;
}

export function isPipelineLocked(): boolean {
  return locked;
}

/** Ask the running pipeline to stop at the next safe checkpoint. */
export function requestStop(): void {
  if (locked) {
    stopRequested = true;
  }
}

export function isStopRequested(): boolean {
  return stopRequested;
}

export function clearStop(): void {
  stopRequested = false;
}

/**
 * Thrown by agents when a stop has been requested. The pipeline treats this as
 * a clean stop (not an error) and leaves the row in a resumable state.
 */
export class PipelineStoppedError extends Error {
  constructor(message = "Pipeline stopped by user") {
    super(message);
    this.name = "PipelineStoppedError";
  }
}

/** Throw if a stop was requested — call at safe checkpoints between steps. */
export function checkStop(): void {
  if (stopRequested) {
    throw new PipelineStoppedError();
  }
}
