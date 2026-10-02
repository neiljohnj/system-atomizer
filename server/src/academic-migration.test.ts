import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Request, Response } from "express";
import { describe, it, expect, afterEach } from "vitest";
import { openAtomDatabase, migrateAtomDatabase, FACULTY_ID, STUDENT_ID, SUBJECT_OFFERING_ID, LAB_2A_ID } from "./db.js";
import { AuthService } from "./auth.js";
import { randomBytes } from "node:crypto";

const roots:string[]=[];
function database(sample=false){const root=mkdtempSync(join(tmpdir(),"atom-phase1-migration-"));roots.push(root);return {...openAtomDatabase(root,{sample}),root};}
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const req=(cookie="",remote="127.0.0.1")=>({ip:remote,socket:{remoteAddress:remote},header:(name:string)=>name==="cookie"?cookie:undefined}) as Request;

// Fixture construction only: remove the new additive schema from a synthetic database
// to exercise its version-6 upgrade. This is NOT an application rollback procedure.
function legacyVersion6(db:ReturnType<typeof database>["db"]){
  for(const r of db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all())db.exec(`DROP TRIGGER ${r.name}`);
  db.exec("DROP INDEX offerings_catalog_term");
  for(const table of ["roster_batches","managed_accounts","group_associations","offering_setup_managers","installation_owners"])db.exec(`DROP TABLE ${table}`);
  for(const column of ["course_id","display_label","setup_state","required_components_json","configuration_locked_at","setup_revision","setup_issue"])db.exec(`ALTER TABLE subject_offerings DROP COLUMN ${column}`);
  db.exec("DROP TABLE courses; DELETE FROM schema_migrations WHERE version=7");
}

describe("additive Phase 1 migration and deliberate owner bootstrap",()=>{
  it("normal fresh initialization has no sample course, identities or offerings",()=>{
    const {db}=database();try{for(const table of ["users","subjects","courses","academic_terms","subject_offerings","activities"])expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n).toBe(0);expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);}finally{db.close();}
  });
  it("preserves legacy IDs, credentials, manual totals, file hashes and ambiguous catalog state across repeated migration",()=>{
    const {db,root}=database(true);
    try{
      const auth=new AuthService(db,{developmentPreviewEnabled:false,secureCookies:false});
      const response={setHeader:()=>{}} as unknown as Response;
      auth.initialize(req(),response,{facultyId:FACULTY_ID,displayName:"Legacy Synthetic Faculty",username:"legacy-fixture",password:randomBytes(24).toString("base64url")});
      const activity=db.prepare("SELECT * FROM activities LIMIT 1").get()!;
      mkdirSync(join(root,"data/uploads"),{recursive:true});const path=join(root,"data/uploads/legacy.py"),bytes=Buffer.from("# preserved legacy evidence\n");writeFileSync(path,bytes);
      const hash=createHash("sha256").update(bytes).digest("hex");
      db.prepare("INSERT INTO submissions(id,activity_id,release_id,student_id,original_filename,normalized_filename,stored_path,mime_type,size_bytes,sha256,received_at,idempotency_key,status,is_current_submission) VALUES ('legacy-submission',?,?,?,'legacy.py','legacy.py','uploads/legacy.py','text/x-python',?,?,?,'legacy-key','fully_received',1)").run(activity.id,activity.current_release_id,STUDENT_ID,bytes.length,hash,new Date().toISOString());
      db.prepare("INSERT INTO evaluations VALUES ('legacy-evaluation','legacy-submission',111,13,'legacy manual evidence','',?,?,?)").run(FACULTY_ID,new Date().toISOString(),new Date().toISOString());
      legacyVersion6(db);
      const tables=["subjects","users","activities","activity_releases","activity_release_scopes","submissions","evaluations","auth_credentials","teaching_groups","faculty_group_assignments","enrollments","student_group_placements"];
      const before=JSON.stringify(tables.map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
      migrateAtomDatabase(db);migrateAtomDatabase(db);
      expect(JSON.stringify(tables.map(t=>db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()))===before).toBe(true);
      const offering=db.prepare("SELECT * FROM subject_offerings WHERE id=?").get(SUBJECT_OFFERING_ID)!;
      expect(offering.course_id).toBeNull();expect(offering.setup_state).toBe("legacy");expect(offering.configuration_locked_at).toBeTruthy();
      expect(db.prepare("SELECT COUNT(*) n FROM installation_owners").get()!.n).toBe(0);
      expect(createHash("sha256").update(readFileSync(path)).digest("hex")).toBe(hash);
      expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
    }finally{db.close();}
  });
  it("quarantines inconsistent historical placements without deleting or correcting them",()=>{
    const {db}=database(true);try{
      legacyVersion6(db);
      db.prepare("INSERT INTO subject_offerings(id,academic_term_id,subject_code,subject_title) SELECT 'unsafe-other',academic_term_id,'LEGACY-OTHER','Legacy other' FROM subject_offerings LIMIT 1").run();
      db.prepare("INSERT INTO teaching_groups VALUES ('unsafe-group','unsafe-other','laboratory','Unsafe',0)").run();
      const enrollment=db.prepare("SELECT id FROM enrollments LIMIT 1").get()!.id;
      db.prepare("INSERT INTO student_group_placements VALUES (?,'unsafe-group')").run(enrollment);
      migrateAtomDatabase(db);
      expect(db.prepare("SELECT 1 FROM student_group_placements WHERE enrollment_id=? AND teaching_group_id='unsafe-group'").get(enrollment)).toBeTruthy();
      expect(db.prepare("SELECT setup_issue FROM subject_offerings WHERE id=?").get(SUBJECT_OFFERING_ID)!.setup_issue).toMatch(/quarantined/);
      expect(()=>db.prepare("INSERT INTO student_group_placements VALUES ((SELECT id FROM enrollments WHERE id<>? LIMIT 1),'unsafe-group')").run(enrollment)).toThrow();
      expect(db.prepare("SELECT COUNT(*) n FROM teaching_groups WHERE id=?").get(LAB_2A_ID)!.n).toBe(1);
    }finally{db.close();}
  });
  it("requires a host-local authenticated exact-identity grant for an existing installation",()=>{
    const {db}=database(true);try{
      let cookie="";const response={setHeader:(_name:string,value:string)=>{cookie=value.split(";")[0];}} as unknown as Response;
      const auth=new AuthService(db,{developmentPreviewEnabled:false,secureCookies:false});
      auth.initialize(req(),response,{facultyId:FACULTY_ID,displayName:"Legacy Synthetic",username:"legacy-owner",password:randomBytes(24).toString("base64url")});
      expect(db.prepare("SELECT COUNT(*) n FROM installation_owners").get()!.n).toBe(0);
      expect(()=>auth.bootstrapOwner(req(cookie),"wrong")).toThrow();
      expect(()=>auth.bootstrapOwner(req(cookie,"192.0.2.1"),FACULTY_ID)).toThrow();
      const proxy=new AuthService(db,{developmentPreviewEnabled:false,secureCookies:false,behindProxy:true});expect(()=>proxy.bootstrapOwner(req(cookie),FACULTY_ID)).toThrow(/proxy/);
      auth.bootstrapOwner(req(cookie),FACULTY_ID);
      expect(db.prepare("SELECT user_id FROM installation_owners").get()!.user_id).toBe(FACULTY_ID);
      expect(()=>auth.bootstrapOwner(req(cookie),FACULTY_ID)).toThrow(/already/);
    }finally{db.close();}
  });
});
