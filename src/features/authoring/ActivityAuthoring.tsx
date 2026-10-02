import { newIdentifier } from "../../identifier";
import * as Checkbox from "@radix-ui/react-checkbox";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import * as Tabs from "@radix-ui/react-tabs";
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, Download, FileText, Paperclip,
  Plus, Send, Settings2, Trash2, Upload, UsersRound, X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ApiError, atomApi } from "../../api";
import { formatBytes } from "../../format";
import type {
  ActivityAsset, ActivityAvailableDetail, ActivityDetail, ActivityDocumentV1, ActivityInput, ActivitySection,
  ActivityBlueprintV1, ActivityPart, AssessmentTopic, BootstrapPayload, DraftConflict, GradingPeriod, SubjectOffering,
} from "../../types";
import { RichSectionEditor } from "./RichDocument";
import RichDocumentRenderer from "./RichDocumentRenderer";
import { clearRecovery, readRecovery, rememberRecovery, writeRecovery } from "./recoveryStore";
import { RubricDialog, SubmissionRequirementsDialog, TeachingGroupPicker } from "./StructuredAuthoringDialogs";

type SyncState = "saved" | "saving" | "device" | "memory" | "conflict";

export default function ActivityAuthoring({ bootstrap, onError }: { bootstrap: BootstrapPayload; onError: (message: string) => void }) {
  const { offeringId = "", activityId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const offering = useMemo(() => bootstrap.academicTerms.flatMap((term) => term.offerings).find((item) => item.id === offeringId), [bootstrap.academicTerms, offeringId]);
  const startedCreation = useRef(false);
  const [detail, setDetail] = useState<ActivityAvailableDetail | null>(null);
  const [topics, setTopics] = useState<AssessmentTopic[]>([]);
  const [draft, setDraft] = useState<ActivityInput | null>(null);
  const draftRef = useRef<ActivityInput | null>(null);
  const serverFingerprint = useRef("");
  const deviceFingerprint = useRef("");
  const saveInFlight = useRef(false);
  const contextGeneration = useRef(0);
  const [recoveryError, setRecoveryError] = useState("");
  const [syncState, setSyncState] = useState<SyncState>("saved");
  const [conflict, setConflict] = useState<DraftConflict | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("edit");
  const narrowViewport = useNarrowViewport(700);
  const assetInput = useRef<HTMLInputElement>(null);
  const userId = bootstrap.currentUser.id;
  const groupId = validGroupId(offering, searchParams.get("group"));
  const period: GradingPeriod = searchParams.get("period") === "final_term" ? "final_term" : "midterm";
  const scope = useMemo(() => ({ subjectOfferingId: offeringId, teachingGroupId: groupId, gradingPeriod: period }), [groupId, offeringId, period]);
  const recoveryKey = activityId ? `${userId}:${activityId}` : "";

  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("atom:draft-sync", { detail: { unsynced: syncState !== "saved", deviceSaved: syncState === "device" } }));
    return () => { window.dispatchEvent(new CustomEvent("atom:draft-sync", { detail: { unsynced: false } })); };
  }, [syncState]);

  useEffect(() => {
    if (!offering || activityId || startedCreation.current) return;
    startedCreation.current = true;
    const input = newActivityInput(offering, groupId, period, searchParams.get("topic"));
    void atomApi.createActivity(input).then((created) => {
      navigate(`/subjects/${offering.id}/activities/${created.id}/edit?${searchParams}`, { replace: true });
    }).catch((error) => {
      onError(error instanceof Error ? error.message : "The draft could not be created");
      navigate(`/subjects/${offering.id}/activities?${searchParams}`, { replace: true });
    });
  }, [activityId, groupId, navigate, offering, onError, period, searchParams]);

  const load = useCallback(async () => {
    if (!activityId) return;
    const generation = ++contextGeneration.current;
    try {
      setLoading(true);
      const [activityResponse, streamResponse] = await Promise.all([
        atomApi.activity(activityId, scope),
        atomApi.assessmentStream(scope),
      ]);
      const loaded = requireAvailableActivity(activityResponse);
      setTopics(streamResponse.topics);
      const serverDraft = inputFromDetail(loaded);
      let nextDraft = serverDraft;
      const local = await readRecovery(`${userId}:${activityId}`).catch(() => {
        if (generation === contextGeneration.current) setRecoveryError("Device recovery could not be read. Keep this tab open until changes are saved to ATOM.");
        return null;
      });
      if (generation !== contextGeneration.current) return;
      deviceFingerprint.current = local?.persisted ? fingerprint(local.input) : "";
      if (local && !local.persisted) setRecoveryError("These changes are held in this tab. Keep it open until they are saved to ATOM.");
      if (local && fingerprint(local.input) !== fingerprint(serverDraft)) {
        if (local.serverRevision === loaded.draftRevision) {
          nextDraft = local.input;
          setSyncState(local.persisted ? "device" : "memory");
        } else {
          setConflict({
            code: "draft_conflict",
            serverRevision: loaded.draftRevision ?? 1,
            updatedAt: loaded.updatedAt ?? new Date().toISOString(),
            updatedBy: null,
          });
          setSyncState("conflict");
          nextDraft = local.input;
        }
      } else {
        setSyncState("saved");
      }
      serverFingerprint.current = fingerprint(serverDraft);
      setDetail(loaded);
      setDraft(nextDraft);
      setEditorGeneration((value) => value + 1);
    } catch (error) {
      if (generation === contextGeneration.current) onError(error instanceof Error ? error.message : "The activity could not be opened");
    } finally {
      if (generation === contextGeneration.current) setLoading(false);
    }
  }, [activityId, onError, scope, userId]);

  useEffect(() => { void load(); return () => { contextGeneration.current++; }; }, [load]);

  const saveDraft = useCallback(async (input: ActivityInput, forcedRevision?: number) => {
    if (!activityId || !detail?.permissions?.canEdit || detail.status !== "draft") return;
    if (saveInFlight.current) return;
    saveInFlight.current = true;
    const generation = contextGeneration.current;
    const submitted = { ...input, baseRevision: forcedRevision ?? input.baseRevision };
    const submittedFingerprint = fingerprint(input);
    try {
      setSyncState("saving");
      const updated = requireAvailableActivity(await atomApi.updateActivity(activityId, submitted));
      if (generation !== contextGeneration.current) return;
      setDetail(updated);
      serverFingerprint.current = submittedFingerprint;
      const current = draftRef.current;
      if (current && fingerprint(current) === submittedFingerprint) {
        const clean = { ...input, baseRevision: updated.draftRevision };
        draftRef.current = clean;
        setDraft(clean);
        setSyncState("saved");
        setConflict(null);
        await clearRecovery(recoveryKey).catch(() => setRecoveryError("Saved to ATOM; the older device recovery copy could not be cleared."));
        if (generation === contextGeneration.current && input.gradingPeriod !== scope.gradingPeriod) {
          const query = new URLSearchParams(searchParams); query.set("period", input.gradingPeriod);
          navigate(`/subjects/${offeringId}/activities/${activityId}/edit?${query}`, { replace: true });
        }
      } else if (current) {
        const rebased = { ...current, baseRevision: updated.draftRevision };
        draftRef.current = rebased;
        setDraft(rebased);
        setSyncState(deviceFingerprint.current === fingerprint(rebased) ? "device" : "memory");
      }
    } catch (error) {
      if (generation !== contextGeneration.current) return;
      if (error instanceof ApiError && error.code === "draft_conflict") {
        setConflict({
          code: "draft_conflict",
          serverRevision: Number(error.payload?.serverRevision),
          updatedAt: String(error.payload?.updatedAt ?? new Date().toISOString()),
          updatedBy: error.payload?.updatedBy ? String(error.payload.updatedBy) : null,
        });
        setSyncState("conflict");
      } else {
        setSyncState(draftRef.current && deviceFingerprint.current === fingerprint(draftRef.current) ? "device" : "memory");
        if (error instanceof ApiError) onError(error.message);
      }
    } finally {
      saveInFlight.current = false;
    }
  }, [activityId, detail?.permissions?.canEdit, detail?.status, navigate, offeringId, onError, recoveryKey, scope.gradingPeriod, searchParams]);

  useEffect(() => {
    if (!draft || !recoveryKey || fingerprint(draft) === serverFingerprint.current) return;
    let active = true;
    const localFingerprint = fingerprint(draft);
    void writeRecovery({ key: recoveryKey, input: draft, serverRevision: draft.baseRevision ?? 1, savedAt: new Date().toISOString() }).then(() => {
      if (!active) return;
      deviceFingerprint.current = localFingerprint;
      setRecoveryError("");
      if (localFingerprint !== serverFingerprint.current) setSyncState(current => current === "saving" || current === "conflict" ? current : "device");
    }).catch(() => {
      if (!active) return;
      deviceFingerprint.current = "";
      setRecoveryError("Device recovery is unavailable. Keep this tab open until changes are saved to ATOM.");
      setSyncState(current => current === "saving" || current === "conflict" || current === "saved" ? current : "memory");
    });
    return () => { active = false; };
  }, [draft, recoveryKey]);

  useEffect(() => {
    if (!draft || !detail || conflict || fingerprint(draft) === serverFingerprint.current) return;
    const timer = window.setTimeout(() => void saveDraft(draft), 2000);
    return () => window.clearTimeout(timer);
  }, [detail, draft, conflict, saveDraft]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (syncState === "saved") return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [syncState]);

  if (!offering) return <Navigate to="/subjects" replace />;
  if (!activityId || loading || !detail || !draft) return <div className="editor-loading-page">{activityId ? "Opening activity authoring…" : "Creating a new activity draft…"}</div>;
  const editable = detail.status === "draft" && Boolean(detail.permissions?.canEdit);
  const returnHref = `/subjects/${offering.id}/activities/${detail.id}?${searchParams}`;

  const changeDraft = (change: (current: ActivityInput) => ActivityInput) => {
    if (!draftRef.current) return;
    const next = change(draftRef.current);
    if (fingerprint(next) === fingerprint(draftRef.current)) return;
    draftRef.current = next;
    rememberRecovery({ key: recoveryKey, input: next, serverRevision: next.baseRevision ?? 1, savedAt: new Date().toISOString() });
    setDraft(next); setSyncState(state => state === "conflict" ? state : "memory");
  };
  const changeSection = (id: string, change: (section: ActivitySection) => ActivitySection) => changeDraft((current) => ({
    ...current,
    contentDocument: { ...current.contentDocument, sections: current.contentDocument.sections.map((section) => section.id === id ? change(section) : section) },
  }));
  const moveSection = (id: string, direction: -1 | 1) => changeDraft((current) => {
    const sections = [...current.contentDocument.sections];
    const index = sections.findIndex((section) => section.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sections.length) return current;
    [sections[index], sections[target]] = [sections[target], sections[index]];
    return { ...current, contentDocument: { ...current.contentDocument, sections } };
  });

  const addCustomSection = () => changeDraft((current) => ({
    ...current,
    contentDocument: {
      ...current.contentDocument,
      sections: [...current.contentDocument.sections, { id: newIdentifier(), kind: "custom", title: "Additional section", content: emptyRichDocument() }],
    },
  }));

  const uploadAsset = async (file: File | undefined) => {
    if (!file) return;
    try {
      setBusy(true);
      const asset = await atomApi.uploadActivityAsset(detail.id, file);
      setDetail((current) => current ? { ...current, assets: [...current.assets, asset] } : current);
    } catch (error) {
      onError(error instanceof Error ? error.message : "The teaching file could not be uploaded");
    } finally {
      setBusy(false);
      if (assetInput.current) assetInput.current.value = "";
    }
  };

  const publish = async (acknowledgeRubricMismatch = false) => {
    setPublishError("");
    try {
      setBusy(true);
      const updated = requireAvailableActivity(await atomApi.publishActivity(detail.id, scope, detail.draftRevision ?? 1, acknowledgeRubricMismatch));
      setDetail(updated);
      setPublishOpen(false);
      navigate(returnHref, { replace: true });
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : "The activity could not be published");
    } finally {
      setBusy(false);
    }
  };

  const useServer = async () => {
    try { await clearRecovery(recoveryKey); }
    catch { setRecoveryError("The device copy could not be cleared. Your current draft is still visible."); return; }
    setConflict(null);
    await load();
  };
  const replaceServer = async () => {
    if (!draft || !conflict) return;
    setConflict(null);
    await saveDraft({ ...draft, baseRevision: conflict.serverRevision }, conflict.serverRevision);
    setEditorGeneration((value) => value + 1);
  };

  return (
    <main className="authoring-workspace">
      <header className="authoring-header">
        <Link className="all-subjects-link" to={returnHref}><ArrowLeft size={16} />Back to activity</Link>
        <div className="authoring-title"><span>{offering.code} · {draft.gradingPeriod === "midterm" ? "Midterm" : "Final Term"}</span><input aria-label="Activity title" disabled={!editable} value={draft.title} onChange={(event) => changeDraft((current) => ({ ...current, title: event.target.value }))} /></div>
        <div className="authoring-header-actions"><SyncBadge state={syncState} /><button className="button mobile-settings-trigger" onClick={() => setSettingsOpen(true)}><Settings2 size={15} />Delivery</button></div>
      </header>

      {recoveryError ? <p className="editor-lock-banner" role="alert">{recoveryError}</p> : null}
      {syncState === "memory" || syncState === "device" ? <button className="button" onClick={() => void saveDraft(draft)}>Retry saving to ATOM</button> : null}

      {detail.status === "published" ? <div className="editor-lock-banner"><AlertTriangle size={18} /><span>This release is published. Unpublish it from the activity view before editing.</span></div> : null}
      {conflict ? <div className="conflict-banner" role="alert"><div><strong>This draft changed elsewhere.</strong><span>Your changes remain in this tab. Choose which version should continue.</span></div><button className="button" onClick={() => void useServer()}>Use server version</button><button className="button button--primary" onClick={() => void replaceServer()}>Replace with my version</button></div> : null}

      <div className="authoring-grid">
        <section className="authoring-canvas">
          <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
            <Tabs.List className="authoring-tabs" aria-label="Activity content mode"><Tabs.Trigger value="edit">Edit</Tabs.Trigger><Tabs.Trigger value="preview">Student preview</Tabs.Trigger></Tabs.List>
            <Tabs.Content value="edit" className="authoring-document-stack">
              {draft.contentDocument.sections.map((section, index) => <RichSectionEditor
                key={`${section.id}:${editorGeneration}`}
                section={section}
                assets={detail.assets}
                editable={editable && syncState !== "conflict"}
                canMoveUp={index > 0}
                canMoveDown={index < draft.contentDocument.sections.length - 1}
                onChange={(content) => changeSection(section.id, (current) => ({ ...current, content }))}
                onTitleChange={(title) => changeSection(section.id, (current) => ({ ...current, title }))}
                onMove={(direction) => moveSection(section.id, direction)}
                onRemove={() => changeDraft((current) => ({ ...current, contentDocument: { ...current.contentDocument, sections: current.contentDocument.sections.filter((item) => item.id !== section.id) } }))}
              />)}
              {editable ? <button className="add-section-button" onClick={addCustomSection}><Plus size={17} />Add section</button> : null}
              {draft.blueprint.mode === "progressive" ? <ProgressivePartsEditor blueprint={draft.blueprint} assets={detail.assets} editable={editable && syncState !== "conflict"} editorGeneration={editorGeneration} onChange={(blueprint) => changeDraft((current) => ({ ...current, blueprint }))} /> : null}
            </Tabs.Content>
            <Tabs.Content value="preview" className="student-preview"><div className="preview-title"><p>{offering.code}</p><h1>{draft.title || "Untitled activity"}</h1><span>{draft.teachingGroupIds.map((id) => detail.targetGroups.find((group) => group.id === id)?.label ?? offering.groups.find((group) => group.id === id)?.label ?? "Unavailable group").join(" · ")}</span></div><RichDocumentRenderer document={draft.contentDocument} blueprint={draft.blueprint} /></Tabs.Content>
          </Tabs.Root>
        </section>

        {narrowViewport ? <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen}><PublicationRail detail={detail} draft={draft} offering={offering} topics={topics} editable={editable} busy={busy} syncState={syncState} assetInput={assetInput} onDraftChange={changeDraft} onUploadAsset={uploadAsset} onDetailChange={setDetail} onError={onError} onPublish={() => setPublishOpen(true)} /></SettingsSheet> : <PublicationRail detail={detail} draft={draft} offering={offering} topics={topics} editable={editable} busy={busy} syncState={syncState} assetInput={assetInput} onDraftChange={changeDraft} onUploadAsset={uploadAsset} onDetailChange={setDetail} onError={onError} onPublish={() => setPublishOpen(true)} />}
      </div>

      <PublishDialog error={publishError} open={publishOpen} detail={detail} draft={draft} offering={offering} busy={busy} onClose={() => setPublishOpen(false)} onPublish={(acknowledge) => void publish(acknowledge)} />
    </main>
  );
}

function PublicationRail({
  detail, draft, offering, topics, editable, busy, syncState, assetInput, onDraftChange,
  onUploadAsset, onDetailChange, onError, onPublish,
}: {
  detail: ActivityAvailableDetail;
  draft: ActivityInput;
  offering: SubjectOffering;
  topics: AssessmentTopic[];
  editable: boolean;
  busy: boolean;
  syncState: SyncState;
  assetInput: RefObject<HTMLInputElement | null>;
  onDraftChange: (change: (current: ActivityInput) => ActivityInput) => void;
  onUploadAsset: (file: File | undefined) => Promise<void>;
  onDetailChange: Dispatch<SetStateAction<ActivityAvailableDetail | null>>;
  onError: (message: string) => void;
  onPublish: () => void;
}) {
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const [rubricOpen, setRubricOpen] = useState(false);
  const selectedGroups = draft.teachingGroupIds.map((id) => offering.groups.find((group) => group.id === id)).filter(Boolean);
  const rubricTotal = draft.blueprint.rubric?.criteria.reduce((total, item) => total + (Number(item.points) || 0), 0) ?? 0;
  return <aside className="publication-rail">
    <RailSection title="Delivery">
      <label><span>Topic</span><Select.Root disabled={!detail.permissions?.canEdit} value={detail.topic?.id ?? "none"} onValueChange={(topicId) => void atomApi.organizeActivity(detail.id, topicId === "none" ? null : topicId, { subjectOfferingId: detail.subjectOfferingId, teachingGroupId: detail.targetGroups[0]?.id ?? "all", gradingPeriod: detail.gradingPeriod }).then((updated) => onDetailChange(requireAvailableActivity(updated))).catch((error) => onError(error.message))}><Select.Trigger className="select-trigger form-select"><Select.Value /><Select.Icon><ChevronDown size={15} /></Select.Icon></Select.Trigger><Select.Portal><Select.Content className="select-content" position="popper"><Select.Viewport><SelectItem value="none">No topic</SelectItem>{topics.map((topic) => <SelectItem value={topic.id} key={topic.id}>{topic.title}</SelectItem>)}</Select.Viewport></Select.Content></Select.Portal></Select.Root></label>
      <label><span>Grading period</span><Select.Root disabled={!editable} value={draft.gradingPeriod} onValueChange={(value) => onDraftChange((current) => ({ ...current, gradingPeriod: value as GradingPeriod }))}><Select.Trigger className="select-trigger form-select"><Select.Value /><Select.Icon><ChevronDown size={15} /></Select.Icon></Select.Trigger><Select.Portal><Select.Content className="select-content" position="popper"><Select.Viewport><SelectItem value="midterm">Midterm</SelectItem><SelectItem value="final_term">Final Term</SelectItem></Select.Viewport></Select.Content></Select.Portal></Select.Root></label>
      <div className="group-picker-summary"><span>Teaching groups</span><button className="button button--wide" disabled={!editable} onClick={() => setGroupsOpen(true)}><UsersRound size={15} />Select teaching groups</button><small>{selectedGroups.length ? `${selectedGroups.length} selected · ${selectedGroups.slice(0, 3).map((group) => group?.label).join(", ")}${selectedGroups.length > 3 ? ` +${selectedGroups.length - 3}` : ""}` : "At least one specific group is required"}</small></div>
      <label><span>Opens</span><input disabled={!editable} type="datetime-local" value={toDateTimeValue(draft.opensAt)} onChange={(event) => onDraftChange((current) => ({ ...current, opensAt: new Date(event.target.value).toISOString() }))} /></label>
      <label><span>Deadline</span><input disabled={!editable} type="datetime-local" value={toDateTimeValue(draft.deadlineAt)} onChange={(event) => onDraftChange((current) => ({ ...current, deadlineAt: new Date(event.target.value).toISOString() }))} /></label>
    </RailSection>

    <RailSection title="Submissions">
      <fieldset disabled={!editable}><legend>Accepted files</legend>{([".py", ".zip"] as const).map((extension) => <label className="check-row" key={extension}><Checkbox.Root className="checkbox" checked={draft.acceptedExtensions.includes(extension)} onCheckedChange={(checked) => onDraftChange((current) => ({ ...current, acceptedExtensions: checked === true ? [...new Set([...current.acceptedExtensions, extension])] : current.acceptedExtensions.filter((item) => item !== extension) }))}><Checkbox.Indicator><Check size={14} /></Checkbox.Indicator></Checkbox.Root><span>{extension === ".py" ? "Python source file" : "ZIP project"}</span></label>)}</fieldset>
      <label><span>Maximum size</span><div className="input-suffix"><input disabled={!editable} type="number" min={1} max={50} value={Math.round(draft.maxBytes / 1024 / 1024)} onChange={(event) => onDraftChange((current) => ({ ...current, maxBytes: Number(event.target.value) * 1024 * 1024 }))} /><span>MB</span></div></label>
      <button className="button button--wide" disabled={!editable} onClick={() => setRequirementsOpen(true)}>Configure submission requirements</button>
      <p className="rail-empty">{draft.blueprint.submission.validationMode} validation · {draft.blueprint.submission.requirements.length} structured requirement{draft.blueprint.submission.requirements.length === 1 ? "" : "s"}</p>
    </RailSection>

    <RailSection title="Activity structure">
      <label><span>Format</span><select disabled={!editable} value={draft.blueprint.mode} onChange={(event) => onDraftChange((current) => ({ ...current, blueprint: changeBlueprintMode(current.blueprint, event.target.value as ActivityBlueprintV1["mode"]) }))}><option value="simple">Simple activity</option><option value="progressive">Progressive parts</option></select></label>
      {draft.blueprint.mode === "progressive" ? <label><span>Progression</span><select disabled={!editable} value={draft.blueprint.progression} onChange={(event) => onDraftChange((current) => ({ ...current, blueprint: { ...current.blueprint, progression: event.target.value as ActivityBlueprintV1["progression"] } }))}><option value="sequential">Sequential</option><option value="independent">Independent</option></select></label> : null}
      <button className="button button--wide" disabled={!editable} onClick={() => setRubricOpen(true)}>Configure rubric</button>
      <p className="rail-empty">{draft.blueprint.mode === "progressive" ? `${draft.blueprint.parts.length} parts` : "Shared activity only"} · {draft.blueprint.rubric ? `${rubricTotal}/${draft.blueprint.rubric.expectedPoints} rubric points` : "No rubric"}</p>
    </RailSection>

    <RailSection title="Teaching files" action={editable ? <button className="text-button" onClick={() => assetInput.current?.click()}><Upload size={14} />Upload</button> : undefined}>
      <input className="sr-only" ref={assetInput} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.xlsx,.csv,.txt,.zip" onChange={(event) => void onUploadAsset(event.target.files?.[0])} />
      {detail.assets.length ? <div className="asset-list">{detail.assets.map((asset) => <div className="asset-row" key={asset.id}>{asset.kind === "image" ? <FileText size={16} /> : <Paperclip size={16} />}<button onClick={() => void atomApi.downloadActivityAsset(asset)}><strong>{asset.originalFilename}</strong><span>{formatBytes(asset.sizeBytes)}</span></button>{editable ? <button className="icon-button" aria-label={`Delete ${asset.originalFilename}`} onClick={() => void atomApi.deleteActivityAsset(detail.id, asset.id).then(() => onDetailChange((current) => current ? { ...current, assets: current.assets.filter((item) => item.id !== asset.id) } : current)).catch((error) => onError(error.message))}><Trash2 size={14} /></button> : null}</div>)}</div> : <p className="rail-empty">Upload an image or downloadable teaching file, then insert it from a section toolbar.</p>}
    </RailSection>

    <CollaboratorRail detail={detail} editable={editable} onDetailChange={(updated) => onDetailChange(updated)} onError={onError} />

    <RailSection title="Publication">
      <dl className="publication-summary"><div><dt>Status</dt><dd>{detail.status === "draft" ? "Draft" : `Release ${detail.releaseVersion}`}</dd></div><div><dt>Revision</dt><dd>{detail.draftRevision}</dd></div></dl>
      {detail.permissions?.canPublish && detail.status === "draft" ? <button className="button button--primary button--wide" disabled={busy || syncState !== "saved" || !draft.teachingGroupIds.length || !draft.acceptedExtensions.length} onClick={onPublish}><Send size={16} />Publish activity</button> : null}
    </RailSection>
    <TeachingGroupPicker open={groupsOpen} onOpenChange={setGroupsOpen} groups={offering.groups} selectedIds={draft.teachingGroupIds} onApply={(teachingGroupIds) => onDraftChange((current) => ({ ...current, teachingGroupIds }))} />
    <SubmissionRequirementsDialog open={requirementsOpen} onOpenChange={setRequirementsOpen} value={draft.blueprint.submission} parts={draft.blueprint.parts} onApply={(submission) => onDraftChange((current) => ({ ...current, blueprint: { ...current.blueprint, submission } }))} />
    <RubricDialog open={rubricOpen} onOpenChange={setRubricOpen} value={draft.blueprint.rubric} parts={draft.blueprint.parts} onApply={(rubric) => onDraftChange((current) => ({ ...current, blueprint: { ...current.blueprint, rubric } }))} />
  </aside>;
}

function ProgressivePartsEditor({ blueprint, assets, editable, editorGeneration, onChange }: { blueprint: ActivityBlueprintV1; assets: ActivityAsset[]; editable: boolean; editorGeneration: number; onChange: (blueprint: ActivityBlueprintV1) => void }) {
  const updatePart = (id: string, change: (part: ActivityPart) => ActivityPart) => onChange({ ...blueprint, parts: blueprint.parts.map((part) => part.id === id ? change(part) : part) });
  const movePart = (id: string, direction: -1 | 1) => {
    const parts = [...blueprint.parts];
    const index = parts.findIndex((part) => part.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= parts.length) return;
    [parts[index], parts[target]] = [parts[target], parts[index]];
    onChange({ ...blueprint, parts });
  };
  const addPart = () => onChange({ ...blueprint, parts: [...blueprint.parts, newPart(blueprint.parts.length + 1)] });
  const duplicatePart = (part: ActivityPart) => onChange({ ...blueprint, parts: [...blueprint.parts, { ...structuredClone(part), id: newIdentifier(), title: `Copy of ${part.title}` }] });
  return <section className="progressive-authoring"><header className="progressive-authoring__header"><div><span>Progressive activity</span><h2>Parts and levels</h2><p>The shared introduction above is followed by these ordered parts.</p></div>{editable ? <button className="button button--primary" onClick={addPart}><Plus size={16} />Add part</button> : null}</header>{blueprint.parts.length ? <nav className="part-navigator" aria-label="Activity parts">{blueprint.parts.map((part) => <a href={`#author-part-${part.id}`} key={part.id}>{part.shortLabel}</a>)}</nav> : null}<div className="part-stack">{blueprint.parts.map((part, partIndex) => <details className="author-part" id={`author-part-${part.id}`} open key={part.id}><summary><span>{part.shortLabel}</span><strong>{part.title}</strong></summary><div className="author-part__settings"><label><span>Short label</span><input disabled={!editable} value={part.shortLabel} onChange={(event) => updatePart(part.id, (current) => ({ ...current, shortLabel: event.target.value }))} /></label><label><span>Part title</span><input disabled={!editable} value={part.title} onChange={(event) => updatePart(part.id, (current) => ({ ...current, title: event.target.value }))} /></label>{editable ? <div className="author-part__actions"><button className="button button--small" disabled={partIndex === 0} onClick={() => movePart(part.id, -1)}>Move up</button><button className="button button--small" disabled={partIndex === blueprint.parts.length - 1} onClick={() => movePart(part.id, 1)}>Move down</button><button className="button button--small" onClick={() => duplicatePart(part)}>Duplicate</button><button className="button button--small button--danger" disabled={blueprint.parts.length <= 2} onClick={() => onChange({ ...blueprint, parts: blueprint.parts.filter((item) => item.id !== part.id) })}>Remove</button></div> : null}</div>{part.contentDocument.sections.map((section, sectionIndex) => <RichSectionEditor key={`${part.id}:${section.id}:${editorGeneration}`} section={section} assets={assets} editable={editable} canMoveUp={sectionIndex > 0} canMoveDown={sectionIndex < part.contentDocument.sections.length - 1} onChange={(content) => updatePart(part.id, (current) => ({ ...current, contentDocument: { ...current.contentDocument, sections: current.contentDocument.sections.map((item) => item.id === section.id ? { ...item, content } : item) } }))} onTitleChange={(title) => updatePart(part.id, (current) => ({ ...current, contentDocument: { ...current.contentDocument, sections: current.contentDocument.sections.map((item) => item.id === section.id ? { ...item, title } : item) } }))} onMove={(direction) => updatePart(part.id, (current) => { const sections = [...current.contentDocument.sections]; const index = sections.findIndex((item) => item.id === section.id); const target = index + direction; if (target < 0 || target >= sections.length) return current; [sections[index], sections[target]] = [sections[target], sections[index]]; return { ...current, contentDocument: { ...current.contentDocument, sections } }; })} onRemove={() => updatePart(part.id, (current) => ({ ...current, contentDocument: { ...current.contentDocument, sections: current.contentDocument.sections.filter((item) => item.id !== section.id) } }))} />)}</details>)}</div>{!blueprint.parts.length ? <button className="add-section-button" disabled={!editable} onClick={addPart}><Plus size={17} />Add the first part</button> : null}</section>;
}

function changeBlueprintMode(blueprint: ActivityBlueprintV1, mode: ActivityBlueprintV1["mode"]): ActivityBlueprintV1 {
  if (mode === blueprint.mode) return blueprint;
  if (mode === "simple") return { ...blueprint, mode, progression: "independent", parts: [], rubric: blueprint.rubric?.mode === "per_part" ? null : blueprint.rubric, submission: { ...blueprint.submission, requirements: blueprint.submission.requirements.map((item) => ({ ...item, partId: null })) } };
  return { ...blueprint, mode, progression: "sequential", parts: [newPart(1), newPart(2)] };
}

function newPart(number: number): ActivityPart {
  return { id: newIdentifier(), shortLabel: `Level ${number}`, title: `Level ${number}`, contentDocument: { version: 1, sections: [{ id: newIdentifier(), kind: "requirements", title: "Requirements", content: emptyRichDocument() }] } };
}

function SettingsSheet({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="modal-backdrop" /><Dialog.Content className="settings-sheet"><header><div><p>Activity delivery</p><Dialog.Title>Delivery settings</Dialog.Title></div><Dialog.Close asChild><button className="icon-button" aria-label="Close delivery settings"><X size={19} /></button></Dialog.Close></header>{children}</Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function CollaboratorRail({ detail, editable, onDetailChange, onError }: { detail: ActivityAvailableDetail; editable: boolean; onDetailChange: (detail: ActivityAvailableDetail) => void; onError: (message: string) => void }) {
  if (!detail.permissions?.canManageCollaborators) return detail.collaborators?.length ? <RailSection title="Coauthors"><div className="collaborator-list">{detail.collaborators.map((item) => <div key={item.facultyId}><strong>{item.displayName}</strong><span>{[item.canEdit && "Edit", item.canPublish && "Publish"].filter(Boolean).join(" · ")}</span></div>)}</div></RailSection> : null;
  const collaborators = detail.collaborators ?? [];
  const save = async (facultyId: string, canEdit: boolean, canPublish: boolean) => {
    try {
      const updated = canEdit || canPublish ? await atomApi.saveCollaborator(detail.id, facultyId, canEdit, canPublish) : await atomApi.removeCollaborator(detail.id, facultyId);
      onDetailChange({ ...detail, collaborators: updated });
    } catch (error) { onError(error instanceof Error ? error.message : "Collaborator permissions could not be changed"); }
  };
  return <RailSection title="Coauthors" icon={<UsersRound size={16} />}>
    {detail.availableCollaborators?.length ? <div className="collaborator-permissions">{detail.availableCollaborators.map((faculty) => {
      const current = collaborators.find((item) => item.facultyId === faculty.id);
      return <div key={faculty.id}><strong>{faculty.displayName}</strong><label><input type="checkbox" disabled={!editable} checked={current?.canEdit ?? false} onChange={(event) => void save(faculty.id, event.target.checked, current?.canPublish ?? false)} />Edit</label><label><input type="checkbox" disabled={!editable} checked={current?.canPublish ?? false} onChange={(event) => void save(faculty.id, current?.canEdit ?? false, event.target.checked)} />Publish</label></div>;
    })}</div> : <p className="rail-empty">No other faculty members are assigned to this subject offering.</p>}
  </RailSection>;
}

function RailSection({ title, children, action, icon }: { title: string; children: React.ReactNode; action?: React.ReactNode; icon?: React.ReactNode }) {
  return <section className="rail-section"><header>{icon}<h2>{title}</h2>{action}</header><div className="rail-section__body">{children}</div></section>;
}

function SyncBadge({ state }: { state: SyncState }) {
  const copy = state === "saved" ? "Saved to ATOM" : state === "saving" ? "Saving…" : state === "conflict" ? "Needs attention" : state === "device" ? "Saved on this device" : "Not saved — keep this tab open";
  return <span className={`sync-badge sync-badge--${state}`}>{state === "conflict" || state === "memory" ? <AlertTriangle size={14} /> : <Check size={14} />}{copy}</span>;
}

function PublishDialog({ open, detail, draft, offering, busy, onClose, onPublish, error }: { error: string; open: boolean; detail: ActivityAvailableDetail; draft: ActivityInput; offering: SubjectOffering; busy: boolean; onClose: () => void; onPublish: (acknowledge: boolean) => void }) {
  const [acknowledge, setAcknowledge] = useState(false);
  const rubric = draft.blueprint.rubric;
  const total = rubric?.criteria.reduce((sum, item) => sum + item.points, 0) ?? 0;
  const mismatch = Boolean(rubric && Math.abs(total - rubric.expectedPoints) > 0.001);
  useEffect(() => { if (open) setAcknowledge(false); }, [open]);
  return <Dialog.Root open={open} onOpenChange={(value) => { if (!value) onClose(); }}><Dialog.Portal><Dialog.Overlay className="modal-backdrop" /><Dialog.Content className="modal publish-dialog"><header className="modal__header"><div><Dialog.Title>Publish Release {(detail.releaseVersion ?? 0) + 1}?</Dialog.Title><Dialog.Description>Students in the selected groups will receive this immutable activity release.</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" aria-label="Close"><X size={19} /></button></Dialog.Close></header><dl className="publish-review"><div><dt>Activity</dt><dd>{draft.title}</dd></div><div><dt>Structure</dt><dd>{draft.blueprint.mode === "progressive" ? `${draft.blueprint.parts.length}-part ${draft.blueprint.progression}` : "Simple"}</dd></div><div><dt>Period</dt><dd>{draft.gradingPeriod === "midterm" ? "Midterm" : "Final Term"}</dd></div><div><dt>Groups</dt><dd>{draft.teachingGroupIds.map((id) => detail.targetGroups.find((group) => group.id === id)?.label ?? offering.groups.find((group) => group.id === id)?.label ?? "Unavailable group").join(" · ")}</dd></div><div><dt>Submission files</dt><dd>{draft.acceptedExtensions.join(" or ")} · {formatBytes(draft.maxBytes)} · {draft.blueprint.submission.validationMode}</dd></div><div><dt>Rubric</dt><dd>{rubric ? `${total} / ${rubric.expectedPoints} points · ${rubric.visibleToStudents ? "student visible" : "faculty only"}` : "None"}</dd></div><div><dt>Teaching files</dt><dd>{detail.assets.length}</dd></div></dl>{error ? <p role="alert" className="publish-warning">{error}</p> : null}{mismatch ? <label className="publish-warning"><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} /><span><strong>Rubric total mismatch</strong> Criteria total {total}, but the configured maximum is {rubric?.expectedPoints}. Publish anyway.</span></label> : null}<p className="publish-warning">First publication permanently locks this offering’s instructors, groups, enrollment and placements. Late enrollment and transfers are unavailable in this pilot; unpublishing does not unlock setup.</p><footer className="modal__actions"><Dialog.Close asChild><button className="button">Cancel</button></Dialog.Close><button className="button button--primary" disabled={busy || (mismatch && !acknowledge)} onClick={() => onPublish(acknowledge)}>{busy ? "Publishing…" : "Publish release"}</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function SelectItem({ value, children }: { value: string; children: string }) { return <Select.Item className="select-item" value={value}><Select.ItemIndicator><Check size={13} /></Select.ItemIndicator><Select.ItemText>{children}</Select.ItemText></Select.Item>; }

function newActivityInput(offering: SubjectOffering, groupId: string, period: GradingPeriod, requestedTopic: string | null): ActivityInput {
  const opens = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const deadline = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  return { subjectOfferingId: offering.id, gradingPeriod: period, teachingGroupIds: [groupId === "all" ? offering.groups[0]?.id : groupId].filter(Boolean) as string[], title: "Untitled activity", contentDocument: defaultDocument(), blueprint: defaultBlueprint(), opensAt: opens.toISOString(), deadlineAt: deadline.toISOString(), acceptedExtensions: [".py", ".zip"], maxBytes: 50 * 1024 * 1024, topicId: requestedTopic && requestedTopic !== "none" ? requestedTopic : null };
}

function defaultDocument(): ActivityDocumentV1 {
  return { version: 1, sections: [
    { id: newIdentifier(), kind: "overview", title: "Activity overview", content: emptyRichDocument() },
    { id: newIdentifier(), kind: "requirements", title: "Requirements", content: emptyRichDocument() },
    { id: newIdentifier(), kind: "submission_notes", title: "Submission notes", content: emptyRichDocument() },
  ] };
}

function emptyRichDocument() { return { type: "doc", content: [{ type: "paragraph" }] }; }
function defaultBlueprint(): ActivityBlueprintV1 { return { version: 1, mode: "simple", progression: "independent", parts: [], submission: { version: 1, delivery: "either", validationMode: "descriptive", allowExtraFiles: true, requirements: [] }, rubric: null }; }
function inputFromDetail(detail: ActivityAvailableDetail): ActivityInput { return { subjectOfferingId: detail.subjectOfferingId, gradingPeriod: detail.gradingPeriod, teachingGroupIds: detail.targetGroups.map((group) => group.id), title: detail.title, contentDocument: detail.contentDocument, blueprint: detail.blueprint, opensAt: detail.opensAt, deadlineAt: detail.deadlineAt, acceptedExtensions: detail.acceptedExtensions as Array<".py" | ".zip">, maxBytes: detail.maxBytes, baseRevision: detail.draftRevision }; }
function requireAvailableActivity(detail: ActivityDetail): ActivityAvailableDetail { if (!detail.contentAvailable) throw new Error("This activity is not available for authoring"); return detail; }
function fingerprint(input: ActivityInput): string { const { baseRevision: _baseRevision, ...content } = input; return JSON.stringify(content); }
function validGroupId(offering: SubjectOffering | undefined, requested: string | null): string { if (!offering) return "all"; return requested === "all" || offering.groups.some((group) => group.id === requested) ? requested ?? "all" : offering.groups[0]?.id ?? "all"; }
function toDateTimeValue(value: string): string { const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function useNarrowViewport(maxWidth: number): boolean {
  const query = `(max-width: ${maxWidth}px)`;
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}
