import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import * as c from '../dist/index.js';

// Synthetic shape only, not a canonical command or G0/0.3 DTO implementation.
const fixture = c.defineCommandContract('syntheticCommand', z.object({ requestedStage: c.PlacementCaseStageSchema }), z.object({ referenceId: c.OpaqueIdSchema }));
const request = {
  schemaVersion: c.SCHEMA_VERSION, commandId: 'cmd-synthetic-1', idempotencyKey: 'submission-synthetic-1:step:1',
  correlationId: 'trace-synthetic-1', organizationId: 'org-synthetic-1',
  actor: { kind: 'USER', userId: 'user-synthetic-1' },
  source: { kind: 'HRP_UI', provider: 'HRP_UI', connectionId: null }, payload: { requestedStage: 'CONTACTING' },
};
const base = { schemaVersion: c.SCHEMA_VERSION, commandId: request.commandId, correlationId: request.correlationId };
const applied = { ...base, status: 'APPLIED', data: { referenceId: 'canonical-synthetic-1' }, errors: [] };
const accepted = { ...base, status: 'ACCEPTED', operation: { kind: 'COMMAND_OPERATION', operationId: 'operation-synthetic-1' }, errors: [] };
const failure = { ...base, status: 'FAILED', errors: [{ code: 'VALIDATION_ERROR', messageKey: 'errors.validation', retryClass: 'NEVER', fieldPath: 'payload' }] };
const rejects = (schema, input) => assert.equal(schema.safeParse(input).success, false);

test('confirmed enum sets and Vietnamese labels are complete and separate', () => {
  assert.deepEqual(c.PLACEMENT_CASE_STAGES, ['NEW','CONTACTING','QUALIFYING','MATCHING','PROPOSED','INTERESTED','CLIENT_PROCESS','READY_TO_START']);
  assert.deepEqual(c.CASE_CLOSE_REASONS, ['SUCCESS','NO_LONGER_LOOKING','UNREACHABLE','NO_SUITABLE_JOB','CANDIDATE_WITHDREW','CLIENT_REJECTED','DUPLICATE_CASE','INVALID','OTHER']);
  assert.deepEqual(c.AVAILABILITIES, ['AVAILABLE_NOW','AVAILABLE_FROM_DATE','NOT_AVAILABLE','DO_NOT_CONTACT','UNKNOWN']);
  assert.deepEqual(c.CURRENT_RELATIONSHIPS, ['NEVER_WORKED','WORKING_VIA_HRP','FORMER_HRP_WORKER','WORKING_EXTERNAL','UNKNOWN']);
  assert.deepEqual(c.NEXT_ACTION_STATUSES, ['OPEN','DONE','CANCELLED']);
  for (const [values, labels, schema] of [[c.PLACEMENT_CASE_STAGES,c.placementCaseStageLabelsVi,c.PlacementCaseStageSchema],[c.CASE_CLOSE_REASONS,c.caseCloseReasonLabelsVi,c.CaseCloseReasonSchema],[c.AVAILABILITIES,c.availabilityLabelsVi,c.AvailabilitySchema],[c.CURRENT_RELATIONSHIPS,c.currentRelationshipLabelsVi,c.CurrentRelationshipReadSchema]]) {
    assert.deepEqual(Object.keys(labels), [...values]);
    for (const value of values) assert.equal(schema.parse(value),value);
  }
  assert.equal(c.ClosedCaseStatusSchema.parse('CLOSED'),'CLOSED');
  for (const old of ['CLOSED_SUCCESS','SUCCESS_HRP_WORKFORCE','SUCCESS_DIRECT_HIRE','NO_ANSWER','OPEN']) rejects(c.ClosedCaseStatusSchema,old);
  for (const reason of c.CASE_CLOSE_REASONS) rejects(c.PlacementCaseStageSchema,reason);
  rejects(c.AvailabilitySchema,'NO_ANSWER');
  rejects(c.IdentityMatchOutcomeSchema,'UNRESOLVED');
  rejects(c.ExternalContactMatchStateSchema,'NEW_PROFILE');
  for (const value of ['EXACT_MATCH','POSSIBLE_MATCH','NEW_PROFILE']) c.IdentityMatchOutcomeSchema.parse(value);
  for (const value of ['EXACT_MATCH','POSSIBLE_MATCH','UNRESOLVED']) c.ExternalContactMatchStateSchema.parse(value);
});

test('IDs and calendar/timestamp versions validate bounds without UUID assumptions', () => {
  for (const id of ['synthetic-cuid_1','123','a'.repeat(128)]) c.OpaqueIdSchema.parse(id);
  for (const bad of ['', ' a', 'a/b','a\n','a'.repeat(129),42]) rejects(c.OpaqueIdSchema,bad);
  rejects(c.IdempotencyKeySchema,'a'.repeat(257));
  for (const bad of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'1',Infinity]) rejects(c.EntityVersionSchema,bad);
  c.EntityVersionSchema.parse(0);
  c.UtcTimestampSchema.parse('2024-02-29T12:30:00.000Z');
  for (const bad of ['2026-02-29T12:30:00.000Z','2026-04-31T00:00:00.000Z','2026-09-13T24:00:00.000Z','2026-09-13T00:00:00+07:00','yesterday']) rejects(c.UtcTimestampSchema,bad);
  c.CalendarDateSchema.parse('2024-02-29');
  for (const bad of ['2026-02-29','2026-04-31','2026-13-01','2026-1-01']) rejects(c.CalendarDateSchema,bad);
});

test('USER/SERVICE/delegated claims and explicit HRP UI source are shape-checked only', () => {
  fixture.request.parse(request);
  for (const actor of [{kind:'SERVICE',serviceId:'service-synthetic-1'},{kind:'DELEGATED_USER',serviceId:'service-synthetic-1',userId:'user-synthetic-1',delegationRef:'delegation-synthetic-1'}]) fixture.request.parse({...request,actor});
  fixture.request.parse({...request,source:{kind:'INTEGRATION',provider:'CHATWOOT',connectionId:'connection-synthetic-1'}});
  for (const actor of [{kind:'USER'},{kind:'USER',userId:'u',serviceId:'s'},{kind:'SERVICE',userId:'u'},{kind:'DELEGATED_USER',serviceId:'s',userId:'u'},{kind:'ADMIN',userId:'u'},{kind:'USER',userId:'u',verified:true}]) rejects(fixture.request,{...request,actor});
  for (const source of [{kind:'HRP_UI',provider:'ZALO_OA',connectionId:null},{kind:'HRP_UI',provider:'HRP_UI',connectionId:'fake'},{kind:'INTEGRATION',provider:'CHATWOOT',connectionId:null},{kind:'INTEGRATION',provider:'UNKNOWN',connectionId:'c'},{kind:'INTEGRATION',provider:'ZALO_OA'},{system:'HRP_ENGAGEMENT',connectionId:'c'}]) rejects(fixture.request,{...request,source});
});

test('unknown versions/fields and prohibited relationship mutation are rejected', () => {
  rejects(fixture.request,{...request,schemaVersion:'1'});
  rejects(fixture.request,{...request,commandName:'mergeLaborProfiles'});
  rejects(fixture.request,{...request,payload:{requestedStage:'CLOSED_SUCCESS'}});
  for (const field of ['currentRelationship','CurrentRelationship','rawTranscript','arbitraryPatch']) rejects(fixture.request,{...request,payload:{...request.payload,[field]:'synthetic'}});
  assert.throws(() => c.defineCommandContract('syntheticCommand',z.object({currentRelationship:c.CurrentRelationshipReadSchema}),z.object({})),/read-only/);
  assert.throws(() => c.defineCommandContract('syntheticCommand',z.object({CurrentRelationship:c.CurrentRelationshipReadSchema}),z.object({})),/read-only/);
});

test('ACCEPTED/APPLIED/FAILED discriminate durable reference vs canonical data vs errors', () => {
  for (const good of [accepted,applied,failure]) fixture.response.parse(good);
  fixture.operationQuery.parse({schemaVersion:c.SCHEMA_VERSION,organizationId:request.organizationId,commandId:request.commandId,operationId:accepted.operation.operationId,actor:request.actor});
  for (const bad of [{...accepted,data:applied.data},{...accepted,operation:undefined},{...accepted,applied:true},{...accepted,errors:failure.errors},{...applied,data:{}},{...applied,data:{referenceId:'id',approved:true}},{...applied,errors:failure.errors},{...applied,operation:accepted.operation},{...failure,data:applied.data},{...failure,errors:[]},{...failure,operation:accepted.operation},{...applied,status:'DELIVERED'},{...applied,schemaVersion:'unknown'}]) rejects(fixture.response,bad);
  rejects(fixture.operationQuery,{schemaVersion:c.SCHEMA_VERSION,organizationId:'org',commandId:'cmd',actor:request.actor});
});

test('error taxonomy binds retry/message to code and exports only safe diagnostic shape', () => {
  for (const [code,policy] of Object.entries(c.ERROR_POLICIES)) {
    c.ContractErrorSchema.parse({code,...policy});
    assert.equal(typeof c.errorMessagesVi[policy.messageKey],'string');
    rejects(c.ContractErrorSchema,{code,...policy,retryClass:'ALWAYS'});
  }
  const error=failure.errors[0];
  for (const field of ['stack','sql','providerBody','message','secret','details']) rejects(c.ContractErrorSchema,{...error,[field]:'synthetic-sensitive-marker'});
  for (const fieldPath of ['payload.synthetic-sensitive-marker','payload[123]','unknown']) rejects(c.ContractErrorSchema,{...error,fieldPath});
  rejects(c.ContractErrorSchema,{...error,messageKey:'synthetic-sensitive-marker'});
  rejects(c.ContractErrorSchema,{...error,retryClass:'BOUNDED_SAME_KEY'});
  const safe=c.validateContract(fixture.request,{...request,schemaVersion:'synthetic-sensitive-marker',secret:'synthetic-sensitive-marker'});
  assert.equal(safe.success,false);
  assert.equal(JSON.stringify(safe).includes('synthetic-sensitive-marker'),false);
});
