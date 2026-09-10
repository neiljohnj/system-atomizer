import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import {
  CalendarDays,
  Check,
  Copy,
  Download,
  FileText,
  Pencil,
  Plus,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { atomApi } from "../../api";
import { formatBytes, formatDate, formatDateTime } from "../../format";
import type {
  ActivityAvailableDetail,
  ActivityDetail,
  ActivityScope,
  ActivitySummary,
  EvaluationInput,
  SubjectOffering,
  Submission,
} from "../../types";
import { EvaluationDialog } from "./EvaluationDialog";
import { DuplicateActivityDialog } from "./DuplicateActivityDialog";

const RichDocumentRenderer = lazy(() => import("../authoring/RichDocumentRenderer"));

interface FacultyWorkspaceProps {
  offering: SubjectOffering;
  scope: ActivityScope;
  module: "activities" | "submissions";
  activities: ActivitySummary[];
  selectedId?: string;
  loading: boolean;
  onSelect: (activityId: string) => void;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}

export function FacultyWorkspace({
  offering,
  scope,
  module,
  activities,
  selectedId,
  loading,
  onSelect,
  onChanged,
  onError,
}: FacultyWorkspaceProps) {
  const effectiveSelectedId = selectedId && activities.some((activity) => activity.id === selectedId)
    ? selectedId
    : activities[0]?.id;
  const [detail, setDetail] = useState<ActivityAvailableDetail | null>(null);
  const [evaluationTarget, setEvaluationTarget] = useState<Submission | null>(null);
  const [busy, setBusy] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const navigate = useNavigate();

  const loadDetail = useCallback(async (activityId: string) => {
    try {
      const loaded = await atomApi.activity(activityId, scope);
      if (!loaded.contentAvailable) throw new Error("This activity is not available to faculty");
      setDetail(loaded);
    } catch (error) {
      setDetail(null);
      onError(error instanceof Error ? error.message : "Could not load the activity");
    }
  }, [onError, scope]);

  useEffect(() => {
    if (!effectiveSelectedId) {
      setDetail(null);
      return;
    }
    void loadDetail(effectiveSelectedId);
  }, [effectiveSelectedId, loadDetail]);

  const perform = async (work: () => Promise<ActivityDetail>) => {
    try {
      setBusy(true);
      setActionError("");
      const updated = await work();
      if (!updated.contentAvailable) throw new Error("This activity is not available to faculty");
      setDetail(updated);
      await onChanged();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "ATOM could not complete the action");
      onError(error instanceof Error ? error.message : "ATOM could not complete the action");
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const recordEvaluation = async (input: EvaluationInput) => {
    if (!evaluationTarget) return;
    try {
      await perform(() => atomApi.recordEvaluation(evaluationTarget.id, input, scope));
      setEvaluationTarget(null);
    } catch (error) {
      throw error; // The dialog retains entered values and displays the rejection inline.
    }
  };

  return (
    <div className="faculty-workspace-grid">
      {actionError ? <p role="alert" className="publish-warning">{actionError}</p> : null}
      {duplicateOpen && detail ? <DuplicateActivityDialog activity={detail} offering={offering} onClose={() => setDuplicateOpen(false)} onCreated={async created => { await onChanged(); navigate(`/subjects/${offering.id}/activities/${created.id}?group=all&period=${created.gradingPeriod}`); }} /> : null}
      <section className="activity-index">
        <header className="section-header">
          <div>
            <p>{scope.gradingPeriod === "midterm" ? "Midterm" : "Final Term"}</p>
            <h1>{module === "submissions" ? "Submission review" : "Laboratory activities"}</h1>
            <span>{scope.teachingGroupId === "all" ? "All assigned groups" : offering.groups.find((group) => group.id === scope.teachingGroupId)?.label}</span>
          </div>
          {module === "activities" ? (
            <button className="button button--primary" onClick={() => navigate(`/subjects/${offering.id}/activities/new?group=${scope.teachingGroupId}&period=${scope.gradingPeriod}`)}><Plus size={17} />New activity</button>
          ) : null}
        </header>

        {loading ? (
          <div className="loading-panel">Loading activities…</div>
        ) : activities.length ? (
          <div className="activity-table-wrap">
            <table className="data-table activity-table">
              <thead><tr><th>Activity</th><th>Status</th><th>Groups</th><th>{module === "submissions" ? "Received" : "Deadline"}</th></tr></thead>
              <tbody>
                {activities.map((activity) => (
                  <tr key={activity.id} className={activity.id === effectiveSelectedId ? "is-selected" : ""}>
                    <td><button className="table-row-button" onClick={() => onSelect(activity.id)}>{activity.title}<small>Opens {formatDate(activity.opensAt)}</small></button></td>
                    <td><Status state={activity.status} /></td>
                    <td><GroupLabels groups={activity.targetGroups.map((group) => group.label)} /></td>
                    <td>{module === "submissions" ? `${activity.submissionCount} / ${activity.studentCount}` : formatDate(activity.deadlineAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">
            <FileText size={34} />
            <h2>{module === "submissions" ? "No activities to review" : "No activities in this scope"}</h2>
            <p>{module === "submissions" ? "Published and draft activities for this group and grading period appear here." : "Create a draft or choose another teaching group or grading period."}</p>
          </div>
        )}
      </section>

      <aside className="activity-detail">
        {detail ? (
          <>
            {detail.evidenceOnly ? <p className="scope-banner">Reviewing an immutable release for your authorized submissions.</p> : null}<header className="detail-header">
              <div>
                <h2>{detail.title}</h2>
                <div className="detail-state"><Status state={detail.status} />{detail.releaseVersion ? <span>Release {detail.releaseVersion}</span> : null}</div>
              </div>
              <div className="button-group">
                {detail.status === "draft" ? (
                  <>
                    {detail.permissions?.canEdit ? <button className="button button--primary" onClick={() => navigate(`/subjects/${offering.id}/activities/${detail.id}/edit?group=${scope.teachingGroupId}&period=${scope.gradingPeriod}`)}><Pencil size={15} />Open authoring</button> : null}
                    {!detail.evidenceOnly ? <button className="button" disabled={busy} onClick={() => setDuplicateOpen(true)}><Copy size={15} />Duplicate</button> : null}
                  </>
                ) : (
                  <>{detail.permissions?.canPublish ? <button className="button" disabled={busy} onClick={() => void perform(() => atomApi.unpublishActivity(detail.id, scope)).catch(() => {})}>Unpublish</button> : null}{!detail.evidenceOnly ? <button className="button" disabled={busy} onClick={() => setDuplicateOpen(true)}><Copy size={15} />Duplicate</button> : null}</>
                )}
              </div>
            </header>

            <div className="scope-banner">
              <div><span>Draft scope</span><GroupLabels groups={detail.targetGroups.map((group) => group.label)} /></div>
              {detail.publishedScope.length ? <div><span>Published scope</span><GroupLabels groups={detail.publishedScope.map((group) => group.label)} /></div> : null}
            </div>

            <div className="detail-section detail-grid">
              <div><span className="detail-label">Activity content</span><Suspense fallback={<div className="loading-panel">Rendering activity…</div>}><RichDocumentRenderer document={detail.contentDocument} className="rich-document--compact" /></Suspense></div>
              <dl>
                <div><dt>Accepted files</dt><dd>{detail.acceptedExtensions.join(" or ")}</dd></div>
                <div><dt>Maximum size</dt><dd>{formatBytes(detail.maxBytes)}</dd></div>
                <div><dt>Opens</dt><dd>{formatDateTime(detail.opensAt)}</dd></div>
                <div><dt>Deadline</dt><dd>{formatDateTime(detail.deadlineAt)}</dd></div>
              </dl>
            </div>

            {detail.assets.length ? <div className="detail-section"><span className="detail-label">Teaching files</span><div className="asset-list asset-list--detail">{detail.assets.map((asset) => <button className="file-link" key={asset.id} onClick={() => void atomApi.downloadActivityAsset(asset).catch((error) => onError(error.message))}><Download size={14} />{asset.originalFilename}</button>)}</div></div> : null}

            <div className="detail-section submissions-section">
              <div className="subsection-heading"><div><h3>Current submissions</h3><p>{detail.submissionCount} of {detail.studentCount} students in this view</p></div></div>
              {detail.submissions?.length ? (
                <div className="submission-table-wrap">
                  <table className="data-table submission-table">
                    <thead><tr><th>Student</th><th>Submission</th><th>Received</th><th>Evaluation</th></tr></thead>
                    <tbody>{detail.submissions.map((submission) => (
                      <tr key={submission.id}>
                        <td><strong>{submission.studentNumber}</strong><small>{submission.studentName}</small></td>
                        <td><button className="file-link" onClick={() => void atomApi.downloadSubmission(submission.id, submission.normalizedFilename).catch((error) => onError(error.message))}><Download size={14} />{submission.normalizedFilename}</button></td>
                        <td>{formatDateTime(submission.receivedAt)}</td>
                        <td>{submission.evaluation ? <button className="evaluation-complete" onClick={() => setEvaluationTarget(submission)}><Check size={14} />{submission.evaluation.score} points</button> : <button className="button button--small" onClick={() => setEvaluationTarget(submission)}>Record evaluation</button>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              ) : <div className="inline-empty"><CalendarDays size={23} /><p>No fully received submissions yet.</p></div>}
            </div>
          </>
        ) : (
          <div className="empty-state"><FileText size={34} /><p>Select an activity to inspect it.</p></div>
        )}
      </aside>

      {evaluationTarget ? <EvaluationDialog submission={evaluationTarget} busy={busy} onCancel={() => setEvaluationTarget(null)} onSubmit={recordEvaluation} /> : null}
    </div>
  );
}

function Status({ state }: { state: "draft" | "published" }) {
  return <span className={`status status--${state}`}>{state === "published" ? "Published" : "Draft"}</span>;
}

function GroupLabels({ groups }: { groups: string[] }) {
  return <span className="compact-groups">{groups.join(" · ")}</span>;
}
