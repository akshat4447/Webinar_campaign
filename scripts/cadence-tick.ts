import '../lib/loadEnv';
import { db } from '../lib/db';
import { runWorkerTick } from '../lib/workerTick';
runWorkerTick().then(result => { console.log(JSON.stringify(result)); if (!result.ok) process.exitCode = 1; }).catch(err => { console.error(err); process.exitCode = 1; }).finally(() => db.$disconnect());
