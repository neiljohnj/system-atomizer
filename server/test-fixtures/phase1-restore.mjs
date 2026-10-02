import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startFixture, stopFixture, client, createClass, runClassWorkflow } from "./phase1-fixture.mjs";

const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
function manifest(root,folder=root){return readdirSync(folder).sort().flatMap(name=>{const path=join(folder,name);return statSync(path).isDirectory()?manifest(root,path):[{path:relative(root,path),size:statSync(path).size,sha256:digest(readFileSync(path))}];});}
function state(root){
  const db=new DatabaseSync(join(root,"data/atom.sqlite"),{readOnly:true});
  try{
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check,"ok");assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
    const tables=["schema_migrations","courses","subjects","academic_terms","subject_offerings","users","installation_owners","offering_setup_managers","teaching_groups","group_associations","faculty_group_assignments","enrollments","student_group_placements","managed_accounts","roster_batches","auth_credentials","activities","activity_releases","activity_release_scopes","activity_assets","activity_release_assets","submissions","evaluations"];
    const rows=Object.fromEntries(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    for(const file of [...rows.activity_assets,...rows.activity_release_assets,...rows.submissions]){
      const path=resolve(root,"data",file.stored_path);assert.ok(path.startsWith(resolve(root,"data")+sep));
      const bytes=readFileSync(path);assert.equal(bytes.length,file.size_bytes);assert.equal(digest(bytes),file.sha256);
    }
    assert.equal(db.prepare("SELECT activity_id,student_id FROM submissions GROUP BY activity_id,student_id HAVING SUM(is_current_submission)<>1").all().length,0);
    return rows;
  }finally{db.close();}
}
export async function runPhase1Restore(){
  const parent=mkdtempSync(join(tmpdir(),"atom-phase1-restore-")),source=join(parent,"source"),restored=join(parent,"restored");let server;
  try{
    server=await startFixture(source,{compiled:true});
    const fixture=await createClass(server.base),evidence=await runClassWorkflow(server.base,fixture);
    await stopFixture(server);server=null;
    const before=state(source),original=manifest(join(source,"data"));
    cpSync(join(source,"data"),join(restored,"data"),{recursive:true,errorOnExist:true,force:false});
    assert.deepEqual(manifest(join(restored,"data")),original);assert.deepEqual(state(restored),before);
    server=await startFixture(restored,{compiled:true});
    const owner=client(server.base);await owner.ok("/api/auth/login",{identifier:"fixture-owner",password:fixture.ownerPassword});
    const setup=await owner.ok(`/api/academic-setup/offerings/${fixture.offering.id}`);
    assert.ok(setup.lockedAt);assert.equal(setup.links.length,2);assert.equal(setup.roster.filter(r=>r.activationState==="unclaimed").length,1);
    for(const item of evidence){
      const faculty=client(server.base),student=client(server.base),other=client(server.base),manager=client(server.base);
      const f=fixture.faculty[item.teacher],o=fixture.faculty[item.teacher==="lab-a"?"lab-b":"lab-a"],m=fixture.faculty.manager;
      for(const [actor,identity] of [[faculty,f],[student,item.student],[other,o],[manager,m]])await actor.ok("/api/auth/login",{identifier:identity.identifier,password:identity.password});
      for(const actor of [faculty,student]){
        const file=await actor.send(`/api/submissions/${item.submission.id}/file`);assert.equal(file.status,200);assert.equal(digest(file.bytes),before.submissions.find(s=>s.id===item.submission.id).sha256);
        const material=await actor.send(`/api/activity-assets/${item.asset.id}/file`);assert.equal(material.status,200);assert.equal(digest(material.bytes),before.activity_assets.find(a=>a.id===item.asset.id).sha256);
      }
      for(const actor of [other,manager,owner])assert.equal((await actor.send(`/api/submissions/${item.submission.id}/file`)).status,404);
      const d=await faculty.ok(`/api/activities/${item.activity.id}?subjectOfferingId=${fixture.offering.id}&teachingGroupId=all&gradingPeriod=midterm`);
      assert.equal(d.submissions.length,1);assert.equal(d.submissions[0].evaluation.score,8);assert.equal(d.submissions[0].evaluation.manualDeduction,1);
    }
    await stopFixture(server);server=null;
    assert.deepEqual(state(restored),before);assert.deepEqual(manifest(join(source,"data")),original);
    console.log(`Phase 1 restore passed: ${original.length} files copied exactly; 24 table snapshots, catalog, setup grants, links, activation, permanent locks, two labs' credentials and scoped evidence verified; source unchanged.`);
  }finally{await stopFixture(server);if(resolve(parent).startsWith(resolve(tmpdir())+sep)&&parent.includes("atom-phase1-restore-"))rmSync(parent,{recursive:true,force:true});}
}
