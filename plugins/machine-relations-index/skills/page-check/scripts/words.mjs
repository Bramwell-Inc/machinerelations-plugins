// Words a reader should never see. Each rule names what it catches; `hard` blocks a merge.
const PLURAL_OK = /(ss|us|is|news|series|species|ics|ous|plus|bus|yes|this|has|was|its|less|always|towards|afterwards|perhaps|across|thus)$/i;

// "Tier 1 outlets", "rank 1 earns", "Step 1 means": the 1 names a rank or a step, not a count.
const LABEL_BEFORE = /\b(tier|layer|level|rank|ranked|top|no\.|number|step|phase|stage|day|week|month|year|part|chapter|section|grade|class|category|type|gen|web|version|v|position|slot|page|round|series|season|issue|vol\.?|volume|figure|fig\.|table|option|plan|priority|p|q[1-4]?|quarter|zone|jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sept?(ember)?|oct(ober)?|nov(ember)?|dec(ember)?)\s*$/i;
const PROSE_BEFORE = /\b(is|are|be|been|was|or|nor|either|returns?|as|a|an|the|above|below|against|than|versus|vs\.?)\s+$/i;
const PROSE_AFTER = /^\s+(when|if|means|otherwise|until|unless|or)\b/i;
// "Ontology 1 shifts", "Gemini 1 means": a capitalised word before the 1 makes it a name, unless that word is how a count is introduced.
const NAME_BEFORE = (before) => { const w = (before.match(/([A-Z][\w-]*)\s+$/) || [])[1]; return !!w && !/^(In|From|By|Across|With|On|For|To|At|Over|Seen|Cited|Found|Only|Just|All|About|Of)$/.test(w); };
// A value leaks where a count or a name belongs ("cited by null sources"); "a null baseline" or "null calibration" is the word itself.
const LEAK_BEFORE = /\b(by|in|of|from|across|with|on|for|to|at)\s+$/i;

export const RULES = [
  { kind: 'raw-value', hard: true, re: /(?<![\w-])(null|undefined|NaN)(?![\w-])/g, why: 'a missing value printed as code' },
  { kind: 'raw-value', hard: true, re: /\[object (Object|Promise|Array)\]/g, why: 'an object printed as text' },
  { kind: 'raw-value', hard: true, re: /\{\{[^}]{1,40}\}\}|\$\{[^}]{1,40}\}/g, why: 'an unfilled template slot' },
  { kind: 'raw-value', hard: true, re: /(?<![\w.])(-?Infinity)(?![\w])/g, why: 'a division by zero printed' },
  { kind: 'raw-id', hard: true, re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, why: 'an internal id shown to people' },
  // Versioned internal ids ("mri_score_v2.1+2026-11-05+66c5…") and status codes ("release_unavailable") are machinery.
  { kind: 'raw-id', hard: true, re: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)*_v\d+(?:\.\d+)*(?:\+[\w.-]+)*|\b[a-z][a-z0-9]*_(?:unavailable|unknown|missing|pending|invalid|none|null|undefined|error)\b|\b(?:unknown|missing|invalid|no)_[a-z][a-z0-9_]*\b/g, why: 'an internal name shown to people' },
  // Other snake_case can be a real term ("utm_source", a documented API field): a note, not a block.
  { kind: 'raw-id', hard: false, re: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, why: 'looks like an internal name; fine if the page is about that name' },
  { kind: 'raw-id', hard: false, re: /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{12,40}\b/g, why: 'looks like a hash or internal id' },
  { kind: 'bad-plural', hard: true, re: /(?<![\d.,#-])\b1 ([a-z]{3,}s)\b/g, test: (m, text) => !PLURAL_OK.test(m[1]) && !LABEL_BEFORE.test(text.slice(Math.max(0, m.index - 16), m.index)) && !NAME_BEFORE(text.slice(Math.max(0, m.index - 30), m.index)), why: 'one of something written as plural' },
  { kind: 'bad-plural', hard: false, re: /\b(0|[2-9]|\d{2,}) (answer|source|citation|result|page|item|run|post|study|engine|domain|question|mention)\b(?![s-])/g, why: 'many of something written as singular' },
  { kind: 'zero-rate', hard: false, re: /(?<![\d.])0\.0+%/g, why: 'a rate shown as zero; if it is not zero, say "under 0.01%"' },
  { kind: 'domain-case', hard: false, re: /\b[A-Z][a-z0-9-]{1,30}\.(com|io|ai|org|net|co)\b/g, why: 'a web address with a capital letter (fine only if it is a brand name)' },
  { kind: 'placeholder', hard: true, re: /\b(lorem ipsum|TODO|FIXME|TBD|placeholder text)\b/gi, why: 'placeholder copy' },
];

export function scanWords(text) {
  const found = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text))) {
      if (rule.test && !rule.test(m, text)) continue;
      const start = Math.max(0, m.index - 40);
      const context = text.slice(start, m.index + m[0].length + 40).replace(/\s+/g, ' ').trim();
      // Prose about code ("next_cursor is null") is not a leaked value: skip matches in a sentence that quotes code,
      // and a bare null/undefined that the sentence itself talks about ("is null when", "null means", "or null").
      if ((rule.kind === 'raw-value' || rule.kind === 'raw-id') && /`/.test(sentenceAround(text, m.index))) continue;
      if (rule.kind === 'raw-value' && /^(null|undefined|NaN)$/.test(m[0]) && (PROSE_BEFORE.test(text.slice(Math.max(0, m.index - 12), m.index)) || PROSE_AFTER.test(text.slice(m.index + m[0].length, m.index + m[0].length + 14)))) continue;
      if (rule.kind === 'raw-value' && m[0] === 'null' && /^ [a-z]{3,}/.test(text.slice(m.index + 4, m.index + 9)) && !LEAK_BEFORE.test(text.slice(Math.max(0, m.index - 10), m.index))) continue;
      // An id inside a link (a file or page address) is the address, not an id shown to people.
      if (rule.kind === 'raw-id' && (/^(@|\.[a-z])/i.test(text.slice(m.index + m[0].length, m.index + m[0].length + 2)) || /[/=%@]/.test(text.slice(text.lastIndexOf(' ', m.index) + 1, m.index)))) continue;
      // An error code named after its HTTP status ("returns 409 release_unavailable") is API documentation, not a leak.
      if (rule.kind === 'raw-id' && /\b[1-5]\d\d\s+$/.test(text.slice(Math.max(0, m.index - 6), m.index))) continue;
      found.push({ kind: rule.kind, hard: rule.hard, match: m[0], why: rule.why, context });
      if (found.filter((f) => f.kind === rule.kind).length > 5) break;
    }
  }
  return found;
}

function sentenceAround(text, at) {
  const before = text.lastIndexOf('.', at - 1); const nl = text.lastIndexOf('\n', at - 1);
  const start = Math.max(before, nl) + 1;
  const endDot = text.indexOf('. ', at); const endNl = text.indexOf('\n', at);
  const end = Math.min(endDot === -1 ? text.length : endDot, endNl === -1 ? text.length : endNl);
  return text.slice(start, end);
}
