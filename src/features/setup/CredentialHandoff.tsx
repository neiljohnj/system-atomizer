import * as Dialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import type { CredentialHandoff as Handoff } from "./setup-api";

export function CredentialHandoff({name,issue,onClose,onIssued}:{name:string;issue:()=>Promise<Handoff>;onClose:()=>void;onIssued?:()=>void}) {
  const [handoff,setHandoff]=useState<Handoff|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false),[reveal,setReveal]=useState(false);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;return ()=>{alive.current=false;};},[]);
  const run=async()=>{setBusy(true);setError("");try{const result=await issue();if(alive.current){setHandoff(result);onIssued?.();}}catch(e){if(alive.current)setError((e as Error).message);}finally{if(alive.current)setBusy(false);}};
  return <Dialog.Root open onOpenChange={open=>{if(!open)onClose();}}><Dialog.Portal><Dialog.Overlay className="modal-backdrop"/><Dialog.Content className="modal modal--small credential-handoff">
    <Dialog.Title>Private credential hand-off</Dialog.Title><Dialog.Description>{name}. Verify the recipient in person or through an established trusted process. Issuing access does not prove identity.</Dialog.Description>
    {handoff ? <><p>This secret is shown once here. Closing discards it. If lost, reissue it.</p><p>Identifier: <strong>{handoff.identifier}</strong></p><label>Single-use activation password<input readOnly autoComplete="off" type={reveal?"text":"password"} value={handoff.temporaryPassword}/></label><label className="setup-check"><input type="checkbox" checked={reveal} onChange={e=>setReveal(e.target.checked)}/>Reveal for verified hand-off</label><p>Expires {new Date(handoff.expiresAt).toLocaleString()}. First sign-in requires a new password.</p></> : <p>Issue a random activation password valid for 48 hours. This invalidates earlier activation and all current sessions. The secret is never recoverable from ATOM.</p>}
    {error?<p role="alert" className="form-error">{error}</p>:null}<footer className="modal__actions"><button className="button" onClick={onClose}>{handoff?"Close and discard secret":"Cancel"}</button>{!handoff?<button className="button button--primary" disabled={busy} onClick={()=>void run()}>{busy?"Issuing…":"Issue activation"}</button>:null}</footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
