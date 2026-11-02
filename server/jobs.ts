/**
 * Scan jobs, in memory only. A job holds the events a scan emitted so a browser that
 * connects late (or reconnects) gets the whole story. Jobs and their events are deleted
 * ten minutes after they finish; nothing is written to disk.
 */
import { randomUUID } from 'node:crypto';
import type { ScanEvent } from '../src/shared/api';

export interface Job {
  id: string;
  createdAt: number;
  finishedAt: number | null;
  events: ScanEvent[];
  listeners: Set<(e: ScanEvent, index: number) => void>;
  controller: AbortController;
  escalations: Map<string, (approve: boolean) => void>;
  owner: string;
}

const TERMINAL = new Set<ScanEvent['type']>(['done', 'error']);

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly timer: NodeJS.Timeout;
  constructor(
    private readonly ttlMs = 10 * 60_000,
    readonly maxActive = 24,
  ) {
    this.timer = setInterval(() => this.sweep(), 30_000);
    this.timer.unref();
  }

  get active(): number {
    let n = 0;
    for (const j of this.jobs.values()) if (j.finishedAt === null) n++;
    return n;
  }

  create(owner: string): Job {
    const job: Job = { id: randomUUID(), createdAt: Date.now(), finishedAt: null, events: [], listeners: new Set(), controller: new AbortController(), escalations: new Map(), owner };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  push(job: Job, e: ScanEvent): void {
    if (job.finishedAt !== null) return;
    // Profiles are kept once; intermediate events are small.
    job.events.push(e);
    const index = job.events.length - 1;
    for (const l of job.listeners) l(e, index);
    if (TERMINAL.has(e.type)) this.finish(job);
  }

  finish(job: Job): void {
    if (job.finishedAt === null) job.finishedAt = Date.now();
    for (const resolve of job.escalations.values()) resolve(false);
    job.escalations.clear();
  }

  /** Waits for the person to approve sending data to a hosted model. Declines after the timeout. */
  awaitEscalation(job: Job, requestId: string, timeoutMs = 5 * 60_000): Promise<boolean> {
    return new Promise((resolve) => {
      const t = setTimeout(() => done(false), timeoutMs);
      t.unref();
      const done = (v: boolean) => {
        clearTimeout(t);
        job.escalations.delete(requestId);
        resolve(v);
      };
      job.escalations.set(requestId, done);
      job.controller.signal.addEventListener('abort', () => done(false), { once: true });
    });
  }

  answerEscalation(job: Job, requestId: string, approve: boolean): boolean {
    const r = job.escalations.get(requestId);
    if (!r) return false;
    r(approve);
    return true;
  }

  sweep(now = Date.now()): void {
    for (const [id, j] of this.jobs) {
      const age = j.finishedAt !== null ? now - j.finishedAt : now - j.createdAt;
      if (age > this.ttlMs || (j.finishedAt === null && now - j.createdAt > 3 * this.ttlMs)) {
        j.controller.abort();
        this.jobs.delete(id);
      }
    }
  }

  close(): void {
    clearInterval(this.timer);
    for (const j of this.jobs.values()) j.controller.abort();
    this.jobs.clear();
  }
}
