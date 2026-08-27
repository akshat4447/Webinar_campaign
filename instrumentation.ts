// Runs once when a Next server instance starts (see Next's instrumentation.js
// docs). Used here for one thing: optionally driving the cadence on a timer so
// scheduled sends actually go out without anyone running a script.
//
// OFF BY DEFAULT, deliberately. This loop causes real messages to be sent, so
// it only starts when CADENCE_AUTOTICK is explicitly set. Nobody who clones the
// repo and runs `npm run dev` should discover their campaign emailing people.
//
// It is a convenience for a single long-running instance, not a job queue: the
// interval lives in this process, so it stops when the process does and would
// double up across replicas. For anything real, drive `npm run cadence:tick`
// from cron or a platform scheduler instead and leave this unset.

export async function register() {
  if (!process.env.CADENCE_AUTOTICK) return;
  // The timer and the DB only exist on the Node runtime, and this file is
  // evaluated for the Edge runtime too — so the implementation lives in a
  // separate module that the edge bundle never reaches.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { startCadenceAutotick } = await import('./lib/cadenceAutotick');
  startCadenceAutotick();
}
