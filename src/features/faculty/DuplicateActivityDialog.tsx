import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { atomApi } from "../../api";
import type { ActivityDetail, ActivitySummary, SubjectOffering } from "../../types";

export function DuplicateActivityDialog({ activity, offering, onClose, onCreated }: {
  activity: ActivitySummary; offering: SubjectOffering; onClose: () => void;
  onCreated: (activity: ActivityDetail) => Promise<void>;
}) {
  const [selected, setSelected] = useState(() => activity.targetGroups.map(group => group.id));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = [...activity.targetGroups, ...offering.groups.filter(group => !activity.targetGroups.some(source => source.id === group.id))];
  const duplicate = async () => {
    setBusy(true); setError("");
    try {
      const created = await atomApi.duplicateActivity(activity.id, selected);
      await onCreated(created);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The activity could not be duplicated"); }
    finally { setBusy(false); }
  };
  return <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose(); }}><Dialog.Portal>
    <Dialog.Overlay className="modal-backdrop" /><Dialog.Content className="modal modal--compact">
      <header className="modal__header"><div><Dialog.Title>Duplicate activity</Dialog.Title>
        <Dialog.Description>Create a draft copy. Review every destination before continuing.</Dialog.Description></div></header>
      <div className="duplicate-dialog__body"><dl className="publish-review"><div><dt>Activity</dt><dd>{activity.title}</dd></div>
        <div><dt>Period</dt><dd>{activity.gradingPeriod === "midterm" ? "Midterm" : "Final Term"}</dd></div></dl>
      <fieldset disabled={busy}><legend>Destination groups</legend>{groups.map(group => <label className="duplicate-destination" key={group.id}>
        <input type="checkbox" checked={selected.includes(group.id)} onChange={event => setSelected(current => event.target.checked ? [...current, group.id] : current.filter(id => id !== group.id))} />
        <span>{group.label}{!offering.groups.some(assigned => assigned.id === group.id) ? " (not assigned to you)" : ""}</span>
      </label>)}</fieldset>
      {error ? <p className="publish-warning" role="alert">{error}</p> : null}
      <footer className="modal__actions"><button className="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="button button--primary" disabled={busy || !selected.length} onClick={() => void duplicate()}>{busy ? "Duplicating…" : "Create draft copy"}</button></footer></div>
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
