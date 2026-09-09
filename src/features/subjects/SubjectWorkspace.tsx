import * as Select from "@radix-ui/react-select";
import * as Tabs from "@radix-ui/react-tabs";
import {
  Check, ChevronDown, ClipboardCheck, ClipboardList, FileQuestion, FlaskConical,
  GraduationCap, Home, UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { atomApi } from "../../api";
import type {
  ActivityScope, ActivitySummary, AssessmentStreamResponse, BootstrapPayload,
  ComponentKind, GradingPeriod, ModuleKind, SubjectOffering, TeachingGroup,
} from "../../types";
import { FacultyWorkspace } from "../faculty/FacultyWorkspace";
import { StudentAccess } from "../faculty/StudentAccess";
import { ActivityDetailPage } from "./ActivityDetailPage";
import { AssessmentStream } from "./AssessmentStream";

interface SubjectWorkspaceProps {
  bootstrap: BootstrapPayload;
  module: ModuleKind;
  onError: (message: string) => void;
}

const EMPTY_STREAM: AssessmentStreamResponse = {
  subjectOfferingId: "",
  gradingPeriod: "midterm",
  teachingGroupId: "all",
  topics: [],
  sections: [],
};

export function SubjectWorkspace({ bootstrap, module, onError }: SubjectWorkspaceProps) {
  const { offeringId = "", activityId } = useParams();
  const offering = useMemo(
    () => bootstrap.academicTerms.flatMap((term) => term.offerings).find((item) => item.id === offeringId),
    [bootstrap.academicTerms, offeringId],
  );
  if (!offering) return <Navigate to="/subjects" replace />;
  return <AuthorizedSubjectWorkspace bootstrap={bootstrap} offering={offering} module={module} routeActivityId={activityId} onError={onError} />;
}

function AuthorizedSubjectWorkspace({ bootstrap, offering, module, routeActivityId, onError }: SubjectWorkspaceProps & { offering: SubjectOffering; routeActivityId?: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [stream, setStream] = useState<AssessmentStreamResponse>(EMPTY_STREAM);
  const [activities, setActivities] = useState<ActivitySummary[]>([]);
  const [loading, setLoading] = useState(module === "activities" || module === "submissions");
  const user = bootstrap.currentUser;
  const groupStorageKey = `atom.last-group.${user.id}.${offering.id}`;
  const savedGroup = localStorage.getItem(groupStorageKey);
  const firstFacultyGroup = offering.groups[0]?.id ?? "all";
  const defaultGroup = user.role === "faculty" ? (savedGroup && offering.groups.some((group) => group.id === savedGroup) ? savedGroup : firstFacultyGroup) : "all";
  const requestedGroup = searchParams.get("group");
  const groupId = requestedGroup && (requestedGroup === "all" || offering.groups.some((group) => group.id === requestedGroup)) ? requestedGroup : defaultGroup;
  const requestedPeriod = searchParams.get("period");
  const gradingPeriod: GradingPeriod = requestedPeriod === "final_term" ? "final_term" : "midterm";
  const scope = useMemo<ActivityScope>(() => ({ subjectOfferingId: offering.id, teachingGroupId: groupId, gradingPeriod }), [gradingPeriod, groupId, offering.id]);

  useEffect(() => {
    if (requestedGroup === groupId && requestedPeriod === gradingPeriod) return;
    const next = new URLSearchParams(searchParams);
    next.set("group", groupId);
    next.set("period", gradingPeriod);
    setSearchParams(next, { replace: true });
  }, [gradingPeriod, groupId, requestedGroup, requestedPeriod, searchParams, setSearchParams]);

  const loadStream = useCallback(async () => {
    if (module !== "activities") return;
    try { setLoading(true); setStream(await atomApi.assessmentStream(scope)); }
    catch (error) { onError(error instanceof Error ? error.message : "Could not load activities"); }
    finally { setLoading(false); }
  }, [module, onError, scope]);
  const loadSubmissions = useCallback(async () => {
    if (module !== "submissions") return;
    try { setLoading(true); setActivities(await atomApi.activities(scope)); }
    catch (error) { onError(error instanceof Error ? error.message : "Could not load submissions"); }
    finally { setLoading(false); }
  }, [module, onError, scope]);
  useEffect(() => { void Promise.all([loadStream(), loadSubmissions()]); }, [loadStream, loadSubmissions]);

  const changeScope = (key: "group" | "period", value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set(key, value);
    next.delete("activity");
    next.delete("topic");
    if (key === "group" && user.role === "faculty" && value !== "all") localStorage.setItem(groupStorageKey, value);
    navigate(`/subjects/${offering.id}/${module}?${next}`);
  };
  const moduleHref = (nextModule: ModuleKind) => {
    const next = new URLSearchParams(searchParams);
    next.delete("activity");
    next.delete("topic");
    next.delete("status");
    next.delete("q");
    return `/subjects/${offering.id}/${nextModule}?${next}`;
  };

  return <main className="subject-workspace">
    <header className="subject-context">
      <Link className="all-subjects-link" to="/subjects"><Home size={15} />All subjects</Link>
      <div className="subject-identity"><strong>{offering.code}</strong><span>{offering.title}</span></div>
      {module !== "students" ? <div className="workspace-filter"><label id="group-filter-label">Teaching group</label><GroupSelect groups={offering.groups} value={groupId} allLabel={user.role === "faculty" ? "All assigned groups" : "All my groups"} onChange={(value) => changeScope("group", value)} /></div> : <div />}
      {module !== "students" ? <Tabs.Root className="period-tabs" value={gradingPeriod} onValueChange={(value) => changeScope("period", value)}><Tabs.List aria-label="Grading period"><Tabs.Trigger value="midterm">Midterm</Tabs.Trigger><Tabs.Trigger value="final_term">Final Term</Tabs.Trigger></Tabs.List></Tabs.Root> : <div />}
    </header>

    <nav className="module-nav" aria-label={`${offering.code} modules`}>
      <NavLink to={moduleHref("activities")}><ClipboardList size={18} />Activities</NavLink>
      <NavLink to={moduleHref("quizzes")}><FileQuestion size={18} />Quizzes</NavLink>
      <NavLink to={moduleHref("exams")}><GraduationCap size={18} />Exams</NavLink>
      {user.role === "faculty" ? <><NavLink to={moduleHref("submissions")}><ClipboardCheck size={18} />Submissions</NavLink><NavLink to={moduleHref("students")}><UsersRound size={18} />Student access</NavLink></> : null}
    </nav>

    {module === "students" && user.role === "faculty" ? <StudentAccess offering={offering} onError={onError} />
      : module === "quizzes" || module === "exams" ? <ModuleEmpty module={module} activitiesHref={moduleHref("activities")} />
      : module === "submissions" && user.role === "faculty" ? <FacultyWorkspace offering={offering} scope={scope} module="submissions" activities={activities} selectedId={searchParams.get("activity") ?? undefined} loading={loading} onSelect={(activityId) => { const next = new URLSearchParams(searchParams); next.set("activity", activityId); navigate(`/subjects/${offering.id}/submissions?${next}`); }} onChanged={loadSubmissions} onError={onError} />
      : routeActivityId ? <ActivityDetailPage offering={offering} scope={scope} activityId={routeActivityId} role={user.role} onChanged={loadStream} onError={onError} />
      : <AssessmentStream offering={offering} scope={scope} role={user.role} stream={stream} loading={loading} onChanged={loadStream} onError={onError} />}
  </main>;
}

function GroupSelect({ groups, value, allLabel, onChange }: { groups: TeachingGroup[]; value: string; allLabel: string; onChange: (value: string) => void }) {
  const kinds: Array<{ kind: ComponentKind; label: string }> = [{ kind: "lecture", label: "Lecture" }, { kind: "laboratory", label: "Laboratory" }, { kind: "combined", label: "Combined" }];
  return <Select.Root value={value} onValueChange={onChange}><Select.Trigger className="select-trigger group-select-trigger" aria-labelledby="group-filter-label"><Select.Value /><Select.Icon><ChevronDown size={15} /></Select.Icon></Select.Trigger><Select.Portal><Select.Content className="select-content" position="popper" sideOffset={5}><Select.Viewport><Select.Item className="select-item" value="all"><Select.ItemIndicator><Check size={13} /></Select.ItemIndicator><Select.ItemText>{allLabel}</Select.ItemText></Select.Item><Select.Separator className="select-separator" />{kinds.map(({ kind, label }) => { const matching = groups.filter((group) => group.componentKind === kind); return matching.length ? <Select.Group key={kind}><Select.Label className="select-label">{label}</Select.Label>{matching.map((group) => <Select.Item className="select-item" value={group.id} key={group.id}><Select.ItemIndicator><Check size={13} /></Select.ItemIndicator><Select.ItemText>{group.label}</Select.ItemText></Select.Item>)}</Select.Group> : null; })}</Select.Viewport></Select.Content></Select.Portal></Select.Root>;
}

function ModuleEmpty({ module, activitiesHref }: { module: "quizzes" | "exams"; activitiesHref: string }) {
  return <section className="module-empty"><div className="module-empty__icon">{module === "quizzes" ? <FileQuestion size={30} /> : <GraduationCap size={30} />}</div><p>{module === "quizzes" ? "Quizzes" : "Exams"}</p><h1>{module === "quizzes" ? "Quiz authoring is not enabled yet" : "Exam authoring is not enabled yet"}</h1><span>This subject and grading-period route is ready, but no {module === "quizzes" ? "quiz" : "exam"} content has been created.</span><Link className="button" to={activitiesHref}><FlaskConical size={16} />Open activities</Link></section>;
}
