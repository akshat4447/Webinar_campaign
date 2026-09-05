// Runs once when a Next server instance starts (see Next's instrumentation.js
// docs). Used here for two things: optionally driving the cadence on a timer
// so scheduled sends actually go out without anyone running a script, and
// optionally syncing Zoom (meeting creation/import + attendance) the same way.
//
// OFF BY DEFAULT, deliberately. Both loops cause real messages/API calls, so
// each only starts when its own env var is explicitly set. Nobody who clones
// the repo and runs `npm run dev` should discover their campaign emailing
// people or creating Zoom meetings.
//
// Both are a convenience for a single long-running instance, not a job queue:
// the interval lives in this process, so it stops when the process does and
// would double up across replicas. For anything real, drive `npm run
// cadence:tick` from cron or a platform scheduler instead and leave these unset.

export async function register() {
  // The timers and the DB only exist on the Node runtime, and this file is
  // evaluated for the Edge runtime too — so the implementations live in
  // separate modules the edge bundle never reaches.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  if (process.env.CADENCE_AUTOTICK) {
    const { startCadenceAutotick } = await import('./lib/cadenceAutotick');
    startCadenceAutotick();
  }

  if (process.env.ZOOM_AUTOSYNC) {
    const { startZoomAutosync } = await import('./lib/zoomAutosync');
    startZoomAutosync();
  }
}
