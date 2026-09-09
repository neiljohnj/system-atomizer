import { lazy, Suspense, useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import {
  AlertTriangle, ArrowLeft, CalendarClock, Check, Copy, Download, FileArchive,
  FileCode2, Info, Pencil, Upload, X,
} from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { atomApi } from "../../api";
import { formatBytes, formatDateTime } from "../../format";
import type {
  ActivityAvailableDetail, ActivityDetail, ActivityScope, EvaluationInput,
  Role, SubjectOffering, Submission,
} from "../../types";
import { EvaluationDialog } from "../faculty/EvaluationDialog";

const RichDocumentRenderer = lazy(() => import("../authoring/RichDocumentRenderer"));

interface ActivityDetailPageProps {
  offering: SubjectOffering;
  scope: ActivityScope;
  activityId: string;
  role: Role;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}

interface PendingFile { file: File; idempotencyKey: string }

export function ActivityDetailPage({ offering, scope, activityId, role, onChanged, onError }: ActivityDetailPageProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [evaluationTarget, setEvaluationTarget] = useState<Submission | null>(null);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const backHref = `/subjects/${offering.id}/activities?${searchParams}`;

  const load = useCallback(async () => {
    try { setLoading(true); setDetail(await atomApi.activity(activityId, scope)); }
    catch (error) { onError(error instanceof Error ? error.message : "The activity could not be opened"); }
    finally { setLoading(false); }
  }, [activityId, onError, scope]);
  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="loading-panel activity-page-loading">Opening activity…</div>;
  if (!detail) return <div className="stream-empty"><AlertTriangle size={34} /><h2>Activity unavailable</h2><Link className="button" to={backHref}>Back to activities</Link></div>;

  const performFacultyAction = async (action: "duplicate" | "unpublish") => {
    try {
      setBusy(true);
      if (action === "duplicate") {
        const duplicate = await atomApi.duplicateActivity(detail.id);
        await onChanged();
        navigate(`/subjects/${offering.id}/activities/${duplicate.id}?${searchParams}`);
      } else {
        setDetail(await atomApi.unpublishActivity(detail.id, scope));
        await onChanged();
      }
    } catch (error) { onError(error instanceof Error ? error.message : "The activity could not be updated"); }
    finally { setBusy(false); }
  };

  const recordEvaluation = async (input: EvaluationInput) => {
    if (!evaluationTarget) return;
    try { setBusy(true); setDetail(await atomApi.recordEvaluation(evaluationTarget.id, input, scope)); setEvaluationTarget(null); await onChanged(); }
    catch (error) { onError(error instanceof Error ? error.message : "The evaluation could not be recorded"); }
    finally { setBusy(false); }
  };

  if (role === "student" && !detail.contentAvailable) {
    return <article className="locked-activity-page"><Link className="all-subjects-link" to={backHref}><ArrowLeft size={16} />Back to activities</Link><div className="locked-activity-page__body"><CalendarClock size={42} /><span>{detail.topic?.title ?? "No topic"}</span><h1>{detail.title}</h1><p>This activity’s instructions and teaching files become available when it opens.</p><dl><div><dt>Opening</dt><dd>{formatDateTime(detail.opensAt)}</dd></div><div><dt>Deadline</dt><dd>{formatDateTime(detail.deadlineAt)}</dd></div><div><dt>Groups</dt><dd>{detail.publishedScope.map((group) => group.label).join(" · ")}</dd></div></dl></div></article>;
  }

  const available = detail as ActivityAvailableDetail;
  return <main className={`activity-page activity-page--${role}`}>
    <header className="activity-page__header">
      <Link className="all-subjects-link" to={backHref}><ArrowLeft size={16} />Back to activities</Link>
      <div className="activity-page__identity"><span>{available.topic?.title ?? "No topic"}</span><h1>{available.title}</h1><div><span className={`status status--${available.status}`}>{available.status === "published" ? "Published" : "Draft"}</span>{available.releaseVersion ? <span>Release {available.releaseVersion}</span> : null}<span>{available.scheduleState === "scheduled" ? "Scheduled" : available.scheduleState === "open" ? "Open" : "Closed"}</span></div></div>
      <dl className="activity-page__schedule"><div><dt>Opens</dt><dd>{formatDateTime(available.opensAt)}</dd></div><div><dt>Deadline</dt><dd>{formatDateTime(available.deadlineAt)}</dd></div></dl>
      {role === "faculty" ? <div className="activity-page__actions">{available.permissions?.canEdit ? <Link className="button button--primary" to={`/subjects/${offering.id}/activities/${available.id}/edit?${searchParams}`}><Pencil size={15} />Edit</Link> : null}<button className="button" disabled={busy} onClick={() => void performFacultyAction("duplicate")}><Copy size={15} />Duplicate</button>{available.status === "published" && available.permissions?.canPublish ? <button className="button" disabled={busy} onClick={() => void performFacultyAction("unpublish")}>Unpublish</button> : null}</div> : null}
    </header>

    {role === "faculty" ? <FacultyActivityBody detail={available} busy={busy} onEvaluate={setEvaluationTarget} onError={onError} /> : <StudentActivityBody detail={available} pending={pending} setPending={setPending} inputRef={inputRef} busy={busy} setBusy={setBusy} onChanged={async (updated) => { setDetail(updated); await onChanged(); }} onError={onError} />}
    {evaluationTarget ? <EvaluationDialog submission={evaluationTarget} busy={busy} onCancel={() => setEvaluationTarget(null)} onSubmit={recordEvaluation} /> : null}
  </main>;
}

function FacultyActivityBody({ detail, busy, onEvaluate, onError }: { detail: ActivityAvailableDetail; busy: boolean; onEvaluate: (submission: Submission) => void; onError: (message: string) => void }) {
  return <div className="faculty-activity-page">
    <article className="activity-document-panel"><div className="activity-scope-line"><div><span>Draft groups</span><strong>{detail.targetGroups.map((group) => group.label).join(" · ")}</strong></div>{detail.publishedScope.length ? <div><span>Published groups</span><strong>{detail.publishedScope.map((group) => group.label).join(" · ")}</strong></div> : null}<div><span>Accepted submissions</span><strong>{detail.acceptedExtensions.join(" or ")} · {formatBytes(detail.maxBytes)}</strong></div></div><Suspense fallback={<div className="loading-panel">Rendering activity…</div>}><RichDocumentRenderer document={detail.contentDocument} blueprint={detail.blueprint} /></Suspense>{detail.assets.length ? <section className="detail-assets"><h2>Teaching files</h2>{detail.assets.map((asset) => <button className="file-link" key={asset.id} onClick={() => void atomApi.downloadActivityAsset(asset).catch((error) => onError(error.message))}><Download size={14} />{asset.originalFilename}</button>)}</section> : null}</article>
    <aside className="activity-submission-summary"><header><span>Submissions</span><strong>{detail.submissionCount}</strong><small>of {detail.studentCount} students</small></header>{detail.submissions?.length ? <div className="submission-list">{detail.submissions.map((submission) => <article key={submission.id}><div><strong>{submission.studentNumber}</strong><span>{submission.studentName}</span></div><button className="file-link" onClick={() => void atomApi.downloadSubmission(submission.id, submission.normalizedFilename).catch((error) => onError(error.message))}><Download size={14} />{submission.normalizedFilename}</button><span>{formatDateTime(submission.receivedAt)}</span>{submission.evaluation ? <button className="evaluation-complete" disabled={busy} onClick={() => onEvaluate(submission)}><Check size={14} />{submission.evaluation.score} points</button> : <button className="button button--small" disabled={busy} onClick={() => onEvaluate(submission)}>Record evaluation</button>}</article>)}</div> : <div className="inline-empty"><CalendarClock size={22} /><p>No fully received submissions yet.</p></div>}</aside>
  </div>;
}

function StudentActivityBody({ detail, pending, setPending, inputRef, busy, setBusy, onChanged, onError }: { detail: ActivityAvailableDetail; pending: PendingFile | null; setPending: (value: PendingFile | null) => void; inputRef: React.RefObject<HTMLInputElement | null>; busy: boolean; setBusy: (value: boolean) => void; onChanged: (detail: ActivityDetail) => Promise<void>; onError: (message: string) => void }) {
  const [completedThroughPartId, setCompletedThroughPartId] = useState("");
  const requiresPart = detail.blueprint.mode === "progressive";
  const selectFile = (file: File | undefined) => {
    if (!file) return;
    const extension = `.${file.name.split(".").pop()?.toLowerCase()}`;
    if (!detail.acceptedExtensions.includes(extension)) { onError(`This activity accepts ${detail.acceptedExtensions.join(" or ")}`); return; }
    setPending({ file, idempotencyKey: crypto.randomUUID() });
  };
  const upload = async () => {
    if (!pending || (requiresPart && !completedThroughPartId)) return;
    try {
      setBusy(true);
      const updated = await atomApi.uploadSubmission(detail.id, pending.file, pending.idempotencyKey, completedThroughPartId || undefined);
      setPending(null);
      if (inputRef.current) inputRef.current.value = "";
      await onChanged(updated);
    } catch (error) { onError(error instanceof Error ? error.message : "The upload could not be completed"); }
    finally { setBusy(false); }
  };
  const current = detail.currentSubmission;
  return <div className="student-activity-page">
    <article className="activity-document-panel">
      <div className="group-chip-row">{detail.publishedScope.map((group) => <span className="group-chip" key={group.id}>{group.label}</span>)}</div>
      <Suspense fallback={<div className="loading-panel">Rendering activity…</div>}><RichDocumentRenderer document={detail.contentDocument} blueprint={detail.blueprint} /></Suspense>
      {detail.assets.length ? <section className="detail-assets"><h2>Teaching files</h2>{detail.assets.map((asset) => <button className="file-link" key={asset.id} onClick={() => void atomApi.downloadActivityAsset(asset).catch((error) => onError(error.message))}><Download size={14} />{asset.originalFilename}</button>)}</section> : null}
    </article>
    <aside className="submission-panel submission-panel--page">
      <h2>Submit your work</h2>
      {requiresPart ? <label className="completed-through"><span>Completed through</span><select value={completedThroughPartId} onChange={(event) => setCompletedThroughPartId(event.target.value)}><option value="">Select a part before uploading</option>{detail.blueprint.parts.map((part) => <option value={part.id} key={part.id}>{part.shortLabel} — {part.title}</option>)}</select></label> : null}
      {detail.scheduleState === "open" ? <>
        <div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFile(event.dataTransfer.files[0]); }} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}><Upload size={35} /><strong>Drag and drop your file here</strong><span>Accepted types: {detail.acceptedExtensions.join(" or ")}</span><button className="button" type="button">Select file</button><input ref={inputRef} className="sr-only" type="file" accept={detail.acceptedExtensions.join(",")} onChange={(event) => selectFile(event.target.files?.[0])} /></div>
        {pending ? <div className="selected-file">{pending.file.name.toLowerCase().endsWith(".zip") ? <FileArchive size={21} /> : <FileCode2 size={21} />}<div><strong>{pending.file.name}</strong><span>{formatBytes(pending.file.size)}</span></div><button className="icon-button" onClick={() => setPending(null)} aria-label="Remove selected file"><X size={17} /></button></div> : null}
        <p className="upload-limit">Maximum file size: {formatBytes(detail.maxBytes)}</p>
        <button className="button button--primary button--wide" disabled={!pending || busy || (requiresPart && !completedThroughPartId)} onClick={() => void upload()}><Upload size={17} />{busy ? "Receiving submission…" : "Upload submission"}</button>
      </> : <div className="submission-closed"><CalendarClock size={22} /><strong>Submissions are closed</strong><span>The deadline was {formatDateTime(detail.deadlineAt)}.</span></div>}
      <section className="current-submission-section"><h3>Current submission <small>most recent fully received</small></h3>{current ? <div className="submission-receipt"><div className="receipt-check"><Check size={20} /></div><dl><div><dt>File</dt><dd>{current.normalizedFilename}</dd></div>{current.completedThroughPartId ? <div><dt>Completed through</dt><dd>{detail.blueprint.parts.find((part) => part.id === current.completedThroughPartId)?.shortLabel ?? current.completedThroughPartId}</dd></div> : null}<div><dt>Received</dt><dd>{formatDateTime(current.receivedAt)}</dd></div><div><dt>Size</dt><dd>{formatBytes(current.sizeBytes)}</dd></div><div><dt>SHA-256</dt><dd><code>{current.sha256.slice(0, 12)}…</code></dd></div></dl><ValidationSummary submission={current} /><button className="button" onClick={() => void atomApi.downloadSubmission(current.id, current.normalizedFilename).catch((error) => onError(error.message))}><Download size={15} />Download</button></div> : <div className="submission-empty">No fully received submission yet.</div>}</section>
      <section className="history-section"><h3>Upload history</h3>{detail.submissionHistory?.length ? <table className="history-table"><thead><tr><th>Received</th><th>File</th><th>Claim</th><th>Status</th></tr></thead><tbody>{detail.submissionHistory.map((submission) => <tr key={submission.id}><td>{formatDateTime(submission.receivedAt)}</td><td>{submission.normalizedFilename}</td><td>{detail.blueprint.parts.find((part) => part.id === submission.completedThroughPartId)?.shortLabel ?? "—"}</td><td><span className="received-state"><Check size={13} />{submission.isCurrentSubmission ? "Current" : "Received"}</span></td></tr>)}</tbody></table> : <p className="history-empty">Your successful uploads will appear here.</p>}<div className="receipt-rule"><Info size={17} /><span>Only fully received files count. Failed, interrupted, or strictly rejected uploads never replace your current submission.</span></div></section>
    </aside>
  </div>;
}

function ValidationSummary({ submission }: { submission: Submission }) {
  const report = submission.validationReport;
  if (!report || report.mode === "descriptive") return null;
  const discrepancies = [...report.missing, ...report.unexpected, ...report.invalid];
  return <div className={`validation-summary${report.valid ? " is-valid" : " has-warning"}`}><strong>{report.valid ? "Submission requirements matched" : "Accepted with discrepancies"}</strong>{report.matched.length ? <span>{report.matched.length} requirement{report.matched.length === 1 ? "" : "s"} matched</span> : null}{discrepancies.length ? <ul>{discrepancies.map((item) => <li key={item}>{item}</li>)}</ul> : null}</div>;
}

function LegacyStudentActivityBody({ detail, pending, setPending, inputRef, busy, setBusy, onChanged, onError }: { detail: ActivityAvailableDetail; pending: PendingFile | null; setPending: (value: PendingFile | null) => void; inputRef: React.RefObject<HTMLInputElement | null>; busy: boolean; setBusy: (value: boolean) => void; onChanged: (detail: ActivityDetail) => Promise<void>; onError: (message: string) => void }) {
  const [completedThroughPartId, setCompletedThroughPartId] = useState("");
  const selectFile = (file: File | undefined) => { if (!file) return; const extension = `.${file.name.split(".").pop()?.toLowerCase()}`; if (!detail.acceptedExtensions.includes(extension)) { onError(`This activity accepts ${detail.acceptedExtensions.join(" or ")}`); return; } setPending({ file, idempotencyKey: crypto.randomUUID() }); };
  const drop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); selectFile(event.dataTransfer.files[0]); };
  const upload = async () => { if (!pending) return; try { setBusy(true); const updated = await atomApi.uploadSubmission(detail.id, pending.file, pending.idempotencyKey, completedThroughPartId || undefined); setPending(null); if (inputRef.current) inputRef.current.value = ""; await onChanged(updated); } catch (error) { onError(error instanceof Error ? error.message : "The upload could not be completed"); } finally { setBusy(false); } };
  const canUpload = detail.scheduleState === "open";
  return <div className="student-activity-page"><article className="activity-document-panel"><div className="group-chip-row">{detail.publishedScope.map((group) => <span className="group-chip" key={group.id}>{group.label}</span>)}</div><Suspense fallback={<div className="loading-panel">Rendering activity…</div>}><RichDocumentRenderer document={detail.contentDocument} /></Suspense>{detail.assets.length ? <section className="detail-assets"><h2>Teaching files</h2>{detail.assets.map((asset) => <button className="file-link" key={asset.id} onClick={() => void atomApi.downloadActivityAsset(asset).catch((error) => onError(error.message))}><Download size={14} />{asset.originalFilename}</button>)}</section> : null}</article><aside className="submission-panel submission-panel--page"><h2>Submit your work</h2>{canUpload ? <><div className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={drop} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}><Upload size={35} /><strong>Drag and drop your file here</strong><span>Accepted types: {detail.acceptedExtensions.join(" or ")}</span><button className="button" type="button">Select file</button><input ref={inputRef} className="sr-only" type="file" accept={detail.acceptedExtensions.join(",")} onChange={(event) => selectFile(event.target.files?.[0])} /></div>{pending ? <div className="selected-file">{pending.file.name.toLowerCase().endsWith(".zip") ? <FileArchive size={21} /> : <FileCode2 size={21} />}<div><strong>{pending.file.name}</strong><span>{formatBytes(pending.file.size)}</span></div><button className="icon-button" onClick={() => setPending(null)} aria-label="Remove selected file"><X size={17} /></button></div> : null}<p className="upload-limit">Maximum file size: {formatBytes(detail.maxBytes)}</p><button className="button button--primary button--wide" disabled={!pending || busy} onClick={() => void upload()}><Upload size={17} />{busy ? "Receiving submission…" : "Upload submission"}</button></> : <div className="submission-closed"><CalendarClock size={22} /><strong>Submissions are closed</strong><span>The deadline was {formatDateTime(detail.deadlineAt)}.</span></div>}<section className="current-submission-section"><h3>Current submission <small>most recent fully received</small></h3>{detail.currentSubmission ? <div className="submission-receipt"><div className="receipt-check"><Check size={20} /></div><dl><div><dt>File</dt><dd>{detail.currentSubmission.normalizedFilename}</dd></div><div><dt>Received</dt><dd>{formatDateTime(detail.currentSubmission.receivedAt)}</dd></div><div><dt>Size</dt><dd>{formatBytes(detail.currentSubmission.sizeBytes)}</dd></div><div><dt>SHA-256</dt><dd><code>{detail.currentSubmission.sha256.slice(0, 12)}…</code></dd></div></dl><button className="button" onClick={() => void atomApi.downloadSubmission(detail.currentSubmission!.id, detail.currentSubmission!.normalizedFilename).catch((error) => onError(error.message))}><Download size={15} />Download</button></div> : <div className="submission-empty">No fully received submission yet.</div>}</section><section className="history-section"><h3>Upload history</h3>{detail.submissionHistory?.length ? <table className="history-table"><thead><tr><th>Received</th><th>File</th><th>Size</th><th>Status</th></tr></thead><tbody>{detail.submissionHistory.map((submission) => <tr key={submission.id}><td>{formatDateTime(submission.receivedAt)}</td><td>{submission.normalizedFilename}</td><td>{formatBytes(submission.sizeBytes)}</td><td><span className="received-state"><Check size={13} />{submission.isCurrentSubmission ? "Current" : "Received"}</span></td></tr>)}</tbody></table> : <p className="history-empty">Your successful uploads will appear here.</p>}<div className="receipt-rule"><Info size={17} /><span>Only fully received files count. Failed or interrupted transfers never replace your current submission.</span></div></section></aside></div>;
}
