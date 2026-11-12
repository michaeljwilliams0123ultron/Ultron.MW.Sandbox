import {createHash} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';

export const SANDBOX = 'michaeljwilliams0123ultron/Ultron.MW.Sandbox';
export function parseRunnerArgs(args) {
  if (!Array.isArray(args)||args.length>1||args.some(arg=>arg!=='--replay')) {
    throw new Error('unknown runner argument');
  }
  return {replay:args.length===1};
}

export function validateRunPlan({repository,runId,sourceSha}) {
  if (repository !== SANDBOX) throw new Error('sandbox only: production writes refused');
  if (!/^[0-9]{1,19}$/.test(String(runId))) throw new Error('invalid run identifier');
  if (!/^[a-f0-9]{40}$/i.test(String(sourceSha))) throw new Error('invalid source sha');
  return Object.freeze({
    repository,runId:String(runId),sourceSha:String(sourceSha),
    branch:'canary/autonomy-write-'+runId,
    path:'evidence/live-autonomy/'+runId+'.json'
  });
}
export function decideMutation(observed, expected) {
  if (observed == null) return 'write';
  if (observed === expected) return 'verified';
  throw new Error('conflict: observed evidence differs from expected; refusing overwrite');
}
export async function reconcileMutation({probe,write,expected,maxAttempts=3}) {
  if (!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>3) throw new Error('invalid retry limit');
  let writeAttempts=0, reconciledAfterError=false;
  for (let i=0;i<maxAttempts;i++) {
    if (decideMutation(await probe(),expected)==='verified') {
      return {status:'verified',writeAttempts,reconciledAfterError};
    }
    writeAttempts++;
    try {
      await write(expected);
    } catch(error) {
      if (!error?.retryable) throw error;
      reconciledAfterError=true;
      continue;
    }
    if (decideMutation(await probe(),expected)==='verified') {
      return {status:'verified',writeAttempts,reconciledAfterError};
    }
  }
  if (decideMutation(await probe(),expected)==='verified') {
    return {status:'verified',writeAttempts,reconciledAfterError};
  }
  throw new Error('exhausted: live mutation did not verify in bounded attempts');
}

async function github(method,path,token,body) {
  const res=await fetch('https://api.github.com/repos/'+SANDBOX+path,{
    method,headers:{
      'Accept':'application/vnd.github+json',
      'X-GitHub-Api-Version':'2022-11-28',
      'User-Agent':'ultron-sandbox-live-autonomy-canary',
      Authorization:'Bearer '+token,
      ...(body?{'Content-Type':'application/json'}:{})
    },...(body?{body:JSON.stringify(body)}:{})
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok){
    const error=new Error('GitHub '+method+' returned HTTP '+res.status+
      ': '+String(data.message??'unknown error').slice(0,100));
    error.status=res.status;
    error.retryable=res.status===429||res.status>=500;
    throw error;
  }
  return data;
}

async function ensureBranch(plan, token) {
  const path='/git/ref/heads/'+plan.branch;
  try {return await github('GET',path,token)}
  catch(e){if(e.status!==404)throw e}
  try{
    return await github('POST','/git/refs',token,{
      ref:'refs/heads/'+plan.branch,sha:plan.sourceSha
    });
  }catch(e) {
    if(e.status!==422)throw e;
    return await github('GET',path,token);
  }
}

async function readEvidence(plan,token) {
  const path='/contents/'+plan.path+'?ref='+encodeURIComponent(plan.branch);
  try{
    const response=await github('GET',path,token);
    if(response.encoding!=='base64'||typeof response.content!=='string') {
      throw new Error('unexpected evidence encoding');
    }
    return Buffer.from(response.content.replace(/\s/g,''),'base64').toString('utf8');
  }catch(error) {
    if(error.status===404) return null;
    throw error;
  }
}
async function runLive() {
  if(process.env.GITHUB_ACTIONS!=='true') throw new Error('GitHub Actions environment required');
  const plan=validateRunPlan({
    repository:process.env.GITHUB_REPOSITORY,
    runId:process.env.GITHUB_RUN_ID,
    sourceSha:process.env.GITHUB_SHA
  });
  const token=process.env.GITHUB_TOKEN;
  if(!token)throw new Error('GitHub token unavailable; no mutation performed');
  const {replay}=parseRunnerArgs(process.argv.slice(2));
  const expected=JSON.stringify({
    schema:'ultron.live.autonomy.sandbox.v1',
    scope:SANDBOX,
    source_sha:plan.sourceSha,
    run_id:plan.runId,
    objective:'bounded GitHub evidence mutation and dynamic reconciliation',
    zero_paid_cents:true
  },null,2)+'\n';
  await ensureBranch(plan,token);
  let acknowledgedLossInjected=false;
  const result=await reconcileMutation({
    expected,
    probe:()=>readEvidence(plan,token),
    write:async content=>{
      await github('PUT','/contents/'+plan.path,token,{
        message:'test(sandbox): live autonomy receipt '+plan.runId,
        content:Buffer.from(content).toString('base64'),
        branch:plan.branch
      });
      if(!replay&&!acknowledgedLossInjected) {
        acknowledgedLossInjected=true;
        const err=new Error('injected response-loss after successful remote commit');
        err.retryable=true;
        throw err;
      }
    }
  });
  const ref=await github('GET','/git/ref/heads/'+plan.branch,token);
  const head=ref?.object?.sha;
  if(!/^[0-9a-f]{40}$/i.test(String(head)))throw new Error('missing readback branch head');
  if(!replay&&(result.writeAttempts!==1||!result.reconciledAfterError)) {
    throw new Error('first execution did not exercise recovery path');
  }
  if(replay&&result.writeAttempts!==0)throw new Error('replay was not idempotent');
  const receipt={
    schema:'ultron.live.autonomy.receipt.v1',
    repository:plan.repository,branch:plan.branch,path:plan.path,
    run_id:plan.runId,source_sha:plan.sourceSha,branch_head:head,
    content_sha256:createHash('sha256').update(expected).digest('hex'),
    status:result.status,write_attempts:result.writeAttempts,
    recovered_after_lost_ack:result.reconciledAfterError,
    remote_readback_verified:true,
    replay,paid_inference_used:false,production_mutated:false
  };
  await mkdir('artifacts',{recursive:true});
  const name='artifacts/sandbox-live-autonomy-'+(replay?'replay':'first')+'.json';
  await writeFile(name,JSON.stringify(receipt,null,2)+'\n');
  console.log('SANDBOX_LIVE_AUTONOMY_VERIFIED '+JSON.stringify(receipt));
}
if(process.argv[1]&&import.meta.url.endsWith(
  '/'+process.argv[1].replace(/\\/g,'/').split('/').pop())) {
  runLive().catch(error=>{console.error('SANDBOX_LIVE_AUTONOMY_FAILED:',error.message);process.exitCode=1});
}
