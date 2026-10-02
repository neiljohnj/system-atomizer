import { useState } from "react";
import { Link } from "react-router-dom";
import { request } from "../../api";
import type { User } from "../../types";

export function OwnerBootstrap({user,onRefresh}:{user:User;onRefresh:()=>Promise<unknown>}) {
  const [confirmation,setConfirmation]=useState(""),[message,setMessage]=useState(""),[busy,setBusy]=useState(false);
  return <main className="course-setup"><h1>Host-local operator grant</h1><p>For an existing installation with no owner, deliberately grant installation administration to the signed-in faculty account. Use this page directly on the host; proxy mode disables it.</p><p>{user.displayName} · identity <code>{user.id}</code></p><label>Type the exact identity above<input value={confirmation} onChange={e=>setConfirmation(e.target.value)}/></label><button className="button button--primary" disabled={busy||confirmation!==user.id||user.role!=="faculty"} onClick={()=>{setBusy(true);void request("/api/local-recovery/owner",{method:"POST",body:{confirmUserId:confirmation}}).then(async()=>{await onRefresh();setMessage("Installation owner granted. Open Set up course on the subject home.");}).catch(e=>setMessage((e as Error).message)).finally(()=>setBusy(false));}}>Grant installation administration</button><p role="status">{message}</p><Link to="/subjects">Return to subjects</Link></main>;
}
