import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const trackedFiles = execSync('git ls-files', { encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

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
];

const allowedFragments = [
  'your_random_long_secret',
  'PURCHASE_APPLY_SECRET',
  'x-purchase-secret: PURCHASE_APPLY_SECRET',
];

const findings = [];

for (const file of trackedFiles) {
  let text = '';
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  for (const rule of rules) {
    const matches = text.matchAll(rule.regex);
    for (const match of matches) {
      const value = String(match[0] || '');
      if (allowedFragments.some((allowed) => value.includes(allowed))) {
        continue;
      }
      findings.push({ file, rule: rule.name, value });
    }
  }
}

if (findings.length > 0) {
  console.error('Potential secrets detected in tracked files:');
  for (const finding of findings) {
    const preview =
      finding.value.length > 80 ? `${finding.value.slice(0, 77)}...` : finding.value;
    console.error(`- ${finding.file} :: ${finding.rule} :: ${preview}`);
  }
  process.exit(1);
}

console.log('Security scan passed: no obvious hardcoded secrets in tracked files.');
