import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { BootstrapPayload, ComponentKind } from "../../types";
import { CredentialHandoff } from "./CredentialHandoff";
import { RosterWorkbench } from "./RosterWorkbench";
import { COMPONENTS, TeachingGroups, TeachingMap } from "./TeachingGroups";
import { setupApi, type CredentialHandoff as Handoff, type GroupLink, type SetupCatalog, type SetupDetail, type SetupGroup } from "./setup-api";

const STEPS=["Course & term","Teaching groups","Students","Review"];
export default function CourseSetup({bootstrap,onRefresh}:{bootstrap:BootstrapPayload;onRefresh:()=>Promise<unknown>}) {
  const {offeringId=""}=useParams();
  return <SetupWorkspace key={`${bootstrap.currentUser.id}:${offeringId}`} offeringId={offeringId} onRefresh={onRefresh}/>;
}

function SetupWorkspace({offeringId,onRefresh}:{offeringId:string;onRefresh:()=>Promise<unknown>}) {
  const navigate=useNavigate(),[params,setParams]=useSearchParams();
  const step=offeringId?Math.min(3,Math.max(0,Number(params.get("step"))||0)):0;
  const rawReturn=params.get("returnTo"),returnTo=rawReturn?.startsWith("/subjects") && !rawReturn.startsWith("//")?rawReturn:"/subjects";
  const [catalog,setCatalog]=useState<SetupCatalog|null>(null),[detail,setDetail]=useState<SetupDetail|null>(null);
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[dirty,setDirty]=useState(false),[notice,setNotice]=useState("");
  const [courseId,setCourseId]=useState(""),[termId,setTermId]=useState(""),[label,setLabel]=useState("");
  const [code,setCode]=useState(""),[title,setTitle]=useState(""),[termLabel,setTermLabel]=useState("");
  const [groups,setGroups]=useState<SetupGroup[]>([]),[links,setLinks]=useState<GroupLink[]>([]),[required,setRequired]=useState<ComponentKind[]>(["lecture"]);
  const [facultyName,setFacultyName]=useState(""),[username,setUsername]=useState(""),[manager,setManager]=useState("");
  const [handoff,setHandoff]=useState<{id:string;displayName:string}|null>(null);
  const alive=useRef(true),heading=useRef<HTMLHeadingElement>(null);
  const accept=(d:SetupDetail)=>{setDetail(d);setLabel(d.label);setCourseId(d.courseId??"");setTermId(d.termId);setGroups(d.groups);setLinks(d.links);setRequired(d.requiredComponents);setDirty(false);setNotice("Saved to ATOM");};
  useEffect(()=>{
    alive.current=true;
    void Promise.all([setupApi.catalog(),offeringId?setupApi.detail(offeringId):Promise.resolve(null)]).then(([c,d])=>{if(alive.current){setCatalog(c);if(d)accept(d);}}).catch(e=>{if(alive.current)setError((e as Error).message);});
    return()=>{alive.current=false;};
  },[offeringId]);
  useEffect(()=>{heading.current?.focus();},[step]);
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError("");setNotice("");try{await work();}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}};
  const refreshCatalog=async()=>{const c=await setupApi.catalog();if(alive.current)setCatalog(c);};
  const go=(n:number)=>{if(dirty && !window.confirm("Discard unsaved form changes? Explicitly saved draft configuration remains."))return;if(detail)accept(detail);const next=new URLSearchParams(params);next.set("step",String(n));setParams(next);};
  const changed=<T,>(setter:(x:T)=>void,value:T)=>{setter(value);setDirty(true);setNotice("");};
  const openActivities=async()=>{await onRefresh();if(alive.current)navigate(`/subjects/${offeringId}/activities${returnTo.startsWith(`/subjects/${offeringId}/`)?(returnTo.includes("?")?`?${returnTo.split("?")[1]}`:""):""}`);};
  const saveFirst=()=>run(async()=>{
    if(detail){const d=await setupApi.write<SetupDetail>(`/offerings/${offeringId}/description`,{label,expectedRevision:detail.revision},"PATCH");if(alive.current){accept(d);const next=new URLSearchParams(params);next.set("step","1");setParams(next);}}
    else {const d=await setupApi.write<SetupDetail>("/offerings",{courseId,termId,label,requiredComponents:required});await onRefresh();if(alive.current)navigate(`/course-setup/${d.id}?step=1&returnTo=${encodeURIComponent(returnTo)}`);}
  });
  const saveGroups=()=>run(async()=>{const d=await setupApi.write<SetupDetail>(`/offerings/${offeringId}/structure`,{groups,links,requiredComponents:required,expectedRevision:detail!.revision},"PUT");if(alive.current){accept(d);const next=new URLSearchParams(params);next.set("step","2");setParams(next);}await onRefresh();});
  const locked=Boolean(detail?.lockedAt)||detail?.state==="legacy";
  if(!catalog)return <main className="course-setup">{error?<p role="alert" className="form-error">{error}</p>:<p>Loading course setup…</p>}<Link to={returnTo}>Return to subjects</Link></main>;
  return <main className="course-setup">
    <header className="setup-heading"><div><Link to={returnTo} onClick={e=>{if(dirty&&!window.confirm("Discard unsaved form changes? Saved drafts remain."))e.preventDefault();}}>← Return to workspace</Link><h1>Course setup</h1><p>{detail?`${detail.courseCode} · ${detail.termLabel}`:"Create a course offering or resume a saved draft."}</p></div><span role="status" className="setup-save-state">{busy?"Saving…":dirty?"Unsaved form changes":notice|| (detail?`${detail.state} configuration · saved`:"No offering saved yet")}</span></header>
    <nav className="setup-stages" aria-label="Course setup stages">{STEPS.map((name,n)=><button key={name} aria-current={n===step?"step":undefined} disabled={!detail&&n>0||busy} onClick={()=>go(n)}><span>{n+1}</span>{name}</button>)}</nav>
    {detail?.lockedAt?<p className="setup-lock" role="note">Configuration locked since {new Date(detail.lockedAt).toLocaleDateString()}. {detail.lockMessage}</p>:null}
    {detail?.state==="legacy"?<p className="setup-lock">Legacy offering. Catalog identity and historical placements have not been reconstructed; setup is read-only. Existing teaching access remains available.</p>:null}
    {error?<p id="setup-error" className="form-error" role="alert">{error} Your form entries are retained.</p>:null}
    <h2 ref={heading} tabIndex={-1} className="setup-stage-heading">{STEPS[step]}</h2>
    {step===0?<section>
      {!detail&&catalog.offerings.length?<details className="setup-resume" open={!catalog.owner}><summary>Resume a saved offering</summary><ul>{catalog.offerings.map(o=><li key={o.id}><Link to={`/course-setup/${o.id}?returnTo=${encodeURIComponent(returnTo)}`}>{o.label} · {o.term}</Link><small>{o.locked?"Configuration locked":o.state}</small></li>)}</ul></details>:null}
      {detail||catalog.owner?<fieldset className="setup-fields" disabled={busy} aria-describedby={error?"setup-error":undefined}><legend>{detail?"Saved course and term":"New offering"}</legend>
        {detail?<p><strong>{detail.courseCode} · {detail.courseTitle}</strong><br/>{detail.termLabel}. Course and term identities are fixed once this offering is saved.</p>:<><div className="setup-form-grid"><label>Course<select aria-label="Course" value={courseId} onChange={e=>changed(setCourseId,e.target.value)}><option value="">Choose a course</option>{catalog.courses.map(c=><option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}</select></label><label>Academic term<select aria-label="Academic term" value={termId} onChange={e=>changed(setTermId,e.target.value)}><option value="">Choose a term</option>{catalog.terms.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}</select></label></div>
          <details><summary>Create a reusable course</summary><div className="setup-form-grid"><label>Course code<input value={code} onChange={e=>setCode(e.target.value)}/></label><label>Course title<input value={title} onChange={e=>setTitle(e.target.value)}/></label></div><button className="button" onClick={()=>void run(async()=>{const c=await setupApi.write<{id:string}>("/courses",{code,title});if(alive.current){setCourseId(c.id);setCode("");setTitle("");setDirty(true);}await refreshCatalog();})}>Save course definition</button></details>
          <details><summary>Create an academic term</summary><label>Term label<input value={termLabel} onChange={e=>setTermLabel(e.target.value)}/></label><button className="button" onClick={()=>void run(async()=>{const t=await setupApi.write<{id:string}>("/terms",{label:termLabel});if(alive.current){setTermId(t.id);setTermLabel("");setDirty(true);}await refreshCatalog();})}>Save academic term</button></details></>}
        <label>Offering display identity<input value={label} maxLength={160} onChange={e=>changed(setLabel,e.target.value)} placeholder="A clear name for this course in this term"/></label>
        {!detail?<fieldset><legend>Required placement components</legend>{COMPONENTS.map(k=><label className="setup-check" key={k}><input type="checkbox" checked={required.includes(k)} onChange={e=>changed(setRequired,e.target.checked?[...required,k]:required.filter(x=>x!==k))}/>{k}</label>)}</fieldset>:null}
        <p className="setup-help">One offering per course per term in this installation. Save creates draft configuration; it does not publish any activity or grant evaluation authority.</p><div className="setup-actions"><button className="button button--primary" onClick={()=>void saveFirst()}>{detail?"Save identity and continue":"Save draft offering and continue"}</button></div>
      </fieldset>:null}
    </section>:null}
    {step===1&&detail?<><div className="setup-two-column"><TeachingGroups groups={groups} links={links} required={required} faculty={catalog.faculty} disabled={busy||locked} onChange={g=>changed(setGroups,g)} onLinks={l=>changed(setLinks,l)} onRequired={r=>changed(setRequired,r)}/><TeachingMap groups={groups} links={links} faculty={catalog.faculty} title={`${detail.courseCode} · ${detail.termLabel}`}/></div>
      {catalog.owner?<details className="setup-provision"><summary>Provision a faculty account</summary><p>Identity provisioning does not assign teaching or setup permissions.</p><div className="setup-form-grid"><label>Faculty display name<input value={facultyName} onChange={e=>setFacultyName(e.target.value)}/></label><label>Faculty username<input value={username} onChange={e=>setUsername(e.target.value)}/></label></div><button className="button" disabled={busy} onClick={()=>void run(async()=>{const f=await setupApi.write<{id:string;displayName:string}>("/faculty",{displayName:facultyName,username});if(alive.current){setFacultyName("");setUsername("");setHandoff(f);}await refreshCatalog();})}>Create faculty identity</button><label>Existing faculty hand-off<select aria-label="Existing faculty hand-off" defaultValue="" onChange={e=>{const f=catalog.faculty.find(x=>x.id===e.target.value);if(f)setHandoff(f);e.target.value="";}}><option value="">Choose for private activation / reissue</option>{catalog.faculty.map(f=><option value={f.id} key={f.id}>{f.displayName}</option>)}</select></label></details>:null}
      <p className="setup-help">Every group needs an instructor for readiness. A shared publication requires one actor with publication rights and every destination assigned. Content collaboration does not grant delivery or evaluation access.</p><div className="setup-actions"><button className="button" disabled={busy} onClick={()=>accept(detail)}>Discard unsaved group edits</button>{locked?<button className="button button--primary" onClick={()=>go(2)}>View saved students</button>:<button className="button button--primary" disabled={busy} onClick={()=>void saveGroups()}>Save teaching groups and continue</button>}</div>
    </>:null}
    {step===2&&detail?<RosterWorkbench key={detail.id} detail={detail} onSaved={accept} onContinue={()=>go(3)}/>:null}
    {step===3&&detail?<section><div className="setup-two-column"><div><h3>{detail.label}</h3><p>{detail.courseCode} · {detail.courseTitle}<br/>{detail.termLabel}</p><p>{detail.roster.filter(r=>r.status==="active").length} enrolled students · {detail.groups.length} distinct teaching groups</p><p>Required placements: {detail.requiredComponents.join(", ")||"Unreviewed legacy configuration"}.</p><p>Student activation can happen after setup. Account existence is not completed activation.</p><h3>Readiness</h3>{detail.issues.length?<ul>{detail.issues.map(issue=><li key={issue}>{issue}</li>)}</ul>:<p>All saved groups have instructors and enrolled students have required placements.</p>}<p className="setup-lock">{detail.lockMessage}</p><p>Instructors may publish to their own assigned groups. Separate instructors can publish separate activities or explicitly copy content to authorized destinations. Evaluation remains provisional.</p></div><TeachingMap groups={detail.groups} links={detail.links} faculty={catalog.faculty} title={detail.label}/></div>
      <details><summary>Offering setup managers</summary><p>Setup management grants roster access, not submission files or evaluation.</p><ul>{detail.managers.map(m=><li key={m.id}>{m.displayName}{catalog.owner&&!locked?<button className="button button--small" disabled={busy} onClick={()=>void run(async()=>{const d=await setupApi.write<SetupDetail>(`/offerings/${offeringId}/managers`,{facultyId:m.id,remove:true});if(alive.current)accept(d);})}>Revoke setup grant</button>:null}</li>)}</ul>{catalog.owner&&!locked?<><label>Grant setup authority<select aria-label="Grant setup authority" value={manager} onChange={e=>setManager(e.target.value)}><option value="">Choose faculty identity</option>{catalog.faculty.map(f=><option value={f.id} key={f.id}>{f.displayName}</option>)}</select></label><button className="button" disabled={busy||!manager} onClick={()=>void run(async()=>{const d=await setupApi.write<SetupDetail>(`/offerings/${offeringId}/managers`,{facultyId:manager});if(alive.current)accept(d);})}>Grant this offering only</button></>:null}</details>
      {!detail.canOpenActivities?<p>Your account manages setup. Assigned instructors can author and evaluate; setup alone gives you an operational handoff view.</p>:null}<div className="setup-actions"><button className="button button--primary" disabled={busy||(!locked&&detail.issues.length>0)} onClick={()=>void run(async()=>{if(!locked){const d=await setupApi.write<SetupDetail>(`/offerings/${offeringId}/ready`,{expectedRevision:detail.revision});if(alive.current)accept(d);}await openActivities();})}>{locked?"Open activities":"Mark ready and open activities"}</button></div>
    </section>:null}
    {handoff?<CredentialHandoff key={handoff.id} name={handoff.displayName} onClose={()=>setHandoff(null)} issue={()=>setupApi.write<Handoff>(`/accounts/${handoff.id}/activation`,{})}/>:null}
  </main>;
}
