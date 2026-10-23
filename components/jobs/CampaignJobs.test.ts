import { describe, it, expect } from 'vitest';
import { jobsNeedAttention } from './CampaignJobs';

const quiet = { jobs: [], registrationFailures: 0, unknownSends: 0, uncertainOperations: [], heartbeat: { ok: true } };

describe('jobsNeedAttention', () => {
  it('stays quiet when nothing needs a person, whatever the cadence is doing', () => {
    expect(jobsNeedAttention(quiet, true)).toBe(false);
    expect(jobsNeedAttention(quiet, false)).toBe(false);
    expect(jobsNeedAttention({ ...quiet, jobs: [{ status: 'completed' }, { status: 'cancelled' }] }, false)).toBe(false);
  });

  it('has no worker run to report for a webinar whose cadence is not running', () => {
    expect(jobsNeedAttention({ ...quiet, heartbeat: null }, false)).toBe(false);
  });

  it('speaks up for a running cadence that has never had a worker run: nothing will be sent', () => {
    expect(jobsNeedAttention({ ...quiet, heartbeat: null }, true)).toBe(true);
  });

  it('speaks up for an open job, a failure, an uncertain send, or a failed worker run', () => {
    expect(jobsNeedAttention({ ...quiet, jobs: [{ status: 'processing' }] }, false)).toBe(true);
    expect(jobsNeedAttention({ ...quiet, registrationFailures: 1 }, false)).toBe(true);
    expect(jobsNeedAttention({ ...quiet, unknownSends: 2 }, false)).toBe(true);
    expect(jobsNeedAttention({ ...quiet, uncertainOperations: [{}] }, false)).toBe(true);
    expect(jobsNeedAttention({ ...quiet, heartbeat: { ok: false } }, false)).toBe(true);
  });
});
