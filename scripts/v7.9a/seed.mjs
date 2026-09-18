#!/usr/bin/env node
/**
 * scripts/v7.9a/seed.mjs - Seed synthetic data into the integration store PG.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/v7.9a/seed.mjs
 *
 * Idempotent: safe to re-run. Seeds:
 *   - Sample EXACT_MATCH contact link
 *   - Sample POSSIBLE_MATCH contact link
 *
 * NOTE: Org/staff seeding is in the integration-api runtime config (not PG).
 * The Integration store only tracks canonical links + receipts (CORE/1.3).
 */

import { createPrismaClient } from '../../packages/integration-store/dist/client/index.js';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const prisma = createPrismaClient({ databaseUrl: dbUrl, logger: 'error' });

const SAMPLE_LINKS = [
  {
    linkId: 'lnk-seed-exact-001',
    schemaVersion: '1',
    organizationId: 'org-synthetic-001',
    provider: 'CHATWOOT',
    connectionId: 'conn-synth-001',
    externalAccountId: 'ext-acct-seed-001',
    externalContactId: 'ext-contact-seed-001',
    state: 'EXACT_MATCH',
    matchedTargetKind: 'TALENT',
    matchedLaborProfileId: 'lp-seed-001',
    matchedLaborProfileVersion: 1,
    aggregateVersion: 1,
  },
  {
    linkId: 'lnk-seed-possible-001',
    schemaVersion: '1',
    organizationId: 'org-synthetic-001',
    provider: 'ZALO_OA',
    connectionId: 'conn-synth-001',
    externalAccountId: 'ext-acct-seed-002',
    externalContactId: 'ext-contact-seed-002',
    state: 'POSSIBLE_MATCH',
    candidateReviewQueueEntryId: 'rev-seed-001',
    candidateRecordedAt: new Date(),
    aggregateVersion: 1,
  },
  {
    linkId: 'lnk-seed-exact-002',
    schemaVersion: '1',
    organizationId: 'org-synthetic-002',
    provider: 'CHATWOOT',
    connectionId: 'conn-synth-002',
    externalAccountId: 'ext-acct-seed-003',
    externalContactId: 'ext-contact-seed-003',
    state: 'EXACT_MATCH',
    matchedTargetKind: 'CLIENT',
    matchedClientContactId: 'cc-seed-001',
    matchedClientContactVersion: 1,
    aggregateVersion: 1,
  },
];

const SAMPLE_CONV_LINKS = [
  {
    linkId: 'cnv-seed-001',
    schemaVersion: '1',
    organizationId: 'org-synthetic-001',
    conversationId: 'conv-seed-001',
    conversationKind: 'TALENT',
    primaryTargetKind: 'TALENT',
    primaryLaborProfileId: 'lp-seed-001',
    externalRefsJson: { refs: [{ provider: 'CHATWOOT', connectionId: 'conn-synth-001', externalId: 'ext-conv-001' }] },
    currentRevision: 1,
  },
];

let seeded = 0;

for (const link of SAMPLE_LINKS) {
  await prisma.externalContactLink.upsert({
    where: { linkId: link.linkId },
    update: {},
    create: link,
  });
  seeded++;
  console.log(`[seed] contact link ${link.provider}:${link.externalContactId} (${link.state})`);
}

for (const link of SAMPLE_CONV_LINKS) {
  await prisma.externalConversationLink.upsert({
    where: { linkId: link.linkId },
    update: {},
    create: link,
  });
  seeded++;
  console.log(`[seed] conv link ${link.conversationId}`);
}

console.log(`[seed] complete: ${seeded} rows seeded/updated.`);
await prisma.$disconnect();
