import { execSync } from 'node:child_process';

const rules = [
  {
    name: 'JWT-like token',
    regex: /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g,
  },
  {
    name: 'VK access token',
    regex: /vk1\.a\.[A-Za-z0-9._-]{20,}/g,
  },
  {
    name: 'Supabase PAT token',
    regex: /sbp_[A-Za-z0-9]{20,}/g,
  },
  {
    name: 'Supabase secret key token',
    regex: /sb_secret_[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: 'Hardcoded x-purchase-secret value',
    regex: /x-purchase-secret['"`]?\s*[:=]\s*['"`][^'"`\n]{8,}['"`]/g,
  },
  {
    name: 'Hardcoded Basic auth header',
    regex: /Authorization['"`]?\s*:\s*['"`]Basic\s+[A-Za-z0-9+/=]{20,}/g,
  },
  {
    name: 'Inline Basic credentials in Buffer.from',
    regex: /Buffer\.from\(['"`][^'"`\n]{2,}:[^'"`\n]{8,}['"`]\)/g,
  },
];

const allowedFragments = [
  'your_random_long_secret',
  'PURCHASE_APPLY_SECRET',
  'x-purchase-secret: PURCHASE_APPLY_SECRET',
  '<REDACTED_PURCHASE_SECRET>',
  'Authorization: Basic <base64>',
];

let historyPatch = '';
try {
  historyPatch = execSync('git log --all --no-color -p -- .', {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
} catch (error) {
  console.error('Failed to read git history patch stream.');
  console.error(String(error?.message || error || 'unknown error'));
  process.exit(2);
}

const findings = [];
for (const rule of rules) {
  const matches = historyPatch.matchAll(rule.regex);
  for (const match of matches) {
    const value = String(match[0] || '');
    if (allowedFragments.some((allowed) => value.includes(allowed))) {
      continue;
    }
    findings.push({ rule: rule.name, value });
  }
}

if (findings.length > 0) {
  console.error('Potential secrets detected in git history:');
  const unique = new Set();
  for (const finding of findings) {
    const preview =
      finding.value.length > 100 ? `${finding.value.slice(0, 97)}...` : finding.value;
    const key = `${finding.rule}::${preview}`;
    if (unique.has(key)) continue;
    unique.add(key);
    console.error(`- ${finding.rule} :: ${preview}`);
    if (unique.size >= 30) break;
  }
  process.exit(1);
}

console.log('History security scan passed: no obvious hardcoded secrets in git history.');
