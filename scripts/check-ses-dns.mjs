#!/usr/bin/env node
/**
 * check-ses-dns.mjs
 *
 * Manual DNS validation script for SES deliverability records on mail.zeroroot.ai.
 *
 * Checks for:
 *   - SPF TXT record: v=spf1 include:amazonses.com
 *   - DMARC TXT record: v=DMARC1
 *
 * NOT in the standard prebuild chain (too slow for CI). Run manually after
 * provisioning Route53 records to validate they have propagated:
 *
 *   VALIDATE_SES_DNS=1 node scripts/check-ses-dns.mjs
 *
 * Also validates using dnsx if available:
 *   dnsx -d mail.zeroroot.ai -t TXT
 *
 * Spec: stripe-billing-integration R6.5, AC 12.
 */

import { promises as dns } from 'node:dns';
import { execSync } from 'node:child_process';

const DOMAIN = 'mail.zeroroot.ai';
const DMARC_DOMAIN = `_dmarc.${DOMAIN}`;

if (!process.env.VALIDATE_SES_DNS) {
  console.log('check-ses-dns.mjs: set VALIDATE_SES_DNS=1 to run DNS validation.');
  console.log('This check is intentionally NOT in the standard prebuild chain.');
  process.exit(0);
}

async function checkSPF() {
  try {
    const records = await dns.resolveTxt(DOMAIN);
    const spfRecord = records.flat().find((r) => r.startsWith('v=spf1'));
    if (!spfRecord) {
      console.error(`❌ No SPF record found for ${DOMAIN}`);
      console.error('   Expected: v=spf1 include:amazonses.com ~all');
      return false;
    }
    if (!spfRecord.includes('include:amazonses.com')) {
      console.error(`❌ SPF record for ${DOMAIN} does not include amazonses.com:`);
      console.error(`   Found: ${spfRecord}`);
      return false;
    }
    console.log(`✓ SPF record present for ${DOMAIN}: ${spfRecord}`);
    return true;
  } catch (err) {
    console.error(`❌ SPF DNS lookup failed for ${DOMAIN}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function checkDMARC() {
  try {
    const records = await dns.resolveTxt(DMARC_DOMAIN);
    const dmarcRecord = records.flat().find((r) => r.startsWith('v=DMARC1'));
    if (!dmarcRecord) {
      console.error(`❌ No DMARC record found at ${DMARC_DOMAIN}`);
      console.error('   Expected: v=DMARC1; p=quarantine; rua=mailto:dmarc-reports@zeroroot.ai');
      return false;
    }
    console.log(`✓ DMARC record present at ${DMARC_DOMAIN}: ${dmarcRecord}`);
    return true;
  } catch (err) {
    console.error(`❌ DMARC DNS lookup failed for ${DMARC_DOMAIN}:`, err instanceof Error ? err.message : String(err));
    return false;
  }
}

function runDnsx() {
  try {
    execSync(`which dnsx`, { stdio: 'ignore' });
  } catch {
    console.log('ℹ dnsx not found — skipping extended DNS check.');
    console.log('  Install with: go install github.com/projectdiscovery/dnsx/cmd/dnsx@latest');
    return true;
  }

  try {
    const output = execSync(`dnsx -d ${DOMAIN} -t TXT -resp`, { encoding: 'utf8' });
    console.log(`\ndnsx output for ${DOMAIN}:`);
    console.log(output);
    return true;
  } catch (err) {
    console.error('dnsx failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

async function main() {
  console.log(`Validating SES DNS records for ${DOMAIN}...\n`);

  const [spfOk, dmarcOk] = await Promise.all([checkSPF(), checkDMARC()]);
  const dnsx = runDnsx();

  if (spfOk && dmarcOk && dnsx) {
    console.log(`\n✓ All DNS checks passed for ${DOMAIN}`);
    console.log('  Next step: check SES console for domain verification status.');
    process.exit(0);
  } else {
    console.error(`\n❌ One or more DNS checks failed for ${DOMAIN}`);
    console.error('  Ensure Route53 records are configured per:');
    console.error('  enterprise/gitops/apps/gibson/ses-dns-records.yaml');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
