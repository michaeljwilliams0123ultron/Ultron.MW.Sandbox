import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRunPlan, decideMutation, reconcileMutation, parseRunnerArgs} from '../scripts/sandbox-live-autonomy.mjs';

const SHA = 'a'.repeat(40);

test('runner accepts zero or one approved CLI flag, not the Node launcher', () => {
  assert.deepEqual(parseRunnerArgs([]), {replay:false});
  assert.deepEqual(parseRunnerArgs(['--replay']), {replay:true});
  assert.throws(() => parseRunnerArgs(['node','script.mjs']), /unknown runner argument/i);
  assert.throws(() => parseRunnerArgs(['--replay','--replay']), /unknown runner argument/i);
});
const repo = 'michaeljwilliams0123ultron/Ultron.MW.Sandbox';

test('scope is fixed to the dedicated Sandbox, branch and evidence paths', () => {
  const p = validateRunPlan({repository:repo, runId:'12345', sourceSha:SHA});
  assert.equal(p.branch, 'canary/autonomy-write-12345');
  assert.equal(p.path, 'evidence/live-autonomy/12345.json');
  assert.equal(p.repository, repo);
});

test('production repositories are rejected before any write', () => {
  assert.throws(() => validateRunPlan({repository:'michaeljwilliams0123/Ultron.MW',runId:'12345',sourceSha:SHA}), /sandbox only/i);
});

test('untrusted run identifiers and source refs are rejected', () => {
  for (const runId of ['../../main','1;rm -rf /','', 'abc']) {
    assert.throws(() => validateRunPlan({repository:repo,runId,sourceSha:SHA}));
  }
  assert.throws(() => validateRunPlan({repository:repo,runId:'12345',sourceSha:'bad'}), /source sha/i);
});

test('observed matching evidence causes no new mutation', () => {
  assert.equal(decideMutation(null, 'x'), 'write');
  assert.equal(decideMutation('x', 'x'), 'verified');
});

test('conflicting remote evidence fails closed', () => {
  assert.throws(() => decideMutation('different', 'expected'), /conflict/i);
});

test('first live write is reconciled after a lost acknowledgement', async () => {
  let remote = null;
  let writes = 0;
  const result = await reconcileMutation({
    expected:'signed-by-test',
    probe:async()=>remote,
    write:async payload => {
      writes++;
      remote = payload;
      const error = new Error('simulated lost acknowledgement after commit');
      error.retryable = true;
      throw error;
    },
    maxAttempts:3
  });
  assert.equal(result.status, 'verified');
  assert.equal(writes, 1);
  assert.equal(result.writeAttempts, 1);
  assert.equal(result.reconciledAfterError, true);
});

test('replay of completed task never duplicates the mutation', async () => {
  let writes = 0;
  const result = await reconcileMutation({
    expected:'already-committed',
    probe:async()=> 'already-committed',
    write:async()=>{writes++}
  });
  assert.equal(result.status, 'verified');
  assert.equal(writes, 0);
  assert.equal(result.writeAttempts, 0);
});

test('persistent transient failure exhausts bounded retries', async () => {
  let writes = 0;
  await assert.rejects(reconcileMutation({
    expected:'x',
    probe:async()=>null,
    write:async()=>{writes++;const e=new Error('remote 503');e.retryable=true;throw e},
    maxAttempts:3
  }), /exhausted/i);
  assert.equal(writes, 3);
});

test('nonretryable authorization failures stop immediately', async () => {
  let writes = 0;
  await assert.rejects(reconcileMutation({
    expected:'x',
    probe:async()=>null,
    write:async()=>{writes++;throw new Error('403 forbidden')},
    maxAttempts:3
  }), /403 forbidden/);
  assert.equal(writes, 1);
});

test('conflict cannot be overwritten by automated repair', async () => {
  let writes = 0;
  await assert.rejects(reconcileMutation({
    expected:'safe',
    probe:async()=> 'user-existing-content',
    write:async()=> {writes++}
  }), /conflict/i);
  assert.equal(writes, 0);
});
