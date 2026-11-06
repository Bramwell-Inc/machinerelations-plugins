#!/usr/bin/env node
// Fails the job only when a finished report lists blocking defects.
// A skip or a missing report is not judged: the job stays green, and the log says so.
import { planFromDir } from './outcome.mjs';

const plan = planFromDir(process.argv[2] || 'page-check-report');
if (plan.fail) {
  console.log('::error::Page check: blocking. The pull request comment lists each defect this change adds.');
  process.exit(1);
}
if (plan.verdict === 'not-judged') console.log(`::warning::Page check: not judged. ${plan.reason}`);
else console.log('Page check: clean.');
