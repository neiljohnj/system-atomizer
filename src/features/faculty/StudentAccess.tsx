import * as Dialog from "@radix-ui/react-dialog";
import { KeyRound, ShieldCheck, UsersRound, X } from "lucide-react";
import { useEffect, useState } from "react";
import { atomApi } from "../../api";
import type { ManagedStudent, SubjectOffering } from "../../types";

export function StudentAccess({ offering, onError }: { offering: SubjectOffering; onError: (message: string) => void }) {
  const [students, setStudents] = useState<ManagedStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState<ManagedStudent | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      setStudents(await atomApi.managedStudents(offering.id));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Student accounts could not be loaded");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [offering.id]);

  const reset = async () => {
    if (!target) return;
    try {
      setBusy(true);
      await atomApi.resetStudentPassword(offering.id, target.id);
      setTarget(null);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "The password could not be reset");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="student-access-page">
      <header className="page-heading"><div><p>Account access</p><h1>Students in your teaching groups</h1><span>Password resets revoke active sessions and require a password change at the next sign-in.</span></div><UsersRound size={32} /></header>
      {loading ? <div className="loading-panel">Loading student accounts…</div> : (
        <div className="activity-table-wrap"><table className="data-table student-access-table">
          <thead><tr><th>Student</th><th>Your shared groups</th><th>Password state</th><th>Action</th></tr></thead>
          <tbody>{students.map((student) => <tr key={student.id}>
            <td><strong>{student.studentNumber}</strong><small>{student.displayName}</small></td>
            <td>{student.groups.map((group) => group.label).join(" · ")}</td>
            <td>{student.mustChangePassword ? <span className="status status--draft">Change required</span> : <span className="status status--published"><ShieldCheck size={13} />Ready</span>}</td>
            <td><button className="button button--small" onClick={() => setTarget(student)}><KeyRound size={14} />Reset password</button></td>
          </tr>)}</tbody>
        </table></div>
      )}
      {!loading && !students.length ? <div className="empty-state"><UsersRound size={32} /><h2>No students in your assigned groups</h2></div> : null}

      <Dialog.Root open={Boolean(target)} onOpenChange={(open) => { if (!open) setTarget(null); }}>
        <Dialog.Portal><Dialog.Overlay className="modal-backdrop" /><Dialog.Content className="modal modal--small">
          <header className="modal__header"><div><Dialog.Title>Reset student password?</Dialog.Title><Dialog.Description>{target?.studentNumber} · {target?.displayName}</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" aria-label="Close"><X size={19} /></button></Dialog.Close></header>
          <p>The password returns to the student number. Any active sessions are revoked, and the student must choose a new password before entering ATOM again.</p>
          <footer className="modal__actions"><Dialog.Close asChild><button className="button">Cancel</button></Dialog.Close><button className="button button--primary" disabled={busy} onClick={() => void reset()}>{busy ? "Resetting…" : "Reset password"}</button></footer>
        </Dialog.Content></Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
