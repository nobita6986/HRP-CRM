import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AVAILABILITIES,
  AvailabilitySchema,
  CASE_CLOSE_REASONS,
  CaseCloseReasonSchema,
  CLOSED_CASE_STATUS,
  ClosedCaseStatusSchema,
  CURRENT_RELATIONSHIPS,
  CURRENT_RELATIONSHIP_READONLY,
  CurrentRelationshipSchema,
  FORBIDDEN_CLOSED_VARIANTS,
  MATCHING_OUTCOMES,
  MatchingOutcomeSchema,
  NEXT_ACTION_STATUSES,
  NextActionStatusSchema,
  PLACEMENT_CASE_STAGES,
  PlacementCaseStageSchema,
  SCHEMA_VERSION,
} from '../dist/index.js';

const reject = (schema, value) => assert.equal(schema.safeParse(value).success, false);

test('PlacementCase stages exactly match the eight confirmed values', () => {
  assert.deepEqual([...PLACEMENT_CASE_STAGES], [
    'NEW', 'CONTACTING', 'QUALIFYING', 'MATCHING',
    'PROPOSED', 'INTERESTED', 'CLIENT_PROCESS', 'READY_TO_START',
  ]);
  for (const stage of PLACEMENT_CASE_STAGES) assert.equal(PlacementCaseStageSchema.parse(stage), stage);
});

test('only confirmed closed status is exported and closeReason stays separate', () => {
  assert.equal(CLOSED_CASE_STATUS, 'CLOSED');
  assert.equal(ClosedCaseStatusSchema.parse('CLOSED'), 'CLOSED');
  for (const unknownStatus of ['ACTIVE', 'OPEN', 'CLOSED_SUCCESS', 'NO_ANSWER']) {
    reject(ClosedCaseStatusSchema, unknownStatus);
  }
});

test('closeReason exactly matches nine confirmed values and never becomes a stage', () => {
  assert.deepEqual([...CASE_CLOSE_REASONS], [
    'SUCCESS', 'NO_LONGER_LOOKING', 'UNREACHABLE', 'NO_SUITABLE_JOB',
    'CANDIDATE_WITHDREW', 'CLIENT_REJECTED', 'DUPLICATE_CASE', 'INVALID', 'OTHER',
  ]);
  for (const reason of CASE_CLOSE_REASONS) {
    assert.equal(CaseCloseReasonSchema.parse(reason), reason);
    reject(PlacementCaseStageSchema, reason);
  }
});

test('Availability is exactly the confirmed five-value axis', () => {
  assert.deepEqual([...AVAILABILITIES], [
    'AVAILABLE_NOW', 'AVAILABLE_FROM_DATE', 'NOT_AVAILABLE', 'DO_NOT_CONTACT', 'UNKNOWN',
  ]);
  for (const value of AVAILABILITIES) assert.equal(AvailabilitySchema.parse(value), value);
  reject(AvailabilitySchema, 'NO_ANSWER');
});

test('CurrentRelationship is exactly confirmed and explicitly read-only', () => {
  assert.deepEqual([...CURRENT_RELATIONSHIPS], [
    'NEVER_WORKED', 'WORKING_VIA_HRP', 'FORMER_HRP_WORKER', 'WORKING_EXTERNAL', 'UNKNOWN',
  ]);
  assert.equal(CURRENT_RELATIONSHIP_READONLY, true);
  for (const value of CURRENT_RELATIONSHIPS) assert.equal(CurrentRelationshipSchema.parse(value), value);
});

test('NextAction and matching outcomes are separate enums', () => {
  assert.deepEqual([...NEXT_ACTION_STATUSES], ['OPEN', 'DONE', 'CANCELLED']);
  assert.deepEqual([...MATCHING_OUTCOMES], ['EXACT_MATCH', 'POSSIBLE_MATCH', 'NEW_PROFILE']);
  for (const value of NEXT_ACTION_STATUSES) assert.equal(NextActionStatusSchema.parse(value), value);
  for (const value of MATCHING_OUTCOMES) assert.equal(MatchingOutcomeSchema.parse(value), value);
  reject(MatchingOutcomeSchema, 'UNRESOLVED');
});

test('all legacy/invented closed variants fail every relevant runtime schema', () => {
  for (const value of FORBIDDEN_CLOSED_VARIANTS) {
    reject(ClosedCaseStatusSchema, value);
    reject(CaseCloseReasonSchema, value);
    reject(PlacementCaseStageSchema, value);
  }
});

test('wire schema version is v1', () => assert.equal(SCHEMA_VERSION, '1'));
