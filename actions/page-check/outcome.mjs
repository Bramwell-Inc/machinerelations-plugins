// The three results of a page-check run.
// Clean is only a report this run finished: blocking is an empty array and the checker exited 0.
// The checker itself exits 1 when that same report lists defects, and that still fails the job.
// Any other exit, a skip, or a missing or unreadable report is not judged and does not fail the job.
// A report that lists blocking defects fails the job even if the checker exit was not 0, so a stale
// defect list is not turned into a pass. Clear the output directory before each run so a previous
// report cannot satisfy this.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOW = 'https://github.com/Bramwell-Inc/machinerelations-plugins/tree/main/plugins/machine-relations-index/skills/page-check';
const HEAD = {
  clean: '**Page check: clean.**',
  blocking: '**Page check: blocking.**',
  'not-judged': '**Page check: not judged.**',
};
const DEPLOYMENT = new Set(['missing', 'failure', 'error', 'inactive', 'pending', 'queued', 'in_progress']);

export function readRun(env = process.env) {
  const exitRaw = env.CHECKER_EXIT ?? '';
  const detailRaw = env.SKIP_DETAIL ?? '';
  return {
    skip: env.SKIP || '',
    detail: /^\d{3}$/.test(detailRaw) ? detailRaw : '',
    checkerExit: /^\d+$/.test(exitRaw) ? Number(exitRaw) : undefined,
  };
}

export function reasonForSkip(skip, detail = '') {
  const raw = String(skip || '');
  if (raw.startsWith('deployment-')) {
    const state = raw.slice('deployment-'.length);
    if (DEPLOYMENT.has(state)) return `The Vercel preview is ${state.replaceAll('_', ' ')}. The build check reports that.`;
    return 'The Vercel preview was not ready. The build check reports that.';
  }
  const code = /^[a-z0-9-]{1,40}$/.test(raw) ? raw : '';
  if (code === 'not-a-site') return 'No Vercel deployment record and no Vercel commit status for this commit, so this is not treated as a site.';
  if (code === 'no-preview-url') return 'Vercel completed a deployment, but GitHub recorded no preview address. The deployments list was empty and the status did not name one.';
  if (code === 'preview-alias-missing') return 'The branch preview derived from the Vercel status did not answer. That address is the latest preview of the branch, not a URL pinned to the commit.';
  if (code === 'preview-protected') {
    const status = /^\d{3}$/.test(detail) ? ` (HTTP ${detail})` : '';
    return `The preview refused this run${status}. Trusted preview access is a setting on each Vercel project for GitHub Actions of this org.`;
  }
  if (code === 'no-production') return 'The production domain could not be read from the sitemap or the repository homepage, so this change was not compared.';
  return 'The check did not judge this change.';
}

export function resetOutDir(outDir) {
  const dir = path.resolve(String(outDir || ''));
  if (!outDir || dir === path.parse(dir).root) throw new Error('page-check: refusing to clear an empty output path');
  fs.rmSync(dir, { recursive: true, force: true });
}

export function classifyRun({ skip = '', detail = '', report, checkerExit } = {}) {
  const findings = report && Array.isArray(report.blocking) ? report.blocking : null;
  if (findings && findings.length > 0) {
    const count = findings.length;
    return {
      verdict: 'blocking',
      fail: true,
      reason: `${count} blocking finding${count === 1 ? '' : 's'} in the report.`,
    };
  }
  if (skip || findings === null || checkerExit !== 0) {
    const exitNote = checkerExit === undefined ? '' : ` (exit ${checkerExit})`;
    const reason = skip
      ? reasonForSkip(skip, detail)
      : findings === null
        ? `The checker did not finish a report${exitNote}.`
        : `The checker did not finish this run${exitNote}. A report left on disk is not a clean result.`;
    return { verdict: 'not-judged', fail: false, reason };
  }
  return { verdict: 'clean', fail: false, reason: 'The sampled pages were read and this change adds nothing that blocks.' };
}

function headline(verdict) {
  switch (verdict) {
    case 'clean':
    case 'blocking':
    case 'not-judged':
      return HEAD[verdict];
    default: {
      const unknown = verdict;
      throw new Error(`Unknown page-check verdict: ${unknown}`);
    }
  }
}

export function commentText({ verdict, reason, summary = '' }) {
  const title = headline(verdict);
  if (verdict === 'not-judged') return `${title} ${reason} The pages were not read.`;
  const raw = String(summary || '').trim();
  if (raw.startsWith(title)) return raw;
  const text = raw.replace(/^\*\*Page check:[^*]*\*\*\s*/, '');
  return text ? `${title} ${reason}\n\n${text}` : `${title} ${reason}`;
}

export function planComment({ skip = '', detail = '', checkerExit, report, summary = '' } = {}) {
  const result = classifyRun({ skip, detail, report, checkerExit });
  const text = commentText({ verdict: result.verdict, reason: result.reason, summary: result.verdict === 'not-judged' ? '' : summary });
  const body = `${text}\n\n<sub>[How the page check works](${HOW})</sub>\n`;
  return { ...result, body };
}

export function planFromDir(outDir, env = process.env) {
  const run = readRun(env);
  let report;
  const reportPath = path.join(outDir, 'report.json');
  if (fs.existsSync(reportPath)) {
    try {
      report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    } catch {
      report = null;
    }
  }
  const summaryPath = path.join(outDir, 'summary.md');
  const summary = fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : '';
  return planComment({ ...run, report, summary });
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect && process.argv[2] === '--reset') resetOutDir(process.argv[3] || 'page-check-report');
