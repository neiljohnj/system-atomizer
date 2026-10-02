import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { AuthUser } from "./auth.js";
import { activationState, issueActivation } from "./account-activation.js";
import { createPasswordRecord, normalizeLoginIdentifier } from "./security.js";
import { HttpError } from "./errors.js";

type Row = Record<string, any>;
const KINDS = ["lecture", "laboratory", "combined"];
export const LOCK_MESSAGE = "First publication permanently locks staff, groups, enrollment and placements for this fixed-roster pilot. Unpublishing does not unlock them. Late enrollment and transfers are unavailable.";
const text = (value: unknown, label: string, max = 160): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw new HttpError(400, `${label} is required (maximum ${max} characters)`, "invalid_field", { field: label });
  return value.trim();
};
const strings = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.some(x => typeof x !== "string") || new Set(value).size !== value.length) throw new HttpError(400,"Select distinct valid values");
  return value;
};
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const normalizeStudentNumber = (value: unknown) => {
  const number = text(value,"Student number",64).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(number)) throw new HttpError(400,"Student numbers use letters, numbers, dots, underscores or dashes. Leading zeros are preserved.");
  return number;
};

/** All writes are called within one BEGIN IMMEDIATE transaction by academic-routes. */
export class AcademicSetup {
  constructor(private readonly db: DatabaseSync) {}
  owner(user: AuthUser): boolean {
    return user.role === "faculty" && Boolean(this.db.prepare("SELECT 1 FROM installation_owners WHERE user_id=?").get(user.id));
  }
  canManage(user: AuthUser, id: string): boolean {
    return user.role === "faculty" && (this.owner(user) || Boolean(this.db.prepare("SELECT 1 FROM offering_setup_managers WHERE offering_id=? AND user_id=?").get(id,user.id)));
  }
  requireOwner(user: AuthUser) {
    if (!this.owner(user)) throw new HttpError(403,"Installation-owner authority is required", "setup_forbidden");
  }
  offering(user: AuthUser, id: string): Row {
    if (!this.canManage(user,id)) throw new HttpError(403,"You do not manage setup for this offering", "setup_forbidden");
    const row = this.db.prepare("SELECT so.*, t.label term_label FROM subject_offerings so JOIN academic_terms t ON t.id=so.academic_term_id WHERE so.id=?").get(id);
    if (!row) throw new HttpError(404,"Offering not found");
    return row;
  }
  editable(user: AuthUser, id: string, revision?: unknown): Row {
    const row = this.offering(user,id);
    if (row.configuration_locked_at) throw new HttpError(409,LOCK_MESSAGE,"configuration_locked");
    if (row.setup_issue || row.setup_state === "legacy") throw new HttpError(409,row.setup_issue || "Legacy setup remains read-only pending identity review.","legacy_setup_review");
    if (revision !== undefined && revision !== row.setup_revision) throw new HttpError(409,"Saved setup changed. Reload and review before saving again.","setup_conflict");
    return row;
  }
  capabilities(user: AuthUser) {
    const owner = this.owner(user);
    const offeringIds = user.role !== "faculty" ? [] : (this.db.prepare(owner ? "SELECT id FROM subject_offerings" : "SELECT offering_id id FROM offering_setup_managers WHERE user_id=?").all(...(owner ? [] : [user.id])) as Row[]).map(r=>String(r.id));
    return { owner, canSetup: owner || offeringIds.length>0, offeringIds };
  }
  catalog(user: AuthUser) {
    const capability = this.capabilities(user);
    if (!capability.canSetup) throw new HttpError(403,"Setup authority is required","setup_forbidden");
    return {
      ...capability,
      courses: this.db.prepare("SELECT * FROM courses ORDER BY code").all(),
      terms: this.db.prepare("SELECT id,label FROM academic_terms ORDER BY label DESC").all(),
      faculty: this.db.prepare("SELECT id,display_name displayName FROM users WHERE role='faculty' ORDER BY display_name").all(),
      offerings: capability.offeringIds.map(id => { const r=this.offering(user,id); return {id,label:r.display_label,term:r.term_label,state:r.setup_state,locked:Boolean(r.configuration_locked_at)}; }),
    };
  }
  audit(user: AuthUser, event: string, details: Row) {
    this.db.prepare("INSERT INTO auth_audit_events(id,actor_user_id,event_type,details_json,created_at) VALUES (?,?,?,?,?)").run(randomUUID(),user.id,event,JSON.stringify(details),new Date().toISOString());
  }
  changed(user: AuthUser, id: string, event: string) {
    this.db.prepare("UPDATE subject_offerings SET setup_revision=setup_revision+1,setup_state='draft' WHERE id=?").run(id);
    this.audit(user,event,{offeringId:id});
    return this.detail(user,id);
  }
  createCourse(user: AuthUser, body: Row) {
    this.requireOwner(user);
    const code = text(body.code,"Course code",32).toUpperCase(), title = text(body.title,"Course title");
    if (this.db.prepare("SELECT 1 FROM courses WHERE code=? COLLATE NOCASE").get(code)) throw new HttpError(409,"That course code already exists. Select the existing course.","duplicate_course");
    const id=randomUUID(); this.db.prepare("INSERT INTO courses VALUES (?,?,?)").run(id,code,title);
    this.audit(user,"course_created",{courseId:id}); return {id,code,title};
  }
  createTerm(user: AuthUser, body: Row) {
    this.requireOwner(user);
    const label = text(body.label,"Academic term");
    if (this.db.prepare("SELECT 1 FROM academic_terms WHERE lower(trim(label))=lower(?)").get(label)) throw new HttpError(409,"That term already exists. Select it.","duplicate_term");
    const id=randomUUID(); this.db.prepare("INSERT INTO academic_terms(id,label) VALUES (?,?)").run(id,label);
    this.audit(user,"term_created",{termId:id}); return {id,label};
  }
  createOffering(user: AuthUser, body: Row) {
    this.requireOwner(user);
    const course=this.db.prepare("SELECT * FROM courses WHERE id=?").get(text(body.courseId,"Course"));
    const term=this.db.prepare("SELECT * FROM academic_terms WHERE id=?").get(text(body.termId,"Term"));
    if (!course || !term) throw new HttpError(400,"Select a saved course and term");
    const label=text(body.label,"Offering display identity"), required=this.required(body.requiredComponents);
    if (this.db.prepare("SELECT 1 FROM subject_offerings WHERE academic_term_id=? AND lower(trim(subject_code))=lower(?)").get(String(term.id),String(course.code))) throw new HttpError(409,"This course already has an offering in this term. Review the existing offering; records are never merged automatically.","duplicate_offering");
    const id=randomUUID(), bridge=randomUUID();
    this.db.prepare("INSERT INTO subjects VALUES (?,?,?,?,?)").run(bridge,String(course.code),String(course.title),String(term.label),label);
    this.db.prepare("INSERT INTO subject_offerings(id,academic_term_id,subject_code,subject_title,legacy_subject_id,course_id,display_label,setup_state,required_components_json) VALUES (?,?,?,?,?,?,?,'draft',?)")
      .run(id,String(term.id),String(course.code),String(course.title),bridge,String(course.id),label,JSON.stringify(required));
    this.db.prepare("INSERT INTO offering_setup_managers VALUES (?,?,?,?)").run(id,user.id,user.id,new Date().toISOString());
    this.audit(user,"offering_created",{offeringId:id,courseId:course.id}); return this.detail(user,id);
  }
  required(value: unknown) {
    const kinds=strings(value);
    if (!kinds.length || kinds.some(x=>!KINDS.includes(x))) throw new HttpError(400,"Choose this offering's required components");
    return kinds;
  }
  describe(user: AuthUser, id: string, body: Row) {
    const row=this.offering(user,id);
    if (body.expectedRevision !== row.setup_revision) throw new HttpError(409,"Saved setup changed. Reload before editing.","setup_conflict");
    if (Object.keys(body).some(k=>!["label","expectedRevision"].includes(k))) throw new HttpError(400,"Only the display identity can be edited here");
    this.db.prepare("UPDATE subject_offerings SET display_label=?,setup_revision=setup_revision+1 WHERE id=?").run(text(body.label,"Offering display identity"),id);
    this.audit(user,"offering_description_changed",{offeringId:id}); return this.detail(user,id);
  }
  configure(user: AuthUser, id: string, body: Row) {
    this.editable(user,id,body.expectedRevision);
    const required=this.required(body.requiredComponents);
    if (!Array.isArray(body.groups) || !body.groups.length || body.groups.length>50 || body.groups.some((g: unknown)=>!g || typeof g!=="object" || Array.isArray(g))) throw new HttpError(400,"Use 1–50 valid teaching group rows");
    const groups=body.groups.map((g: Row) => ({id:text(g.id,"Group identity",80), label:text(g.label,"Group label",80), kind:text(g.componentKind,"Component"),faculty:strings(g.facultyIds)}));
    if (new Set(groups.map((g: Row)=>g.id)).size!==groups.length || new Set(groups.map((g: Row)=>`${g.kind}:${g.label.toLowerCase()}`)).size!==groups.length) throw new HttpError(409,"Duplicate group identity or label");
    for (const g of groups) {
      if (g.id === "all" || !KINDS.includes(g.kind)) throw new HttpError(400,"Choose a concrete group and component");
      const existing=this.db.prepare("SELECT subject_offering_id FROM teaching_groups WHERE id=?").get(g.id);
      if (existing && existing.subject_offering_id!==id) throw new HttpError(400,"A group cannot move between offerings");
      if (g.faculty.some((fid: string)=>!this.db.prepare("SELECT 1 FROM users WHERE id=? AND role='faculty'").get(fid))) throw new HttpError(400,"Select existing faculty identities");
    }
    if (!Array.isArray(body.links) || body.links.length>250 || body.links.some((l: unknown)=>!l || typeof l!=="object" || Array.isArray(l))) throw new HttpError(400,"Use at most 250 valid explicit group links");
    const links=body.links.map((l: Row)=>({lectureId:text(l.lectureId,"Lecture"),laboratoryId:text(l.laboratoryId,"Laboratory")}));
    if (new Set(links.map((l: Row)=>`${l.lectureId}:${l.laboratoryId}`)).size!==links.length) throw new HttpError(409,"Duplicate lecture/laboratory association");
    for (const l of links) if (!groups.some((g: Row)=>g.id===l.lectureId && g.kind==="lecture") || !groups.some((g: Row)=>g.id===l.laboratoryId && g.kind==="laboratory")) throw new HttpError(400,"Links require a lecture and laboratory in this offering");
    this.db.prepare("DELETE FROM group_associations WHERE offering_id=?").run(id);
    const old=this.db.prepare("SELECT id FROM teaching_groups WHERE subject_offering_id=?").all(id);
    for (const g of old) if (!groups.some((x: Row)=>x.id===g.id)) {
      if (this.db.prepare("SELECT 1 FROM student_group_placements WHERE teaching_group_id=?").get(String(g.id))) throw new HttpError(409,"Remove student placements explicitly before removing their group");
      this.db.prepare("DELETE FROM teaching_groups WHERE id=?").run(String(g.id));
    }
    for (const [order,g] of groups.entries()) {
      this.db.prepare("INSERT INTO teaching_groups VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET component_kind=excluded.component_kind,label=excluded.label,sort_order=excluded.sort_order").run(g.id,id,g.kind,g.label,order);
      this.db.prepare("DELETE FROM faculty_group_assignments WHERE teaching_group_id=?").run(g.id);
      for (const fid of g.faculty) this.db.prepare("INSERT INTO faculty_group_assignments VALUES (?,?)").run(fid,g.id);
    }
    for (const l of links) this.db.prepare("INSERT INTO group_associations VALUES (?,?,?)").run(id,l.lectureId,l.laboratoryId);
    this.db.prepare("UPDATE subject_offerings SET required_components_json=? WHERE id=?").run(JSON.stringify(required),id);
    return this.changed(user,id,"teaching_structure_saved");
  }
  grantManager(user: AuthUser,id: string,body: Row) {
    this.requireOwner(user); this.editable(user,id);
    const facultyId=text(body.facultyId,"Faculty identity");
    if (!this.db.prepare("SELECT 1 FROM users WHERE id=? AND role='faculty'").get(facultyId)) throw new HttpError(400,"Select a faculty account");
    if (body.remove === true) this.db.prepare("DELETE FROM offering_setup_managers WHERE offering_id=? AND user_id=?").run(id,facultyId);
    else this.db.prepare("INSERT INTO offering_setup_managers VALUES (?,?,?,?) ON CONFLICT(offering_id,user_id) DO NOTHING").run(id,facultyId,user.id,new Date().toISOString());
    this.audit(user,body.remove ? "setup_manager_revoked" : "setup_manager_granted",{offeringId:id,facultyId}); return this.detail(user,id);
  }
  provisionFaculty(user: AuthUser,body: Row) {
    this.requireOwner(user);
    const displayName=text(body.displayName,"Faculty name"), identifier=normalizeLoginIdentifier(text(body.username,"Username",64));
    if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(identifier)) throw new HttpError(400,"Username must be 3–64 letters, numbers, dots, underscores or dashes");
    const id=randomUUID(), secret=createPasswordRecord(randomBytes(24).toString("base64url"));
    this.db.prepare("INSERT INTO users(id,display_name,role) VALUES (?,?,'faculty')").run(id,displayName);
    this.db.prepare("INSERT INTO auth_credentials VALUES (?,?,?,?,?,?,1,NULL,?)").run(id,identifier,identifier,secret.passwordHash,secret.passwordSalt,secret.passwordParams,new Date().toISOString());
    this.db.prepare("INSERT INTO managed_accounts(user_id) VALUES (?)").run(id);
    this.audit(user,"faculty_provisioned",{userId:id}); return {id,displayName};
  }
  handoff(user: AuthUser,userId: string,offeringId?: string) {
    if (!this.owner(user)) {
      if (!offeringId) throw new HttpError(403,"Offering setup authority is required");
      this.offering(user,offeringId);
      if (!this.db.prepare("SELECT 1 FROM enrollments WHERE subject_offering_id=? AND student_id=?").get(offeringId,userId)) throw new HttpError(403,"Student is not enrolled in your managed offering");
    }
    const result=issueActivation(this.db,userId);
    this.audit(user,"account_activation_issued",{userId}); return result;
  }
  revokeSessions(user: AuthUser,userId: string) {
    this.requireOwner(user);
    this.db.prepare("UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL").run(new Date().toISOString(),userId);
    this.audit(user,"account_sessions_revoked",{userId});
  }
  rosterPlan(user: AuthUser,id: string,body: Row) {
    const offering=this.editable(user,id);
    if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length>200 || body.rows.some((r: unknown)=>!r || typeof r!=="object" || Array.isArray(r))) throw new HttpError(400,"Preview 1–200 valid student rows at a time");
    const groups=this.db.prepare("SELECT * FROM teaching_groups WHERE subject_offering_id=?").all(id) as Row[];
    const required=JSON.parse(offering.required_components_json) as string[];
    const seen=new Set<string>();
    const rows=body.rows.map((input: Row,index: number) => {
      const issues: string[]=[];
      let number="", name="", groupIds: string[]=[];
      try { number=normalizeStudentNumber(input.studentNumber); name=text(input.displayName,"Student name"); groupIds=strings(input.groupIds); }
      catch(error) { issues.push((error as Error).message); }
      if (seen.has(number)) issues.push("Duplicate student number in this batch"); seen.add(number);
      if (!groupIds.length || groupIds.some(g=>!groups.some(x=>x.id===g))) issues.push("Choose explicit groups from this offering");
      for (const kind of required) if (!groupIds.some(g=>groups.some(x=>x.id===g && x.component_kind===kind))) issues.push(`Missing required ${kind} placement`);
      const matches=this.db.prepare("SELECT * FROM users WHERE upper(trim(student_number))=?").all(number) as Row[];
      const existing=matches.length===1 ? matches[0] : null;
      if (matches.length>1 || (existing && (existing.role!=="student" || existing.display_name!==name))) issues.push("Existing identity conflicts. Verify the exact student number and saved name; no identity will be overwritten.");
      if (existing && input.reuseUserId!==existing.id) issues.push("Confirm reuse of this exact existing identity, then preview again");
      if (existing && this.db.prepare("SELECT 1 FROM enrollments WHERE subject_offering_id=? AND student_id=?").get(id,existing.id)) issues.push("Already enrolled in this offering. Edit the saved placement instead.");
      if (!existing && this.db.prepare("SELECT 1 FROM auth_credentials WHERE login_identifier_normalized=?").get(normalizeLoginIdentifier(number))) issues.push("This identifier is already reserved by another account");
      return {index,studentNumber:number,displayName:name,groupIds,existingUserId:existing?.display_name===name ? String(existing.id) : null,action:issues.length ? "rejected" : existing ? "reuse" : "add",issues};
    });
    return {rows,revision:Number(offering.setup_revision),previewToken:digest({actor:user.id,id,revision:offering.setup_revision,rows}),canApply:rows.every((r: Row)=>!r.issues.length)};
  }
  applyRoster(user: AuthUser,id: string,body: Row) {
    this.offering(user,id);
    const key=text(body.requestKey,"Batch request key",80), requestDigest=digest({rows:body.rows,previewToken:body.previewToken});
    const previous=this.db.prepare("SELECT * FROM roster_batches WHERE offering_id=? AND actor_id=? AND request_key=?").get(id,user.id,key);
    if (previous) {
      if (previous.request_digest!==requestDigest) throw new HttpError(409,"This batch key was already used for different data","batch_key_conflict");
      return {...JSON.parse(String(previous.result_json)),replayed:true};
    }
    const plan=this.rosterPlan(user,id,body);
    if (!plan.canApply || plan.previewToken!==body.previewToken) throw new HttpError(409,"Preview is stale or contains unresolved rows. Preview again before applying.","roster_preview_stale");
    const studentIds: string[]=[];
    for (const row of plan.rows) {
      const studentId=row.existingUserId ?? randomUUID();
      if (!row.existingUserId) {
        this.db.prepare("INSERT INTO users(id,student_number,display_name,role) VALUES (?,?,?,'student')").run(studentId,row.studentNumber,row.displayName);
        this.db.prepare("INSERT INTO managed_accounts(user_id) VALUES (?)").run(studentId);
      }
      const enrollmentId=randomUUID();
      this.db.prepare("INSERT INTO enrollments(id,subject_offering_id,student_id) VALUES (?,?,?)").run(enrollmentId,id,studentId);
      for (const groupId of row.groupIds) this.db.prepare("INSERT INTO student_group_placements VALUES (?,?)").run(enrollmentId,groupId);
      studentIds.push(studentId);
    }
    this.changed(user,id,"roster_batch_applied");
    const result={studentIds,applied:studentIds.length,replayed:false};
    this.db.prepare("INSERT INTO roster_batches VALUES (?,?,?,?,?)").run(id,user.id,key,requestDigest,JSON.stringify(result));
    return result;
  }
  placement(user: AuthUser,id: string,enrollmentId: string,body: Row) {
    this.editable(user,id,body.expectedRevision);
    const enrollment=this.db.prepare("SELECT * FROM enrollments WHERE id=? AND subject_offering_id=?").get(enrollmentId,id);
    if (!enrollment) throw new HttpError(404,"Enrollment not found");
    const groupIds=strings(body.groupIds);
    if (!["active","inactive"].includes(body.status)) throw new HttpError(400,"Choose active or inactive enrollment");
    if (groupIds.some(g=>!this.db.prepare("SELECT 1 FROM teaching_groups WHERE id=? AND subject_offering_id=?").get(g,id))) throw new HttpError(400,"Placements must belong to this offering");
    this.db.prepare("DELETE FROM student_group_placements WHERE enrollment_id=?").run(enrollmentId);
    for (const g of groupIds) this.db.prepare("INSERT INTO student_group_placements VALUES (?,?)").run(enrollmentId,g);
    this.db.prepare("UPDATE enrollments SET status=? WHERE id=?").run(body.status,enrollmentId);
    return this.changed(user,id,"student_placement_saved");
  }
  detail(user: AuthUser,id: string) {
    const offering=this.offering(user,id);
    const groups=(this.db.prepare("SELECT * FROM teaching_groups WHERE subject_offering_id=? ORDER BY sort_order,label").all(id) as Row[]).map(g=>({id:String(g.id),label:String(g.label),componentKind:String(g.component_kind),facultyIds:(this.db.prepare("SELECT faculty_id FROM faculty_group_assignments WHERE teaching_group_id=? ORDER BY faculty_id").all(g.id) as Row[]).map(x=>String(x.faculty_id))}));
    const required=JSON.parse(offering.required_components_json) as string[];
    const roster=(this.db.prepare("SELECT e.id enrollmentId,e.status,u.id,u.student_number studentNumber,u.display_name displayName FROM enrollments e JOIN users u ON u.id=e.student_id WHERE e.subject_offering_id=? ORDER BY u.student_number").all(id) as Row[]).map(r=>{
      const groupIds=(this.db.prepare("SELECT teaching_group_id FROM student_group_placements WHERE enrollment_id=? ORDER BY teaching_group_id").all(r.enrollmentId) as Row[]).map(p=>String(p.teaching_group_id));
      return {...r,status:String(r.status),groupIds,activationState:activationState(this.db,String(r.id)),issues:r.status==="active" ? required.filter(k=>!groups.some(g=>g.componentKind===k && groupIds.includes(g.id))).map(k=>`Missing required ${k} placement`) : []};
    });
    const issues: string[]=[];
    if (offering.setup_issue) issues.push(String(offering.setup_issue));
    if (offering.setup_state === "legacy") issues.push("Legacy catalog and placement history remain unreviewed. Existing teaching access is preserved.");
    if (!groups.length) issues.push("Add at least one teaching group");
    for (const g of groups) if (!g.facultyIds.length) issues.push(`Assign an instructor to ${g.label}`);
    if (!roster.some(r=>r.status==="active")) issues.push("Enroll at least one student");
    const missing=roster.filter(r=>r.issues.length).length;
    if (missing) issues.push(`${missing} student(s) need required component placements`);
    return {id,courseId:offering.course_id,courseCode:offering.subject_code,courseTitle:offering.subject_title,termId:offering.academic_term_id,termLabel:offering.term_label,label:offering.display_label,state:offering.setup_state,revision:Number(offering.setup_revision),lockedAt:offering.configuration_locked_at,lockMessage:LOCK_MESSAGE,requiredComponents:required,groups,links:this.db.prepare("SELECT lecture_id lectureId,laboratory_id laboratoryId FROM group_associations WHERE offering_id=? ORDER BY lecture_id,laboratory_id").all(id),managers:this.db.prepare("SELECT u.id,u.display_name displayName FROM offering_setup_managers m JOIN users u ON u.id=m.user_id WHERE m.offering_id=?").all(id),roster,issues,canOpenActivities:Boolean(this.db.prepare("SELECT 1 FROM faculty_group_assignments f JOIN teaching_groups g ON g.id=f.teaching_group_id WHERE g.subject_offering_id=? AND f.faculty_id=?").get(id,user.id))};
  }
  ready(user: AuthUser,id: string,body: Row) {
    this.editable(user,id,body.expectedRevision);
    const detail=this.detail(user,id);
    if (detail.issues.length) throw new HttpError(409,"Resolve the review requirements before opening activities","setup_not_ready",{issues:detail.issues});
    this.db.prepare("UPDATE subject_offerings SET setup_state='ready',setup_revision=setup_revision+1 WHERE id=?").run(id);
    this.audit(user,"offering_ready",{offeringId:id}); return this.detail(user,id);
  }
  assertPublishReady(offeringId: string) {
    const row=this.db.prepare("SELECT setup_state FROM subject_offerings WHERE id=?").get(offeringId);
    if (row?.setup_state === "draft") throw new HttpError(409,"Complete course setup review before first publication","setup_not_ready");
  }
}
