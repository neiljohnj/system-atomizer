import { lazy, Suspense, useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { CalendarClock, Check, Download, FileArchive, FileCode2, Info, Upload, X } from "lucide-react";
import { atomApi } from "../../api";
import { formatBytes, formatDateTime } from "../../format";
import type { ActivityAvailableDetail, ActivityScope, ActivitySummary, SubjectOffering } from "../../types";

const RichDocumentRenderer = lazy(() => import("../authoring/RichDocumentRenderer"));

interface StudentWorkspaceProps {
  offering: SubjectOffering;
  scope: ActivityScope;
  activities: ActivitySummary[];
  selectedId?: string;
  loading: boolean;
  onSelect: (activityId: string) => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}

interface PendingFile { file: File; idempotencyKey: string }

export function StudentWorkspace({
  scope,
  activities,
  selectedId,
  loading,
  onSelect,
  onChanged,
  onError,
}: StudentWorkspaceProps) {
  const effectiveSelectedId = selectedId && activities.some((activity) => activity.id === selectedId)
    ? selectedId
    : activities[0]?.id;
  const [detail, setDetail] = useState<ActivityAvailableDetail | null>(null);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadDetail = useCallback(async (activityId: string) => {
    try {
      const loaded = await atomApi.activity(activityId, scope);
      if (!loaded.contentAvailable) throw new Error("This activity is not open yet");
      setDetail(loaded);
    } catch (error) {
      setDetail(null);
      onError(error instanceof Error ? error.message : "Could not load the activity");
    }
  }, [onError, scope]);

  useEffect(() => {
    setPending(null);
    if (!effectiveSelectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(effectiveSelectedId);
  }, [effectiveSelectedId, loadDetail]);

  const selectFile = (file: File | undefined) => {
    if (!file) return;
    const extension = `.${file.name.split(".").pop()?.toLowerCase()}`;
    if (!detail?.acceptedExtensions.includes(extension)) {
      onError(`This activity accepts ${detail?.acceptedExtensions.join(" or ") ?? "the configured file types"}`);
      return;
    }
    setPending({ file, idempotencyKey: crypto.randomUUID() });
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    selectFile(event.dataTransfer.files[0]);
  };

  const uploadSubmission = async () => {
    if (!detail || !pending) return;
    try {
      setUploading(true);
      const updated = await atomApi.uploadSubmission(detail.id, pending.file, pending.idempotencyKey);
      if (!updated.contentAvailable) throw new Error("This activity is not open yet");
      setDetail(updated);
      setPending(null);
      if (inputRef.current) inputRef.current.value = "";
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "The upload could not be completed");
    } finally {
      setUploading(false);
    }
  };

  if (loading) return <div className="loading-panel">Loading published activities…</div>;
  if (!activities.length) {
    return <section className="student-empty"><CalendarClock size={38} /><h1>No published laboratory activities</h1><p>Your instructor has not published an activity for these groups and this grading period.</p></section>;
  }

  return (
    <div className="student-layout">
      <aside className="student-activity-rail">
        <header><h2>Activities</h2><span>{activities.length} published</span></header>
        <nav aria-label="Published activities">
          {activities.map((activity) => (
            <button key={activity.id} className={activity.id === effectiveSelectedId ? "student-activity is-selected" : "student-activity"} onClick={() => onSelect(activity.id)}>
              <strong>{activity.title}</strong>
              <span>{activity.publishedScope.map((group) => group.label).join(" · ")}</span>
              <span>Due {formatDateTime(activity.deadlineAt)}</span>
            </button>
          ))}
        </nav>
        <p className="rail-note">Only published activities assigned to your placements appear here.</p>
      </aside>

      {detail ? (
        <>
          <article className="activity-reading">
            <header className="student-title-row">
              <div><div className="group-chip-row">{detail.publishedScope.map((group) => <span className="group-chip" key={group.id}>{group.label}</span>)}</div><h1>{detail.title}</h1></div>
              <dl><div><dt>Opening</dt><dd>{formatDateTime(detail.opensAt)}</dd></div><div><dt>Deadline</dt><dd>{formatDateTime(detail.deadlineAt)}</dd></div></dl>
            </header>
            <Suspense fallback={<div className="loading-panel">Rendering activity…</div>}><RichDocumentRenderer document={detail.contentDocument} /></Suspense>
          </article>

          <aside className="submission-panel">
            <h2>Submit your work</h2>
            <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={drop} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}>
              <Upload size={35} /><strong>Drag and drop your file here</strong><span>Accepted types: {detail.acceptedExtensions.join(" or ")}</span><button className="button" type="button">Select file</button>
              <input ref={inputRef} className="sr-only" type="file" accept={detail.acceptedExtensions.join(",")} onChange={(event) => selectFile(event.target.files?.[0])} />
            </div>
            {pending ? <div className="selected-file">{pending.file.name.toLowerCase().endsWith(".zip") ? <FileArchive size={21} /> : <FileCode2 size={21} />}<div><strong>{pending.file.name}</strong><span>{formatBytes(pending.file.size)}</span></div><button className="icon-button" onClick={() => setPending(null)} aria-label="Remove selected file"><X size={17} /></button></div> : null}
            <p className="upload-limit">Maximum file size: {formatBytes(detail.maxBytes)} · revision limits apply</p>
            <button className="button button--primary button--wide" disabled={!pending || uploading} onClick={() => void uploadSubmission()}><Upload size={17} />{uploading ? "Receiving submission…" : "Upload submission"}</button>

            <section className="current-submission-section">
              <h3>Current submission <small>most recent fully received</small></h3>
              {detail.currentSubmission ? (
                <div className="submission-receipt"><div className="receipt-check"><Check size={20} /></div><dl><div><dt>File</dt><dd>{detail.currentSubmission.normalizedFilename}</dd></div><div><dt>Received</dt><dd>{formatDateTime(detail.currentSubmission.receivedAt)}</dd></div><div><dt>Size</dt><dd>{formatBytes(detail.currentSubmission.sizeBytes)}</dd></div><div><dt>SHA-256</dt><dd><code>{detail.currentSubmission.sha256.slice(0, 12)}…</code></dd></div></dl><button className="button" onClick={() => void atomApi.downloadSubmission(detail.currentSubmission!.id, detail.currentSubmission!.normalizedFilename).catch((error) => onError(error.message))}><Download size={15} />Download</button></div>
              ) : <div className="submission-empty">No fully received submission yet.</div>}
            </section>

            <section className="history-section">
              <h3>Upload history</h3>
              {detail.submissionHistory?.length ? <table className="history-table"><thead><tr><th>Received</th><th>File</th><th>Size</th><th>Status</th></tr></thead><tbody>{detail.submissionHistory.map((submission) => <tr key={submission.id}><td>{formatDateTime(submission.receivedAt)}</td><td>{submission.normalizedFilename}</td><td>{formatBytes(submission.sizeBytes)}</td><td><span className="received-state"><Check size={13} />{submission.isCurrentSubmission ? "Current" : "Received"}</span></td></tr>)}</tbody></table> : <p className="history-empty">Your successful uploads will appear here.</p>}
              <div className="receipt-rule"><Info size={17} /><span>Only fully received files count. Failed or interrupted transfers never replace your current submission.</span></div>
            </section>
          </aside>
        </>
      ) : null}
    </div>
  );
}
