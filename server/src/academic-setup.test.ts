import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { startFixture, stopFixture, client, createClass, activate, runClassWorkflow, secret } from "../test-fixtures/phase1-fixture.mjs";

type Any = any;
const P="/api/academic-setup";
let root:string,server:Any,db:DatabaseSync,fixture:Any,evidence:Any;
const tables=["courses","subjects","academic_terms","subject_offerings","users","teaching_groups","faculty_group_assignments","offering_setup_managers","installation_owners","enrollments","student_group_placements","group_associations","roster_batches","auth_credentials","managed_accounts","activities","activity_releases","activity_release_scopes","activity_assets","activity_release_assets","submissions","evaluations"];
function snapshot() {
  const files=(path:string):Any[]=>readdirSync(path).filter(n=>!n.startsWith("atom.sqlite")).flatMap(n=>{const p=join(path,n);return statSync(p).isDirectory()?files(p):[[p,createHash("sha256").update(readFileSync(p)).digest("hex")]];});
  return createHash("sha256").update(JSON.stringify({tables:tables.map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()),files:files(join(root,"data"))})).digest("hex");
}
const detail=()=>fixture.owner.ok(`${P}/offerings/${fixture.offering.id}`);
const structure=(d:Any,override:Any={})=>({groups:d.groups,links:d.links,requiredComponents:d.requiredComponents,expectedRevision:d.revision,...override});
async function denied(actor:Any,path:string,body?:Any,method?:string,code?:string) {
  const before=snapshot(),result=await actor.send(path,body,method);
  expect([400,401,403,404,409]).toContain(result.status);
  if(code)expect(result.data.code).toBe(code);
  expect(snapshot()).toBe(before);
  return result;
}
async function newOffering() {
  const code=`TEST-${randomUUID().slice(0,8)}`;
  const course=await fixture.owner.ok(P+"/courses",{code,title:"Synthetic additional course"});
  return fixture.owner.ok(P+"/offerings",{courseId:course.id,termId:fixture.term.id,label:code,requiredComponents:["lecture"]});
}
beforeAll(async()=>{
  root=mkdtempSync(join(tmpdir(),"atom-phase1-tests-"));
  server=await startFixture(root);db=new DatabaseSync(join(root,"data/atom.sqlite"));db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000");
  fixture=await createClass(server.base);
},40000);
afterAll(async()=>{await stopFixture(server);db?.close();if(root&&resolve(root).startsWith(resolve(tmpdir())+sep)&&root.includes("atom-phase1-tests-"))rmSync(root,{recursive:true,force:true});},15000);

describe.sequential("real-course setup through supported HTTP paths",()=>{
  it("starts without sample identities or academic data and creates a distinct owner",()=>{
    expect(db.prepare("SELECT 1 FROM users WHERE id LIKE 'user-%-demo'").get()).toBeUndefined();
    expect(db.prepare("SELECT COUNT(*) n FROM installation_owners").get()!.n).toBe(1);
    expect(db.prepare("SELECT COUNT(*) n FROM courses").get()!.n).toBe(1);
    expect(db.prepare("SELECT COUNT(*) n FROM faculty_group_assignments WHERE faculty_id=?").get(fixture.ownerId)!.n).toBe(0);
  });
  it.each(["anonymous","outside","lab-a"])("denies %s direct setup without academic or file mutation",async(name)=>{
    const actor=name==="anonymous"?client(server.base):fixture.faculty[name].account;
    await denied(actor,`${P}/offerings/${fixture.offering.id}/structure`,structure(await detail()),"PUT");
    expect((await actor.send(`${P}/offerings/${fixture.offering.id}`)).status).toBe(name==="anonymous"?401:403);
  });
  it("bounds manager scope, catalog writes and grants; management is not instruction",async()=>{
    const manager=fixture.faculty.manager.account,other=await newOffering();
    expect((await manager.send(`${P}/offerings/${fixture.offering.id}`)).status).toBe(200);
    await denied(manager,`${P}/offerings/${other.id}/structure`,{groups:[],links:[]},"PUT");
    await denied(manager,P+"/courses",{code:"DENIED",title:"Denied"});
    await denied(manager,`${P}/offerings/${fixture.offering.id}/managers`,{facultyId:fixture.faculty.outside.id});
    const bootstrap=await manager.ok("/api/bootstrap");
    expect(bootstrap.academicTerms.flatMap((t:Any)=>t.offerings).map((o:Any)=>o.id)).toEqual([fixture.offering.id]);
    expect(bootstrap.academicTerms[0].offerings[0].setupOnly).toBe(true);
  });
  it("preserves leading zeros and makes readiness independent of activation",async()=>{
    const d=await detail();expect(d.roster[0].studentNumber).toBe("000001");
    expect(d.roster.every((r:Any)=>r.activationState==="not_issued")).toBe(true);
    expect(d.state).toBe("ready");expect(d.issues).toEqual([]);
    expect(d.courseId).toBe(fixture.course.id);
    expect(db.prepare("SELECT legacy_subject_id FROM subject_offerings WHERE id=?").get(d.id)!.legacy_subject_id).not.toBe("subject-itcc47-demo");
  });
  it("rejects duplicate course, term and offering rather than merging",async()=>{
    await denied(fixture.owner,P+"/courses",{code:"pilot-new",title:"Conflicting title"});
    await denied(fixture.owner,P+"/terms",{label:" synthetic TERM 2030 "});
    await denied(fixture.owner,P+"/offerings",{courseId:fixture.course.id,termId:fixture.term.id,label:"Duplicate",requiredComponents:["lecture"]});
    expect(()=>db.prepare("INSERT INTO courses VALUES (?,?,?)").run(randomUUID(),"pilot-new","Duplicate")).toThrow();
    expect(()=>db.prepare("INSERT INTO subject_offerings(id,academic_term_id,subject_code,subject_title,course_id) VALUES (?,?,?,?,?)").run(randomUUID(),fixture.term.id,"Alternate code","Duplicate",fixture.course.id)).toThrow();
  });
  it("permits optional multi-lecture links and standalone combined groups without implied placement",async()=>{
    let d=await newOffering();
    const groups=[{id:randomUUID(),label:"L1",componentKind:"lecture",facultyIds:[fixture.faculty.lecture.id]},{id:randomUUID(),label:"L2",componentKind:"lecture",facultyIds:[fixture.faculty.lecture.id]},{id:randomUUID(),label:"Lab",componentKind:"laboratory",facultyIds:[fixture.faculty["lab-a"].id]},{id:randomUUID(),label:"Standalone",componentKind:"combined",facultyIds:[fixture.faculty["lab-b"].id]}];
    d=await fixture.owner.ok(`${P}/offerings/${d.id}/structure`,structure(d,{groups,links:[{lectureId:groups[0].id,laboratoryId:groups[2].id},{lectureId:groups[1].id,laboratoryId:groups[2].id}]}),"PUT");
    expect(d.groups).toHaveLength(4);expect(d.links).toHaveLength(2);expect(d.roster).toHaveLength(0);
    await denied(fixture.owner,`${P}/offerings/${d.id}/structure`,structure(d,{links:[...d.links,d.links[0]]}),"PUT");
  });
  it("rejects cross-offering placements and links through API and persistence",async()=>{
    const other=await newOffering(),d=await detail();
    await denied(fixture.owner,`${P}/offerings/${other.id}/structure`,structure(other,{groups:d.groups,links:d.links}),"PUT");
    const enrollment=d.roster[0].enrollmentId,group=randomUUID();
    db.prepare("INSERT INTO teaching_groups VALUES (?,?,?,'Adversarial',0)").run(group,other.id,"lecture");
    expect(()=>db.prepare("INSERT INTO student_group_placements VALUES (?,?)").run(enrollment,group)).toThrow("placement_offering_mismatch");
    expect(()=>db.prepare("UPDATE student_group_placements SET teaching_group_id=? WHERE enrollment_id=?").run(group,enrollment)).toThrow();
    expect(()=>db.prepare("UPDATE enrollments SET subject_offering_id=? WHERE id=?").run(other.id,enrollment)).toThrow();
    expect(()=>db.prepare("UPDATE teaching_groups SET subject_offering_id=? WHERE id=?").run(other.id,d.groups[0].id)).toThrow();
    expect(()=>db.prepare("INSERT INTO group_associations VALUES (?,?,?)").run(other.id,group,d.groups[1].id)).toThrow("association_scope_mismatch");
    expect(()=>db.prepare("INSERT INTO group_associations VALUES (?,?,?)").run(d.id,d.groups[1].id,d.groups[0].id)).toThrow();
    await denied(fixture.owner,`${P}/offerings/${d.id}/enrollments/${enrollment}`,{groupIds:[group],status:"active",expectedRevision:d.revision},"PUT");
  });
  it.each(["duplicate","conflicting name","unknown group","missing component"])("previews %s as rejected and leaves academic data unchanged",async(kind)=>{
    const row={studentNumber:"000099",displayName:"Synthetic Preview",groupIds:[fixture.groups[0].id,fixture.groups[1].id]},rows:Any[]=[row];
    if(kind==="duplicate")rows.push({...row});
    if(kind==="conflicting name")row.studentNumber="000001";
    if(kind==="unknown group")row.groupIds=["unknown"];
    if(kind==="missing component")row.groupIds=[fixture.groups[0].id];
    const before=snapshot(),p=await fixture.owner.ok(`${P}/offerings/${fixture.offering.id}/roster/preview`,{rows});
    expect(p.canApply).toBe(false);expect(snapshot()).toBe(before);
    await denied(fixture.owner,`${P}/offerings/${fixture.offering.id}/roster/apply`,{rows,previewToken:p.previewToken,requestKey:randomUUID()});
  });
  it("requires explicit exact identity reuse and preserves existing names/credentials",async()=>{
    let d=await newOffering();const g={id:randomUUID(),label:"Lecture",componentKind:"lecture",facultyIds:[fixture.faculty.lecture.id]};
    d=await fixture.owner.ok(`${P}/offerings/${d.id}/structure`,structure(d,{groups:[g],links:[]}),"PUT");
    const existing=db.prepare("SELECT * FROM users WHERE id=?").get(fixture.studentIds[0]);
    const row={studentNumber:"000001",displayName:"Synthetic Student A",groupIds:[g.id],reuseUserId:undefined as string|undefined};
    let preview=await fixture.owner.ok(`${P}/offerings/${d.id}/roster/preview`,{rows:[row]});expect(preview.canApply).toBe(false);
    row.reuseUserId=fixture.studentIds[0];preview=await fixture.owner.ok(`${P}/offerings/${d.id}/roster/preview`,{rows:[row]});expect(preview.canApply).toBe(true);
    await fixture.owner.ok(`${P}/offerings/${d.id}/roster/apply`,{rows:[row],previewToken:preview.previewToken,requestKey:randomUUID()});
    expect(db.prepare("SELECT * FROM users WHERE id=?").get(fixture.studentIds[0])).toEqual(existing);
    expect(db.prepare("SELECT 1 FROM auth_credentials WHERE user_id=?").get(fixture.studentIds[0])).toBeUndefined();
  });
  it("applies once under repeated/concurrent retry, rejects changed payload, issues no credentials",async()=>{
    const rows=[{studentNumber:"000088",displayName:"Synthetic Retry",groupIds:[fixture.groups[0].id,fixture.groups[1].id]}];
    const preview=await fixture.owner.ok(`${P}/offerings/${fixture.offering.id}/roster/preview`,{rows});
    const body={rows,previewToken:preview.previewToken,requestKey:randomUUID()};
    const results=await Promise.all([fixture.owner.send(`${P}/offerings/${fixture.offering.id}/roster/apply`,body),fixture.owner.send(`${P}/offerings/${fixture.offering.id}/roster/apply`,body)]);
    expect(results.map(r=>r.status)).toEqual([200,200]);expect(results.filter(r=>r.data.replayed)).toHaveLength(1);
    expect(db.prepare("SELECT COUNT(*) n FROM users WHERE student_number='000088'").get()!.n).toBe(1);
    expect(db.prepare("SELECT 1 FROM auth_credentials c JOIN users u ON u.id=c.user_id WHERE u.student_number='000088'").get()).toBeUndefined();
    await denied(fixture.owner,`${P}/offerings/${fixture.offering.id}/roster/apply`,{...body,rows:[]},undefined,"batch_key_conflict");
  });
  it("rejects a stale preview after configuration change",async()=>{
    const rows=[{studentNumber:"000077",displayName:"Synthetic Stale",groupIds:[fixture.groups[0].id,fixture.groups[1].id]}];
    const p=await fixture.owner.ok(`${P}/offerings/${fixture.offering.id}/roster/preview`,{rows});
    const d=await detail();await fixture.owner.ok(`${P}/offerings/${d.id}/description`,{label:d.label,expectedRevision:d.revision},"PATCH");
    await denied(fixture.owner,`${P}/offerings/${d.id}/roster/apply`,{rows,previewToken:p.previewToken,requestKey:randomUUID()},undefined,"roster_preview_stale");
  });
  it("rolls back the entire roster on an intentional persistence failure",async()=>{
    const rows=["000066","000067"].map(studentNumber=>({studentNumber,displayName:"Synthetic atomic row",groupIds:[fixture.groups[0].id,fixture.groups[1].id]}));
    const p=await fixture.owner.ok(`${P}/offerings/${fixture.offering.id}/roster/preview`,{rows});
    db.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON users WHEN NEW.student_number='000067' BEGIN SELECT RAISE(ABORT,'fixture_constraint_failure'); END");
    try{await denied(fixture.owner,`${P}/offerings/${fixture.offering.id}/roster/apply`,{rows,previewToken:p.previewToken,requestKey:randomUUID()});}
    finally{db.exec("DROP TRIGGER fixture_failure");}
    expect(db.prepare("SELECT 1 FROM users WHERE student_number='000066'").get()).toBeUndefined();
  });
  it("rejects unprivileged activation and exposes no secret in ordinary setup responses",async()=>{
    await denied(fixture.faculty.outside.account,`${P}/accounts/${fixture.studentIds[0]}/activation`,{offeringId:fixture.offering.id});
    expect(JSON.stringify(await detail())).not.toMatch(/password_hash|password_salt|temporaryPassword|token_hash/);
  });
  it("forces password change, consumes activation once, and rejects student setup calls",async()=>{
    const id=fixture.studentIds[2],handoff=await fixture.owner.ok(`${P}/accounts/${id}/activation`,{});
    const student=client(server.base);const login=await student.ok("/api/auth/login",{identifier:handoff.identifier,password:handoff.temporaryPassword});
    expect(login.mustChangePassword).toBe(true);expect((await student.send("/api/bootstrap")).status).toBe(403);
    expect((await client(server.base).send("/api/auth/login",{identifier:handoff.identifier,password:handoff.temporaryPassword})).status).toBe(401);
    await student.ok("/api/auth/change-password",{currentPassword:handoff.temporaryPassword,newPassword:secret()});
    expect((await student.send("/api/bootstrap")).status).toBe(200);
    await denied(student,`${P}/offerings/${fixture.offering.id}/structure`,structure(await detail()),"PUT");
    expect((await client(server.base).send("/api/auth/login",{identifier:handoff.identifier,password:handoff.temporaryPassword})).status).toBe(401);
  });
  it("allows only one simultaneous claim of a single-use activation",async()=>{
    const handoff=await fixture.owner.ok(`${P}/accounts/${fixture.studentIds[2]}/activation`,{});
    const contenders=[client(server.base),client(server.base)];
    const results=await Promise.all(contenders.map(c=>c.send("/api/auth/login",{identifier:handoff.identifier,password:handoff.temporaryPassword})));
    expect(results.map(r=>r.status).sort()).toEqual([200,401]);
    const winner=contenders[results.findIndex(r=>r.status===200)];
    await winner.ok("/api/auth/change-password",{currentPassword:handoff.temporaryPassword,newPassword:secret()});
    expect((await winner.send("/api/bootstrap")).status).toBe(200);
  });
  it("rejects malformed nested configuration and roster rows without mutation",async()=>{
    const d=await detail();
    await denied(fixture.owner,`${P}/offerings/${d.id}/structure`,structure(d,{groups:[null]}),"PUT");
    await denied(fixture.owner,`${P}/offerings/${d.id}/structure`,structure(d,{links:[null]}),"PUT");
    await denied(fixture.owner,`${P}/offerings/${d.id}/roster/preview`,{rows:[null]});
    await denied(fixture.owner,P+"/courses",[]);
  });
  it("enforces activation expiry and reissue revokes prior secrets and sessions",async()=>{
    const id=fixture.studentIds[2],first=await fixture.owner.ok(`${P}/accounts/${id}/activation`,{});
    db.prepare("UPDATE managed_accounts SET activation_expires_at=? WHERE user_id=?").run(new Date(Date.now()-1).toISOString(),id);
    expect((await client(server.base).send("/api/auth/login",{identifier:first.identifier,password:first.temporaryPassword})).data.code).toBe("activation_expired");
    const second=await fixture.owner.ok(`${P}/accounts/${id}/activation`,{}),student=client(server.base);
    await student.ok("/api/auth/login",{identifier:second.identifier,password:second.temporaryPassword});
    const third=await fixture.owner.ok(`${P}/accounts/${id}/activation`,{});
    expect((await student.send("/api/auth/session")).data.authenticated).toBe(false);
    expect((await client(server.base).send("/api/auth/login",{identifier:second.identifier,password:second.temporaryPassword})).status).toBe(401);
    expect(server.logs().includes(third.temporaryPassword)).toBe(false);
    expect((await fixture.owner.send(`${P}/accounts/${id}/activation`,{})).headers.get("cache-control")).toBe("no-store");
  });
  it("rejects publication until setup review and still requires every instructional destination",async()=>{
    const teacher=fixture.faculty["lab-a"].account;
    const a=await teacher.ok("/api/activities",{subjectOfferingId:fixture.offering.id,gradingPeriod:"midterm",teachingGroupIds:[fixture.groups[1].id],title:"Synthetic draft readiness",instructions:"Check",requirements:[],opensAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+86400000).toISOString(),acceptedExtensions:[".py"],maxBytes:1048576});
    await denied(teacher,`/api/activities/${a.id}/publish`,{expectedDraftRevision:1},undefined,"setup_not_ready");
    await denied(teacher,"/api/activities",{subjectOfferingId:fixture.offering.id,gradingPeriod:"midterm",teachingGroupIds:[fixture.groups[1].id,fixture.groups[2].id],title:"Unauthorized shared",instructions:"Check",requirements:[],opensAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+86400000).toISOString(),acceptedExtensions:[".py"],maxBytes:1048576});
    const d=await detail();await fixture.owner.ok(`${P}/offerings/${d.id}/ready`,{expectedRevision:d.revision});
  });
  it("runs two new lab accounts through author, publish, activation, submit and scoped provisional evaluation",async()=>{
    evidence=await runClassWorkflow(server.base,fixture);expect(evidence).toHaveLength(2);
    expect((await detail()).lockedAt).toBeTruthy();
    for(const e of evidence){const teacher=fixture.faculty[e.teacher].account;const d=await teacher.ok(`/api/activities/${e.activity.id}?subjectOfferingId=${fixture.offering.id}&teachingGroupId=all&gradingPeriod=midterm`);expect(d.submissions).toHaveLength(1);expect(d.submissions[0].evaluation.score).toBe(8);}
  },20000);
  it.each(["structure","placement","deactivation","reactivation","grant","preview","batch"])("freezes %s even for owner and rejects without changes",async(kind)=>{
    const d=await detail(),path=`${P}/offerings/${d.id}`;
    if(kind==="structure")await denied(fixture.owner,path+"/structure",structure(d,{groups:d.groups.map((g:Any)=>({...g,facultyIds:[fixture.ownerId]}))}),"PUT","configuration_locked");
    else if(["placement","deactivation","reactivation"].includes(kind))await denied(fixture.owner,path+`/enrollments/${d.roster[0].enrollmentId}`,{groupIds:[fixture.groups[2].id],status:kind==="deactivation"?"inactive":"active",expectedRevision:d.revision},"PUT","configuration_locked");
    else if(kind==="grant")await denied(fixture.owner,path+"/managers",{facultyId:fixture.faculty.outside.id},undefined,"configuration_locked");
    else await denied(fixture.owner,path+`/roster/${kind==="preview"?"preview":"apply"}`,{rows:[{studentNumber:"999",displayName:"Denied late enrollment",groupIds:[fixture.groups[0].id,fixture.groups[1].id]}],requestKey:randomUUID(),previewToken:"stale"},undefined,"configuration_locked");
  });
  it("unpublish and retarget never unlock setup; security recovery and safe labels still work",async()=>{
    const before=(await detail()).lockedAt,e=evidence[0],teacher=fixture.faculty[e.teacher].account;
    await teacher.ok(`/api/activities/${e.activity.id}/unpublish`,{});
    const d=await detail();expect(d.lockedAt).toBe(before);
    await denied(fixture.faculty.manager.account,`${P}/offerings/${d.id}/structure`,structure(d),"PUT","configuration_locked");
    await fixture.owner.ok(`${P}/offerings/${d.id}/description`,{label:"Synthetic safe display edit",expectedRevision:d.revision},"PATCH");
    const reset=await teacher.ok(`/api/subject-offerings/${d.id}/students/${fixture.studentIds[0]}/reset-password`,{});
    expect(reset.temporaryPassword===reset.identifier).toBe(false);
    expect((await client(server.base).send("/api/auth/login",{identifier:reset.identifier,password:reset.identifier})).status).toBe(401);
    expect((await detail()).lockedAt).toBe(before);
    expect(()=>db.prepare("UPDATE subject_offerings SET configuration_locked_at=NULL WHERE id=?").run(d.id)).toThrow("configuration_locked");
    await fixture.owner.ok(`${P}/accounts/${fixture.faculty.outside.id}/revoke-sessions`,{});
    expect((await fixture.faculty.outside.account.send("/api/auth/session")).data.authenticated).toBe(false);
  });
  it("serializes first publication against a stale setup write without broadening a published roster",async()=>{
    let d=await newOffering();const group={id:randomUUID(),label:"Race lecture",componentKind:"lecture",facultyIds:[fixture.faculty.lecture.id]};
    d=await fixture.owner.ok(`${P}/offerings/${d.id}/structure`,structure(d,{groups:[group],links:[]}),"PUT");
    const rows=[{studentNumber:"000001",displayName:"Synthetic Student A",groupIds:[group.id],reuseUserId:fixture.studentIds[0]}];
    const p=await fixture.owner.ok(`${P}/offerings/${d.id}/roster/preview`,{rows});await fixture.owner.ok(`${P}/offerings/${d.id}/roster/apply`,{rows,previewToken:p.previewToken,requestKey:randomUUID()});
    d=await fixture.owner.ok(`${P}/offerings/${d.id}`);d=await fixture.owner.ok(`${P}/offerings/${d.id}/ready`,{expectedRevision:d.revision});
    const teacher=fixture.faculty.lecture.account;
    const a=await teacher.ok("/api/activities",{subjectOfferingId:d.id,gradingPeriod:"midterm",teachingGroupIds:[group.id],title:"Race activity",instructions:"Check",requirements:[],opensAt:new Date().toISOString(),deadlineAt:new Date(Date.now()+86400000).toISOString(),acceptedExtensions:[".py"],maxBytes:1048576});
    const results=await Promise.all([teacher.send(`/api/activities/${a.id}/publish`,{expectedDraftRevision:1}),fixture.owner.send(`${P}/offerings/${d.id}/structure`,structure(d,{groups:[{...group,facultyIds:[fixture.faculty.lecture.id,fixture.faculty["lab-b"].id]}]}),"PUT")]);
    expect(results.filter(r=>r.status===200)).toHaveLength(1);expect(results.filter(r=>r.status===409)).toHaveLength(1);
    const saved=await fixture.owner.ok(`${P}/offerings/${d.id}`);
    if(saved.lockedAt)expect(saved.groups[0].facultyIds).toEqual([fixture.faculty.lecture.id]);
    else expect(saved.state).toBe("draft");
  });
  it("retains integrity, duplicate constraints and secret-free audit details",()=>{
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);expect(db.prepare("PRAGMA integrity_check").get()!.integrity_check).toBe("ok");
    const d=fixture.offering.id,id=fixture.studentIds[0],enrollment=db.prepare("SELECT id FROM enrollments WHERE subject_offering_id=? AND student_id=?").get(d,id)!.id;
    expect(()=>db.prepare("INSERT INTO enrollments(id,subject_offering_id,student_id) VALUES (?,?,?)").run(randomUUID(),d,id)).toThrow();
    expect(()=>db.prepare("INSERT INTO student_group_placements VALUES (?,?)").run(enrollment,fixture.groups[0].id)).toThrow();
    const audit=db.prepare("SELECT details_json FROM auth_audit_events WHERE event_type IN ('roster_batch_applied','account_activation_issued','setup_manager_granted')").all();
    expect(audit.length).toBeGreaterThan(3);expect(JSON.stringify(audit)).not.toMatch(/temporaryPassword|password_hash|Synthetic Student|000001/);
  });
});
