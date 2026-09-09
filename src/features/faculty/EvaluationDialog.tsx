import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import type { EvaluationInput, Submission } from "../../types";

interface EvaluationDialogProps {
  submission: Submission;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: EvaluationInput) => Promise<void>;
}

export function EvaluationDialog({ submission, busy, onCancel, onSubmit }: EvaluationDialogProps) {
  const returnFocus = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const [score, setScore] = useState(String(submission.evaluation?.score ?? ""));
  const [manualDeduction, setManualDeduction] = useState(String(submission.evaluation?.manualDeduction ?? 0));
  const [comments, setComments] = useState(submission.evaluation?.comments ?? "");
  const [annotations, setAnnotations] = useState(submission.evaluation?.annotations ?? "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({ score: Number(score), manualDeduction: Number(manualDeduction), comments, annotations });
  };

  const close = () => {
    const element = returnFocus.current;
    onCancel();
    requestAnimationFrame(() => element?.focus());
  };

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop" />
        <Dialog.Content className="modal modal--compact">
          <header className="modal__header">
            <div>
              <Dialog.Title>Record evaluation</Dialog.Title>
              <Dialog.Description>
                {submission.studentNumber} · {submission.studentName}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild><button className="icon-button" type="button" aria-label="Close"><X size={20} /></button></Dialog.Close>
          </header>
          <form className="form-stack" onSubmit={(event) => void submit(event)}>
            <div className="form-grid">
              <label><span>Total score</span><input type="number" min="0" step="0.01" required value={score} onChange={(event) => setScore(event.target.value)} /></label>
              <label><span>Manual deduction</span><input type="number" min="0" step="0.01" required value={manualDeduction} onChange={(event) => setManualDeduction(event.target.value)} /></label>
            </div>
            <label><span>Comment</span><textarea rows={4} value={comments} onChange={(event) => setComments(event.target.value)} /></label>
            <label><span>Annotations</span><textarea rows={4} value={annotations} onChange={(event) => setAnnotations(event.target.value)} /></label>
            <footer className="modal__actions">
              <Dialog.Close asChild><button type="button" className="button">Cancel</button></Dialog.Close>
              <button type="submit" className="button button--primary" disabled={busy}>{busy ? "Recording…" : "Record evaluation"}</button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
