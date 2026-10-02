import { useEffect, useRef, useState } from "react";
import { newIdentifier } from "../../identifier";
import { CredentialHandoff } from "./CredentialHandoff";
import { setupApi, type CredentialHandoff as Handoff, type RosterInput, type RosterPreview, type RosterRow, type SetupDetail } from "./setup-api";

export function RosterWorkbench({detail,onSaved,onContinue}:{detail:SetupDetail;onSaved:(d:SetupDetail)=>void;onContinue:()=>void}) {
  const [rows,setRows]=useState<RosterInput[]>([]),[preview,setPreview]=useState<RosterPreview|null>(null),[paste,setPaste]=useState("");
  const [number,setNumber]=useState(""),[name,setName]=useState(""),[placements,setPlacements]=useState<string[]>([]);
  const [filter,setFilter]=useState(""),[sort,setSort]=useState<"studentNumber"|"displayName">("studentNumber");
  const [error,setError]=useState(""),[busy,setBusy]=useState(false),[notice,setNotice]=useState("");
  const [handoff,setHandoff]=useState<RosterRow|null>(null),[editing,setEditing]=useState<RosterRow|null>(null);
  const key=useRef(newIdentifier()),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const disabled=Boolean(detail.lockedAt)||detail.state==="legacy";
  const stage=(value:RosterInput[])=>{setRows(value);setPreview(null);setNotice("");key.current=newIdentifier();};
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError("");try{await work();}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}};
  const reload=async()=>{const d=await setupApi.detail(detail.id);if(alive.current)onSaved(d);};
  const previewRows=()=>run(async()=>{const p=await setupApi.write<RosterPreview>(`/offerings/${detail.id}/roster/preview`,{rows});if(alive.current)setPreview(p);});
  const apply=()=>run(async()=>{
    await setupApi.write(`/offerings/${detail.id}/roster/apply`,{rows,previewToken:preview?.previewToken,requestKey:key.current});
    if(!alive.current)return; stage([]);setPaste("");setNotice("Roster applied to ATOM. Credentials are issued separately after identity verification.");await reload();
  });
  const parsePaste=()=>{
    setError("");const lines=paste.trim().split(/\r?\n/).filter(Boolean);
    if(!paste.trim()||lines.length>200){setError("Paste 1–200 rows without a header.");return;}
    const parsed:RosterInput[]=[];
    for(const line of lines){const cells=line.split("\t");if(cells.length!==3){setError("Each row needs three tab-separated columns: student number, full name, group labels separated by semicolons.");return;}
      parsed.push({studentNumber:cells[0],displayName:cells[1],groupIds:cells[2].split(";").map(label=>{const matches=detail.groups.filter(g=>g.label===label.trim());return matches.length===1?matches[0].id:`unknown:${label.trim()}`;})});}
    stage(parsed);
  };
  const choices=(selected:string[],change:(ids:string[])=>void)=>detail.groups.map(g=><label className="setup-check" key={g.id}><input type="checkbox" checked={selected.includes(g.id)} onChange={e=>change(e.target.checked?[...selected,g.id]:selected.filter(x=>x!==g.id))}/>{g.label} ({g.componentKind})</label>);
  const groupNames=(ids:string[])=>ids.map(id=>detail.groups.find(g=>g.id===id)?.label??id).join("; ");
  const shown=detail.roster.filter(r=>`${r.studentNumber} ${r.displayName}`.toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>String(a[sort]).localeCompare(String(b[sort])));
  return <section className="roster-workbench"><h2>Students</h2><p>Student numbers are text: trim outer spaces and uppercase letters, preserving leading zeros. Saved identities and passwords are never silently replaced.</p>
    {disabled?<p className="setup-lock" role="note">{detail.lockedAt?detail.lockMessage:"Legacy roster setup is read-only pending review."}</p>:<fieldset disabled={busy} className="setup-fields" aria-describedby={error?"roster-error":undefined}><legend>Prepare initial roster</legend>
      <div className="setup-form-grid"><label>Student number<input value={number} onChange={e=>setNumber(e.target.value)}/></label><label>Full name<input value={name} onChange={e=>setName(e.target.value)}/></label></div><fieldset><legend>Explicit placements for this student</legend>{choices(placements,setPlacements)}</fieldset><button className="button" onClick={()=>{stage([...rows,{studentNumber:number,displayName:name,groupIds:placements}]);setNumber("");setName("");setPlacements([]);}}>Add to review table</button>
      <details><summary>Paste a table (up to 200 students)</summary><label>Student number ⇥ full name ⇥ group labels<textarea rows={5} value={paste} onChange={e=>setPaste(e.target.value)} aria-describedby="paste-help"/></label><p id="paste-help" className="setup-help">Three tab-separated columns, no header. Separate multiple exact group labels with semicolons. Loading replaces the unsaved review table. Group links never auto-place students.</p><button className="button" onClick={parsePaste}>Load pasted rows for review</button></details>
      {rows.length?<><p><strong>Unsaved review table · {rows.length} rows</strong>. Preview does not enroll anyone.</p><div className="activity-table-wrap"><table className="data-table"><thead><tr><th>Number</th><th>Name</th><th>Placements</th><th>Result / issues</th><th>Action</th></tr></thead><tbody>{rows.map((r,i)=><tr key={i}><td>{r.studentNumber}</td><td>{r.displayName}</td><td>{groupNames(r.groupIds)}</td><td>{preview?<><strong>{preview.rows[i]?.action}</strong>{preview.rows[i]?.issues.map(issue=><p key={issue}>{issue}</p>)}{preview.rows[i]?.existingUserId?<label className="setup-check"><input type="checkbox" checked={Boolean(r.reuseUserId)} onChange={e=>stage(rows.map((x,n)=>n===i?{...x,reuseUserId:e.target.checked?preview.rows[i].existingUserId!:undefined}:x))}/>Confirm exact existing identity</label>:null}</>:"Not previewed"}</td><td><button className="button button--small" onClick={()=>stage(rows.filter((_,n)=>n!==i))}>Remove row {i+1}</button></td></tr>)}</tbody></table></div><div className="setup-actions"><button className="button" onClick={()=>{stage([]);setPaste("");}}>Cancel unsaved roster</button><button className={`button ${!preview?.canApply?"button--primary":""}`} onClick={()=>void previewRows()}>Preview roster</button>{preview?.canApply?<button className="button button--primary" onClick={()=>void apply()}>Apply reviewed roster</button>:null}</div></>:null}
    </fieldset>}
    {error?<p role="alert" className="form-error" id="roster-error">{error} Your entries are retained.</p>:null}{notice?<p role="status">{notice}</p>:null}
    <h3>Saved roster · {detail.roster.length} {detail.roster.length===1?"student":"students"}</h3><div className="setup-form-grid"><label>Search saved roster<input type="search" value={filter} onChange={e=>setFilter(e.target.value)}/></label><label>Sort by<select aria-label="Sort by" value={sort} onChange={e=>setSort(e.target.value as typeof sort)}><option value="studentNumber">Student number</option><option value="displayName">Name</option></select></label></div>
    <div className="activity-table-wrap"><table className="data-table"><thead><tr><th>Student number</th><th>Name</th><th>Placements</th><th>Account activation</th><th>Validation / actions</th></tr></thead><tbody>{shown.map(r=><tr key={r.id}><td>{r.studentNumber}</td><td>{r.displayName}</td><td>{groupNames(r.groupIds)}<small>{r.status}</small></td><td>{r.activationState.replaceAll("_"," ")}</td><td>{r.issues.map(issue=><p key={issue}>{issue}</p>)}<button className="button button--small" disabled={disabled||busy} onClick={()=>setEditing({...r})}>Edit placements</button><button className="button button--small" onClick={()=>setHandoff(r)}>Private hand-off</button></td></tr>)}</tbody></table></div>
    {editing?<fieldset className="setup-fields" disabled={busy||disabled}><legend>Placements · {editing.studentNumber}</legend>{choices(editing.groupIds,ids=>setEditing({...editing,groupIds:ids}))}<label>Enrollment status<select aria-label="Enrollment status" value={editing.status} onChange={e=>setEditing({...editing,status:e.target.value})}><option value="active">Active enrollment</option><option value="inactive">Inactive enrollment</option></select></label><div className="setup-actions"><button className="button" onClick={()=>setEditing(null)}>Cancel edit</button><button className="button" onClick={()=>void run(async()=>{const d=await setupApi.write<SetupDetail>(`/offerings/${detail.id}/enrollments/${editing.enrollmentId}`,{groupIds:editing.groupIds,status:editing.status,expectedRevision:detail.revision},"PUT");if(alive.current){onSaved(d);setEditing(null);}})}>Save placements</button></div></fieldset>:null}
    {!rows.length?<div className="setup-actions"><button className="button button--primary" onClick={onContinue}>Review saved setup</button></div>:null}
    {handoff?<CredentialHandoff key={handoff.id} name={`${handoff.studentNumber} · ${handoff.displayName}`} onClose={()=>setHandoff(null)} onIssued={()=>void reload()} issue={()=>setupApi.write<Handoff>(`/accounts/${handoff.id}/activation`,{offeringId:detail.id})}/>:null}
  </section>;
}
