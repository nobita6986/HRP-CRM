-- packages/integration-store/prisma/migrations/0001_init/migration.sql
--
-- Init migration for integration store (CORE/1.3).
-- Creates schema `integration` separate from `public`.
-- All canonical HRP IDs are scalar (no FK across DB).
-- Migration follows PostgreSQL transactional DDL.

CREATE SCHEMA IF NOT EXISTS integration;

SET search_path TO integration, public;

-- =============================================================================
-- Enums (PostgreSQL native enums; Prisma sync).
-- =============================================================================
CREATE TYPE integration."LinkState" AS ENUM (
  'EXACT_MATCH', 'POSSIBLE_MATCH', 'UNRESOLVED'
);

CREATE TYPE integration."TargetKind" AS ENUM (
  'TALENT', 'CLIENT'
);

CREATE TYPE integration."ConversationKind" AS ENUM (
  'TALENT', 'CLIENT', 'INTERNAL', 'UNKNOWN'
);

CREATE TYPE integration."EventDuplicateKind" AS ENUM (
  'DEDUPE', 'OUT_OF_ORDER', 'CORRECTION', 'GAP', 'UNKNOWN'
);

CREATE TYPE integration."EventReceiptState" AS ENUM (
  'PENDING', 'LEASED', 'DISPATCH_COMMITTED',
  'RETRY_SCHEDULED', 'DELIVERED', 'DEAD_LETTERED', 'QUARANTINED'
);

CREATE TYPE integration."IntentStatus" AS ENUM (
  'PENDING', 'LEASED', 'DISPATCHED', 'ACK_RECEIVED',
  'DELIVERED', 'FAILED', 'TERMINAL'
);

-- =============================================================================
-- ExternalContactLink
-- =============================================================================
CREATE TABLE integration."ExternalContactLink" (
  "linkId"                       VARCHAR(128)  PRIMARY KEY,
  "schemaVersion"                VARCHAR(8)    NOT NULL,
  "organizationId"               VARCHAR(64)   NOT NULL,
  "provider"                     VARCHAR(64)   NOT NULL,
  "connectionId"                 VARCHAR(128)  NOT NULL,
  "externalAccountId"            VARCHAR(128)  NOT NULL,
  "externalContactId"            VARCHAR(256),

  "state"                        integration."LinkState" NOT NULL,

  "matchedTargetKind"            integration."TargetKind",
  "matchedLaborProfileId"        VARCHAR(128),
  "matchedLaborProfileVersion"   INTEGER,
  "matchedClientContactId"       VARCHAR(128),
  "matchedClientContactVersion"  INTEGER,

  "candidateReviewQueueEntryId"  VARCHAR(128),
  "candidateRecordedAt"          TIMESTAMP,

  "aggregateVersion"             INTEGER       NOT NULL DEFAULT 0,
  "lastAttemptedAt"              TIMESTAMP,
  "evidenceRefsJson"             JSONB,
  "createdAt"                    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "uq_contact_link_scope"
    UNIQUE ("organizationId", "provider", "connectionId", "externalAccountId", "externalContactId")
);

CREATE INDEX "ix_link_scope_state"
  ON integration."ExternalContactLink" ("organizationId", "provider", "connectionId", "state");
CREATE INDEX "ix_link_laborprofile"
  ON integration."ExternalContactLink" ("matchedLaborProfileId");
CREATE INDEX "ix_link_clientcontact"
  ON integration."ExternalContactLink" ("matchedClientContactId");

-- =============================================================================
-- ExternalConversationLink
-- =============================================================================
CREATE TABLE integration."ExternalConversationLink" (
  "linkId"                  VARCHAR(128)  PRIMARY KEY,
  "schemaVersion"           VARCHAR(8)    NOT NULL,
  "organizationId"          VARCHAR(64)   NOT NULL,
  "conversationId"          VARCHAR(128)  NOT NULL,
  "conversationVersion"     INTEGER       NOT NULL DEFAULT 0,
  "conversationKind"        integration."ConversationKind" NOT NULL,
  "primaryTargetKind"       integration."TargetKind",
  "primaryLaborProfileId"   VARCHAR(128),
  "primaryClientContactId"  VARCHAR(128),
  "externalRefsJson"        JSONB         NOT NULL,
  "currentRevision"         INTEGER       NOT NULL DEFAULT 0,
  "historyRevisionsJson"    JSONB,
  "createdAt"               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ix_conv_link_scope_version"
  ON integration."ExternalConversationLink" ("organizationId", "conversationId", "currentRevision");
CREATE INDEX "ix_conv_link_labor"
  ON integration."ExternalConversationLink" ("organizationId", "primaryLaborProfileId");
CREATE INDEX "ix_conv_link_client"
  ON integration."ExternalConversationLink" ("organizationId", "primaryClientContactId");

-- =============================================================================
-- ExternalEventReceipt
-- =============================================================================
CREATE TABLE integration."ExternalEventReceipt" (
  "receiptId"       VARCHAR(128)  PRIMARY KEY,
  "schemaVersion"   VARCHAR(8)    NOT NULL,
  "organizationId"  VARCHAR(64)   NOT NULL,
  "provider"        VARCHAR(64)   NOT NULL,
  "connectionId"    VARCHAR(128)  NOT NULL,
  "eventId"         VARCHAR(128)  NOT NULL,
  "payloadDigest"   CHAR(64)      NOT NULL,
  "state"           integration."EventReceiptState" NOT NULL DEFAULT 'PENDING',
  "duplicateKind"   integration."EventDuplicateKind" NOT NULL DEFAULT 'UNKNOWN',
  "attempts"        INTEGER       NOT NULL DEFAULT 0,
  "leaseOwner"      VARCHAR(128),
  "leaseExpiresAt"  TIMESTAMP,
  "correlationId"   VARCHAR(128),
  "commandRefsJson" JSONB,
  "firstSeenAt"     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt"      TIMESTAMP,
  "reasonCode"      VARCHAR(64),
  "evidenceRefsJson" JSONB,
  "createdAt"       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "uq_receipt_event_id"
    UNIQUE ("organizationId", "provider", "connectionId", "eventId")
);

CREATE INDEX "ix_receipt_state"
  ON integration."ExternalEventReceipt" ("organizationId", "state");
CREATE INDEX "ix_receipt_payload_digest"
  ON integration."ExternalEventReceipt" ("organizationId", "payloadDigest");
CREATE INDEX "ix_receipt_lease"
  ON integration."ExternalEventReceipt" ("leaseExpiresAt");

-- =============================================================================
-- DispatchIntent
-- =============================================================================
CREATE TABLE integration."DispatchIntent" (
  "intentId"          VARCHAR(128)  PRIMARY KEY,
  "schemaVersion"     VARCHAR(8)    NOT NULL,
  "organizationId"    VARCHAR(64)   NOT NULL,
  "receiptId"         VARCHAR(128)  NOT NULL,
  "idempotencyKey"    VARCHAR(256),
  "correlationId"     VARCHAR(128),
  "intentSource"      VARCHAR(64)   NOT NULL,
  "intentTargetJson"  JSONB         NOT NULL,
  "status"            integration."IntentStatus" NOT NULL DEFAULT 'PENDING',
  "attempts"          INTEGER       NOT NULL DEFAULT 0,
  "leaseOwner"        VARCHAR(128),
  "leaseExpiresAt"    TIMESTAMP,
  "createdAt"         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "uq_intent_receipt"
    UNIQUE ("organizationId", "receiptId", "intentId")
);

CREATE INDEX "ix_intent_status"
  ON integration."DispatchIntent" ("organizationId", "status");
CREATE INDEX "ix_intent_lease"
  ON integration."DispatchIntent" ("leaseExpiresAt");
