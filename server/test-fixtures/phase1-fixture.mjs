// Synthetic acceptance helpers. All identities, credentials and files are disposable.
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
export const secret=()=>randomBytes(24).toString("base64url");
export async function startFixture(root,{compiled=false,host="127.0.0.1",sample=false,proxy=false}={}) {
  if (!resolve(root).startsWith(resolve(tmpdir())+sep)) throw new Error("Fixture root must be a new owned temporary directory");
  const reserve=createServer();reserve.listen(0,host);await once(reserve,"listening");
  const port=reserve.address().port;await new Promise(done=>reserve.close(done));
  let output="";
  const child=fork(join(repo,"server/test-fixtures/authority-server.mjs"),[...(compiled?["--compiled"]:[]),...(sample?["--sample-data"]:[])],{
    cwd:repo,execArgv:compiled?[]:["--import","tsx"],windowsHide:true,
    env:{...process.env,ATOM_ROOT:root,PORT:String(port),ATOM_HOST:host,ATOM_BEHIND_PROXY:String(proxy),ATOM_DEVELOPMENT_PREVIEW:"false",ATOM_HTTPS:"false",ATOM_ALLOWED_ORIGINS:""},stdio:["ignore","pipe","pipe","ipc"]});
  child.stdout.on("data",chunk=>{output+=chunk;});child.stderr.on("data",chunk=>{output+=chunk;});
  const base=`http://127.0.0.1:${port}`;
  for(let i=0;;i++){
    try{if((await fetch(base+"/api/health")).ok)break;}catch{}
    if(i>=150||child.exitCode!==null)throw new Error("Owned Phase 1 server did not start");
    await new Promise(done=>setTimeout(done,100));
  }
  return {child,base,port,logs:()=>output};
}
export async function stopFixture(server) {
  if(server?.child.exitCode===null){const done=once(server.child,"exit");server.child.send("stop");await done;}
}
export function client(base) {
  return {cookie:"",async send(path,body,method=body===undefined?"GET":"POST",headers={}){
    const response=await fetch(base+path,{method,headers:{...(this.cookie?{cookie:this.cookie}:{}),...(body!==undefined&&!(body instanceof FormData)?{"content-type":"application/json"}:{}),...headers},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});
    if(response.headers.get("set-cookie"))this.cookie=response.headers.get("set-cookie").split(";")[0];
    const bytes=Buffer.from(await response.arrayBuffer());let data;try{data=JSON.parse(bytes.toString());}catch{}
    return {status:response.status,data,bytes,headers:response.headers};
  },async ok(path,body,method,headers){const r=await this.send(path,body,method,headers);assert.ok(r.status>=200&&r.status<300,`${method??"request"} ${path}: ${r.status} ${r.data?.code??""}`);return r.data;}};
}
export async function activate(base,handoff) {
  const account=client(base),password=secret();
  await account.ok("/api/auth/login",{identifier:handoff.identifier,password:handoff.temporaryPassword});
  await account.ok("/api/auth/change-password",{currentPassword:handoff.temporaryPassword,newPassword:password});
  return {account,password,identifier:handoff.identifier};
}
export async function createClass(base) {
  const owner=client(base),ownerPassword=secret();
  const initialized=await owner.ok("/api/setup",{displayName:"Synthetic Owner",username:"fixture-owner",password:ownerPassword});
  const prefix="/api/academic-setup";
  const faculty={};
  for(const name of ["lab-a","lab-b","lecture","manager","outside"]){
    const user=await owner.ok(prefix+"/faculty",{displayName:`Synthetic ${name}`,username:`fixture-${name}`});
    const handoff=await owner.ok(prefix+`/accounts/${user.id}/activation`,{});
    faculty[name]={...user,...await activate(base,handoff)};
  }
  const course=await owner.ok(prefix+"/courses",{code:"PILOT-NEW",title:"Synthetic Course Setup"});
  const term=await owner.ok(prefix+"/terms",{label:"Synthetic term 2030"});
  let offering=await owner.ok(prefix+"/offerings",{courseId:course.id,termId:term.id,label:"Synthetic new offering",requiredComponents:["lecture","laboratory"]});
  const groups=[{id:randomUUID(),label:"Lecture L",componentKind:"lecture",facultyIds:[faculty.lecture.id]},{id:randomUUID(),label:"Lab A",componentKind:"laboratory",facultyIds:[faculty["lab-a"].id]},{id:randomUUID(),label:"Lab B",componentKind:"laboratory",facultyIds:[faculty["lab-b"].id]}];
  offering=await owner.ok(prefix+`/offerings/${offering.id}/structure`,{groups,links:[{lectureId:groups[0].id,laboratoryId:groups[1].id},{lectureId:groups[0].id,laboratoryId:groups[2].id}],requiredComponents:["lecture","laboratory"],expectedRevision:offering.revision},"PUT");
  await owner.ok(prefix+`/offerings/${offering.id}/managers`,{facultyId:faculty.manager.id});
  const rows=[{studentNumber:"000001",displayName:"Synthetic Student A",groupIds:[groups[0].id,groups[1].id]},{studentNumber:"000002",displayName:"Synthetic Student B",groupIds:[groups[0].id,groups[2].id]},{studentNumber:"000003",displayName:"Synthetic Unclaimed Student",groupIds:[groups[0].id,groups[1].id]}];
  const preview=await owner.ok(prefix+`/offerings/${offering.id}/roster/preview`,{rows});
  const applied=await owner.ok(prefix+`/offerings/${offering.id}/roster/apply`,{rows,previewToken:preview.previewToken,requestKey:randomUUID()});
  offering=await owner.ok(prefix+`/offerings/${offering.id}`);
  offering=await owner.ok(prefix+`/offerings/${offering.id}/ready`,{expectedRevision:offering.revision});
  return {owner,ownerId:initialized.currentUser.id,ownerPassword,faculty,course,term,offering,groups,studentIds:applied.studentIds};
}
export async function runClassWorkflow(base,fixture) {
  const {owner,faculty,offering,groups,studentIds}=fixture;
  const evidence=[];
  for(const [index,name] of ["lab-a","lab-b"].entries()) {
    const teacher=faculty[name].account;
    const activity=await teacher.ok("/api/activities",{subjectOfferingId:offering.id,gradingPeriod:"midterm",teachingGroupIds:[groups[index+1].id],title:`Synthetic ${name} activity`,instructions:"Submit one Python source file.",requirements:[],opensAt:new Date(Date.now()-60000).toISOString(),deadlineAt:new Date(Date.now()+86400000).toISOString(),acceptedExtensions:[".py"],maxBytes:1048576});
    const material=new FormData();material.set("file",new Blob([`Synthetic ${name} material`]),"instructions.txt");
    const asset=await teacher.ok(`/api/activities/${activity.id}/assets`,material);
    await teacher.ok(`/api/activities/${activity.id}/publish`,{expectedDraftRevision:activity.draftRevision});
    const handoff=await owner.ok(`/api/academic-setup/accounts/${studentIds[index]}/activation`,{});
    const student=await activate(base,handoff);
    const upload=new FormData();upload.set("file",new Blob([`# synthetic ${name} submission\n`]),"solution.py");
    const submitted=await student.account.ok(`/api/activities/${activity.id}/submissions`,upload);
    const submission=submitted.currentSubmission;
    const other=faculty[index===0?"lab-b":"lab-a"].account;
    for(const denied of [other,faculty.lecture.account,faculty.manager.account,owner]) {
      assert.equal((await denied.send(`/api/submissions/${submission.id}/file`)).status,404);
      assert.ok([403,404].includes((await denied.send(`/api/submissions/${submission.id}/evaluation`,{score:8})).status));
    }
    await teacher.ok(`/api/submissions/${submission.id}/evaluation`,{score:8,manualDeduction:1,comments:"Synthetic provisional evaluation"});
    assert.equal((await teacher.send(`/api/submissions/${submission.id}/file`)).status,200);
    assert.equal((await student.account.send(`/api/submissions/${submission.id}/file`)).status,200);
    evidence.push({activity,asset,submission,student,teacher:name});
  }
  await owner.ok(`/api/academic-setup/accounts/${studentIds[2]}/activation`,{});
  return evidence;
}
