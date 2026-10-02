import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";
import {
  ArrowDown, ArrowUp, Check, ChevronDown, ChevronRight, ChevronsDownUp,
  ChevronsUpDown, Copy, Edit3, FileText, MoreHorizontal, Plus, RotateCcw,
  Search, Send, Settings2, Trash2, X,
} from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { atomApi } from "../../api";
import { DuplicateActivityDialog } from "../faculty/DuplicateActivityDialog";
import { formatDateTime } from "../../format";
import type {
  ActivityScope, ActivitySummary, AssessmentStreamResponse, AssessmentTopic,
  GradingPeriod, Role, SubjectOffering,
} from "../../types";

interface AssessmentStreamProps {
  offering: SubjectOffering;
  scope: ActivityScope;
  role: Role;
  stream: AssessmentStreamResponse;
  loading: boolean;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}

export function AssessmentStream({ offering, scope, role, stream, loading, onChanged, onError }: AssessmentStreamProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [manageTopics, setManageTopics] = useState(false);
  const [duplicateTarget, setDuplicateTarget] = useState<ActivitySummary | null>(null);
  const [publicationError, setPublicationError] = useState("");
  const [confirmAction, setConfirmAction] = useState<{ activity: ActivitySummary; action: "publish" | "unpublish" } | null>(null);
  const search = searchParams.get("q") ?? "";
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const status = searchParams.get("status") ?? "all";
  const topicFilter = searchParams.get("topic");
  const collapseKey = `atom.stream-collapse.v1.${offering.id}.${scope.gradingPeriod}`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed(collapseKey));

  useEffect(() => { localStorage.setItem(collapseKey, JSON.stringify([...collapsed])); }, [collapseKey, collapsed]);
  useEffect(() => {
    const returnState = sessionStorage.getItem(streamReturnKey(offering.id, scope));
    if (!returnState) return;
    sessionStorage.removeItem(streamReturnKey(offering.id, scope));
    try {
      const value = JSON.parse(returnState) as { scrollY?: number; activityId?: string };
      requestAnimationFrame(() => {
        window.scrollTo({ top: value.scrollY ?? 0 });
        document.querySelector<HTMLElement>(`[data-activity-id="${CSS.escape(value.activityId ?? "")}"]`)?.focus({ preventScroll: true });
      });
    } catch { /* Ignore an obsolete device-only return marker. */ }
  }, [offering.id, scope]);

  const sections = useMemo(() => stream.sections.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (role === "faculty" && status !== "all" && item.status !== status) return false;
      if (topicFilter && (section.topic?.id ?? "none") !== topicFilter) return false;
      if (!deferredSearch) return true;
      return `${item.title} ${item.overviewExcerpt ?? ""}`.toLocaleLowerCase().includes(deferredSearch);
    }),
  })).filter((section) => section.items.length > 0), [deferredSearch, role, status, stream.sections, topicFilter]);

  const updateQuery = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === "all") next.delete(key); else next.set(key, value);
    setSearchParams(next, { replace: true });
  };
  const toggleTopic = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allCollapsed = sections.length > 0 && sections.every((section) => collapsed.has(section.topic?.id ?? "none"));
  const setAllCollapsed = (value: boolean) => setCollapsed(value ? new Set(sections.map((section) => section.topic?.id ?? "none")) : new Set());
  const rememberReturn = (activityId: string) => sessionStorage.setItem(streamReturnKey(offering.id, scope), JSON.stringify({ scrollY: window.scrollY, activityId }));

  const performActivityAction = async (activity: ActivitySummary, action: string, topicId?: string | null) => {
    try {
      if (action === "duplicate") {
        setDuplicateTarget(activity);
      } else if (action === "topic") {
        await atomApi.organizeActivity(activity.id, topicId ?? null, scope);
        await onChanged();
      } else if (action === "up" || action === "down") {
        const section = stream.sections.find((streamSection) => streamSection.items.some((item) => item.id === activity.id));
        const index = section?.items.findIndex((item) => item.id === activity.id) ?? -1;
        if (index >= 0) await atomApi.moveAssessmentStreamItem(scope, "activity", activity.id, Math.max(0, index + (action === "up" ? -1 : 1)));
        await onChanged();
      } else if (action === "automatic") {
        await atomApi.resetAssessmentStreamOrder(scope, "activity", activity.id);
        await onChanged();
      }
    } catch (error) { onError(error instanceof Error ? error.message : "The activity could not be updated"); }
  };

  const changePublication = async () => {
    if (!confirmAction) return;
    setPublicationError("");
    try {
      const { activity, action } = confirmAction;
      if (action === "publish") await atomApi.publishActivity(activity.id, scope, activity.draftRevision ?? 1);
      else await atomApi.unpublishActivity(activity.id, scope);
      setConfirmAction(null);
      await onChanged();
    } catch (error) { setPublicationError(error instanceof Error ? error.message : "Publication could not be changed"); }
  };

  return <section className="assessment-stream">
    {duplicateTarget ? <DuplicateActivityDialog activity={duplicateTarget} offering={offering} onClose={() => setDuplicateTarget(null)} onCreated={async created => { await onChanged(); navigate(`/subjects/${offering.id}/activities/${created.id}?group=all&period=${created.gradingPeriod}`); }} /> : null}
    <header className="stream-heading">
      <div><p>{scope.gradingPeriod === "midterm" ? "Midterm" : "Final Term"}</p><h1>Activities</h1><span>{scope.teachingGroupId === "all" ? (role === "faculty" ? "All assigned groups" : "All my groups") : offering.groups.find((group) => group.id === scope.teachingGroupId)?.label}</span></div>
      {role === "faculty" ? <div className="stream-heading__actions"><button className="button" onClick={() => setManageTopics(true)}><Settings2 size={16} />Manage topics</button><Link className="button button--primary" to={`/subjects/${offering.id}/activities/new?${searchParams}`}><Plus size={17} />New activity</Link></div> : null}
    </header>

    <div className="stream-toolbar">
      <label className="stream-search"><Search size={16} /><span className="sr-only">Search activities</span><input value={search} onChange={(event) => updateQuery("q", event.target.value)} placeholder="Search activities" /></label>
      {role === "faculty" ? <Select.Root value={status} onValueChange={(value) => updateQuery("status", value)}><Select.Trigger className="select-trigger stream-status"><Select.Value /><Select.Icon><ChevronDown size={15} /></Select.Icon></Select.Trigger><Select.Portal><Select.Content className="select-content" position="popper"><Select.Viewport>{["all", "draft", "published"].map((value) => <Select.Item className="select-item" value={value} key={value}><Select.ItemIndicator><Check size={13} /></Select.ItemIndicator><Select.ItemText>{value === "all" ? "All statuses" : value === "draft" ? "Drafts" : "Published"}</Select.ItemText></Select.Item>)}</Select.Viewport></Select.Content></Select.Portal></Select.Root> : null}
      {topicFilter ? <button className="filter-chip" onClick={() => updateQuery("topic", "all")}>Topic: {stream.topics.find((topic) => topic.id === topicFilter)?.title ?? "No topic"}<X size={13} /></button> : null}
      <button className="text-button stream-collapse-control" onClick={() => setAllCollapsed(!allCollapsed)}>{allCollapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}{allCollapsed ? "Expand all" : "Collapse all"}</button>
    </div>

    {loading ? <div className="loading-panel">Loading activities…</div> : sections.length ? <div className="topic-stream">
      {sections.map((section, topicIndex) => {
        const topicId = section.topic?.id ?? "none";
        const isCollapsed = !deferredSearch && collapsed.has(topicId);
        return <section className="topic-section" key={topicId}>
          <header className="topic-heading">
            <button onClick={() => toggleTopic(topicId)} aria-expanded={!isCollapsed}><ChevronDown className={isCollapsed ? "is-collapsed" : ""} size={18} /><span>{section.topic?.title ?? "No topic"}</span><small>{section.items.length}</small></button>
            {role === "faculty" && section.topic ? <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="icon-button" aria-label={`Actions for ${section.topic.title}`}><MoreHorizontal size={17} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end"><DropdownMenu.Item className="menu-item" disabled={topicIndex === 0} onSelect={() => void atomApi.moveAssessmentStreamItem(scope, "topic", section.topic!.id, Math.max(0, topicIndex - 1)).then(onChanged).catch((error) => onError(error.message))}><ArrowUp size={14} />Move up</DropdownMenu.Item><DropdownMenu.Item className="menu-item" disabled={topicIndex === sections.length - 1} onSelect={() => void atomApi.moveAssessmentStreamItem(scope, "topic", section.topic!.id, topicIndex + 1).then(onChanged).catch((error) => onError(error.message))}><ArrowDown size={14} />Move down</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => void atomApi.resetAssessmentStreamOrder(scope, "topic", section.topic!.id).then(onChanged).catch((error) => onError(error.message))}><RotateCcw size={14} />Use automatic order</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root> : null}
          </header>
          {!isCollapsed ? <div className="topic-items">{section.items.map((activity, itemIndex) => <ActivityStreamCard
            key={activity.id} activity={activity} role={role} offeringId={offering.id} query={searchParams.toString()} topics={stream.topics}
            first={itemIndex === 0} last={itemIndex === section.items.length - 1} onRemember={rememberReturn}
            onAction={(action, topicId) => action === "publish" || action === "unpublish" ? (setPublicationError(""), setConfirmAction({ activity, action })) : void performActivityAction(activity, action, topicId)}
          />)}</div> : null}
        </section>;
      })}
    </div> : <div className="stream-empty"><FileText size={34} /><h2>No matching activities</h2><p>{search || status !== "all" || topicFilter ? "Clear a filter to see other activities in this grading period." : role === "faculty" ? "Create an activity or select another teaching group or grading period." : "Your instructor has not published an activity for this view."}</p></div>}

    {role === "faculty" ? <TopicManager open={manageTopics} onOpenChange={setManageTopics} offering={offering} scope={scope} topics={stream.topics} onChanged={onChanged} onError={onError} /> : null}
    <ConfirmDialog error={publicationError} destinations={confirmAction ? `${confirmAction.activity.gradingPeriod === "midterm" ? "Midterm" : "Final Term"}: ${(confirmAction.action === "publish" ? confirmAction.activity.targetGroups : confirmAction.activity.publishedScope).map(group => group.label).join(" · ")}` : ""} open={Boolean(confirmAction)} title={confirmAction?.action === "publish" ? "Publish this activity?" : "Unpublish this activity?"} description={confirmAction?.action === "publish" ? "Students in its selected teaching groups will receive a new immutable release. First publication permanently locks instructors, groups, enrollment and placements for this fixed-roster pilot. Unpublishing does not unlock setup; late enrollment and transfers are unavailable." : "The activity will disappear from student workspaces until it is published again."} actionLabel={confirmAction?.action === "publish" ? "Publish" : "Unpublish"} onOpenChange={(open) => { if (!open) setConfirmAction(null); }} onConfirm={() => void changePublication()} />
  </section>;
}

function ActivityStreamCard({ activity, role, offeringId, query, topics, first, last, onRemember, onAction }: {
  activity: ActivitySummary; role: Role; offeringId: string; query: string; topics: AssessmentTopic[]; first: boolean; last: boolean;
  onRemember: (id: string) => void; onAction: (action: string, topicId?: string | null) => void;
}) {
  const date = new Date(activity.opensAt);
  return <article className="stream-card" data-activity-id={activity.id} tabIndex={-1}>
    <Link className="stream-card__link" to={`/subjects/${offeringId}/activities/${activity.id}?${query}`} onClick={() => onRemember(activity.id)}>
      <div className="stream-date"><strong>{String(date.getDate()).padStart(2, "0")}</strong><span>{date.toLocaleDateString(undefined, { month: "short" })}</span></div>
      <div className="stream-card__body"><div className="stream-card__title"><h2>{activity.title}</h2><div className="stream-badges"><Status state={activity.status} /><span className={`schedule-state schedule-state--${activity.scheduleState}`}>{scheduleLabel(activity.scheduleState)}</span></div></div>{activity.overviewExcerpt ? <p>{activity.overviewExcerpt}</p> : null}<div className="stream-meta"><span>Opens {formatDateTime(activity.opensAt)}</span><span>Due {formatDateTime(activity.deadlineAt)}</span><span>{(activity.status === "published" ? activity.publishedScope : activity.targetGroups).map((group) => group.label).join(" · ")}</span>{role === "faculty" ? <strong>{activity.submissionCount} of {activity.studentCount} submissions</strong> : <strong>{studentStateLabel(activity)}</strong>}</div></div>
      <ChevronRight className="stream-card__arrow" size={19} />
    </Link>
    {role === "faculty" && !activity.evidenceOnly ? <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="icon-button stream-card__menu" aria-label={`Actions for ${activity.title}`}><MoreHorizontal size={18} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="menu-content" align="end"><DropdownMenu.Item className="menu-item" asChild><Link to={`/subjects/${offeringId}/activities/${activity.id}/edit?${query}`}><Edit3 size={14} />Edit</Link></DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => onAction("duplicate")}><Copy size={14} />Duplicate</DropdownMenu.Item><DropdownMenu.Sub><DropdownMenu.SubTrigger className="menu-item">Move to topic<ChevronRight size={14} /></DropdownMenu.SubTrigger><DropdownMenu.Portal><DropdownMenu.SubContent className="menu-content"><DropdownMenu.Item className="menu-item" onSelect={() => onAction("topic", null)}>No topic</DropdownMenu.Item>{topics.map((topic) => <DropdownMenu.Item className="menu-item" key={topic.id} onSelect={() => onAction("topic", topic.id)}>{topic.title}</DropdownMenu.Item>)}</DropdownMenu.SubContent></DropdownMenu.Portal></DropdownMenu.Sub><DropdownMenu.Separator className="menu-separator" /><DropdownMenu.Item className="menu-item" disabled={first} onSelect={() => onAction("up")}><ArrowUp size={14} />Move up</DropdownMenu.Item><DropdownMenu.Item className="menu-item" disabled={last} onSelect={() => onAction("down")}><ArrowDown size={14} />Move down</DropdownMenu.Item><DropdownMenu.Item className="menu-item" onSelect={() => onAction("automatic")}><RotateCcw size={14} />Use automatic order</DropdownMenu.Item><DropdownMenu.Separator className="menu-separator" /><DropdownMenu.Item className="menu-item" onSelect={() => onAction(activity.status === "draft" ? "publish" : "unpublish")}>{activity.status === "draft" ? <Send size={14} /> : <X size={14} />}{activity.status === "draft" ? "Publish" : "Unpublish"}</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root> : null}
  </article>;
}

function TopicManager({ open, onOpenChange, offering, scope, topics, onChanged, onError }: { open: boolean; onOpenChange: (open: boolean) => void; offering: SubjectOffering; scope: ActivityScope; topics: AssessmentTopic[]; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const [newTitle, setNewTitle] = useState("");
  const perform = async (work: () => Promise<unknown>) => { try { await work(); await onChanged(); } catch (error) { onError(error instanceof Error ? error.message : "Topics could not be updated"); } };
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="modal-backdrop" /><Dialog.Content className="modal topic-manager"><header className="modal__header"><div><Dialog.Title>Manage topics</Dialog.Title><Dialog.Description>{offering.code} · {scope.gradingPeriod === "midterm" ? "Midterm" : "Final Term"}</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" aria-label="Close topic manager"><X size={19} /></button></Dialog.Close></header><form className="topic-create" onSubmit={(event) => { event.preventDefault(); const title = newTitle.trim(); if (!title) return; void perform(() => atomApi.createTopic(offering.id, scope.gradingPeriod, title)).then(() => setNewTitle("")); }}><label><span>New topic</span><input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} maxLength={120} placeholder="Topic name" /></label><button className="button button--primary" disabled={!newTitle.trim()}><Plus size={15} />Add topic</button></form><div className="topic-manager__list">{topics.length ? topics.map((topic, index) => <div className="topic-manager__row" key={topic.id}><span className="topic-position">{String(index + 1).padStart(2, "0")}</span><input aria-label={`Rename ${topic.title}`} defaultValue={topic.title} onBlur={(event) => { const title = event.target.value.trim(); if (title && title !== topic.title) void perform(() => atomApi.renameTopic(topic.id, title)); }} /><div className="topic-row-actions"><button className="icon-button" disabled={index === 0} onClick={() => void perform(() => atomApi.moveAssessmentStreamItem(scope, "topic", topic.id, Math.max(0, index - 1)))} aria-label={`Move ${topic.title} up`}><ArrowUp size={15} /></button><button className="icon-button" disabled={index === topics.length - 1} onClick={() => void perform(() => atomApi.moveAssessmentStreamItem(scope, "topic", topic.id, index + 1))} aria-label={`Move ${topic.title} down`}><ArrowDown size={15} /></button><button className="icon-button" onClick={() => void perform(() => atomApi.resetAssessmentStreamOrder(scope, "topic", topic.id))} aria-label={`Use automatic order for ${topic.title}`}><RotateCcw size={15} /></button><button className="icon-button icon-button--danger" onClick={() => { if (window.confirm(`Delete “${topic.title}”? Its activities will move to No topic.`)) void perform(() => atomApi.deleteTopic(topic.id)); }} aria-label={`Delete ${topic.title}`}><Trash2 size={15} /></button></div></div>) : <p className="topic-manager__empty">No topics have been created for this grading period.</p>}</div><footer className="topic-manager__footer"><button className="text-button" onClick={() => void perform(() => atomApi.resetAssessmentStreamOrder(scope, "all"))}><RotateCcw size={14} />Reset all ordering</button><Dialog.Close asChild><button className="button">Done</button></Dialog.Close></footer></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function ConfirmDialog({ open, title, description, actionLabel, onOpenChange, onConfirm, destinations, error }: { destinations: string; error: string; open: boolean; title: string; description: string; actionLabel: string; onOpenChange: (open: boolean) => void; onConfirm: () => void }) {
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="modal-backdrop" /><Dialog.Content className="modal modal--compact"><header className="modal__header"><div><Dialog.Title>{title}</Dialog.Title><Dialog.Description>{description}</Dialog.Description></div><Dialog.Close asChild><button className="icon-button" aria-label="Close"><X size={18} /></button></Dialog.Close></header><p>{destinations}</p>{error ? <p role="alert" className="publish-warning">{error}</p> : null}<footer className="confirm-actions"><Dialog.Close asChild><button className="button">Cancel</button></Dialog.Close><button className="button button--primary" onClick={onConfirm}>{actionLabel}</button></footer></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function Status({ state }: { state: "draft" | "published" }) { return <span className={`status status--${state}`}>{state === "published" ? "Published" : "Draft"}</span>; }
function scheduleLabel(state: ActivitySummary["scheduleState"]): string { return state === "scheduled" ? "Scheduled" : state === "open" ? "Open" : "Closed"; }
function studentStateLabel(activity: ActivitySummary): string { const state = activity.currentUserSubmissionState?.state; return state === "evaluated" ? "Evaluated" : state === "submitted" ? "Submitted" : "Not submitted"; }
function readCollapsed(key: string): Set<string> { try { const value = JSON.parse(localStorage.getItem(key) ?? "[]"); return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []); } catch { return new Set(); } }
function streamReturnKey(offeringId: string, scope: ActivityScope): string { return `atom.stream-return.${offeringId}.${scope.teachingGroupId}.${scope.gradingPeriod}`; }
