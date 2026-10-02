import { KeyRound, UsersRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { atomApi } from "../../api";
import type { ManagedStudent, SubjectOffering } from "../../types";
import { CredentialHandoff } from "../setup/CredentialHandoff";

export function StudentAccess({ offering, onError }: { offering: SubjectOffering; onError: (message: string) => void }) {
  const [students,setStudents]=useState<ManagedStudent[]>([]),[loading,setLoading]=useState(true);
  const [target,setTarget]=useState<ManagedStudent|null>(null);
  const alive=useRef(true);
  const load=async()=>{
    try {setLoading(true);const rows=await atomApi.managedStudents(offering.id);if(alive.current)setStudents(rows);}
    catch(error){if(alive.current)onError((error as Error).message);}
    finally{if(alive.current)setLoading(false);}
  };
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[offering.id]);
  return <section className="student-access-page">
    <header className="page-heading"><div><p>Account access</p><h1>Students in your teaching groups</h1><span>Credential reissue revokes sessions and requires a new password after single-use activation.</span></div><UsersRound size={32}/></header>
    {offering.configurationLocked?<p className="setup-lock">Instructional membership is permanently locked after first publication. Credential recovery remains available; it does not change placements.</p>:null}
    {loading?<div className="loading-panel">Loading student accounts…</div>:<div className="activity-table-wrap"><table className="data-table student-access-table"><thead><tr><th>Student</th><th>Your shared groups</th><th>Account state</th><th>Action</th></tr></thead><tbody>{students.map(student=><tr key={student.id}><td><strong>{student.studentNumber}</strong><small>{student.displayName}</small></td><td>{student.groups.map(g=>g.label).join(" · ")}</td><td>{student.activationState.replaceAll("_"," ")}</td><td><button className="button button--small" onClick={()=>setTarget(student)}><KeyRound size={14}/>Private credential hand-off</button></td></tr>)}</tbody></table></div>}
    {!loading&&!students.length?<div className="empty-state"><h2>No students in your assigned groups</h2></div>:null}
    {target?<CredentialHandoff key={target.id} name={`${target.studentNumber} · ${target.displayName}`} onClose={()=>setTarget(null)} onIssued={()=>void load()} issue={()=>atomApi.resetStudentPassword(offering.id,target.id)}/>:null}
  </section>;
}
