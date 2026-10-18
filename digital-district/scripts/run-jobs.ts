// Runs the scheduled jobs once (alternative to calling /api/cron). Usage: npm run jobs:run
import { runScheduledJobs } from "../src/lib/jobs";
import { db } from "../src/lib/db";

runScheduledJobs()
  .then((r) => console.log(JSON.stringify(r)))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
