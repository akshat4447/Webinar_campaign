// Server-only, in-process. Lets one step of a pipeline wait for a sibling step
// that was started in the same process moments earlier — e.g. the LeadSquared
// registration activity waiting for the Zoom registrant sync so it can record the
// contact's PERSONAL join link instead of the generic one.
//
// Deliberately best-effort: it only coordinates work running in this process, and
// every waiter has a timeout. It is an ordering optimisation, never a lock — the
// durable guarantees come from the idempotency ledger and the reconcile sweep.

const pending = new Map<string, Promise<unknown>>();

/** Register `promise` under `key` until it settles. Returns the same promise. */
export function trackInflight<T>(key: string, promise: Promise<T>): Promise<T> {
  pending.set(key, promise);
  const clear = () => {
    if (pending.get(key) === promise) pending.delete(key);
  };
  promise.then(clear, clear);
  return promise;
}

/** Wait (at most `timeoutMs`) for the tracked work under `key`; resolves immediately if there is none. Never throws. */
export async function awaitInflight(key: string, timeoutMs = 10_000): Promise<void> {
  const p = pending.get(key);
  if (!p) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      p.then(
        () => undefined,
        () => undefined
      ),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const zoomRegistrantKey = (contactId: string) => `zoom-registrant:${contactId}`;
