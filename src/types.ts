export type Role = "faculty" | "student";
export type GradingPeriod = "midterm" | "final_term";
export type ComponentKind = "lecture" | "laboratory" | "combined";
export type ModuleKind = "activities" | "quizzes" | "exams" | "submissions" | "students";
export type ScheduleState = "scheduled" | "open" | "closed";

export interface User {
  id: string;
  studentNumber: string | null;
  displayName: string;
  role: Role;
}

export interface AuthSessionPayload {
  authenticated: boolean;
  setupRequired: boolean;
  httpWarning: boolean;
  demoAccountsEnabled?: boolean;
  currentUser?: User;
  mustChangePassword?: boolean;
  expiresAt?: string;
  idleExpiresAt?: string;
}

export interface TeachingGroup {
  id: string;
  label: string;
  componentKind: ComponentKind;
}

export interface SubjectOffering {
  id: string;
  code: string;
  title: string;
  groups: TeachingGroup[];
  canSetup?: boolean;
  setupOnly?: boolean;
  setupState?: string;
  configurationLocked?: boolean;
}

export interface AcademicTerm {
  id: string;
  label: string;
  offerings: SubjectOffering[];
}

export type AssessmentModule =
  | { kind: "activities"; enabled: true }
  | { kind: "quizzes"; enabled: false }
  | { kind: "exams"; enabled: false };

export interface ModuleAvailability {
  activities: true;
  quizzes: false;
  exams: false;
  submissions: boolean;
}

export interface ActivityScope {
  subjectOfferingId: string;
  teachingGroupId: string | "all";
  gradingPeriod: GradingPeriod;
}

export interface PublishedScope extends TeachingGroup {
  gradingPeriod: GradingPeriod;
}

export interface AssessmentTopic {
  id: string;
  subjectOfferingId: string;
  gradingPeriod: GradingPeriod;
  title: string;
  manualPosition: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudentSubmissionState {
  state: "not_submitted" | "submitted" | "evaluated";
  receivedAt: string | null;
}

export interface ActivitySummary {
  evidenceOnly?: boolean;
  id: string;
  subjectOfferingId: string;
  gradingPeriod: GradingPeriod;
  title: string;
  status: "draft" | "published";
  opensAt: string;
  deadlineAt: string;
  submissionCount: number;
  studentCount: number;
  releaseVersion: number | null;
  publishedAt: string | null;
  updatedAt: string;
  overviewExcerpt: string | null;
  scheduleState: ScheduleState;
  contentAvailable: boolean;
  topic: AssessmentTopic | null;
  manualPosition: number | null;
  currentUserSubmissionState: StudentSubmissionState | null;
  draftRevision?: number;
  targetGroups: TeachingGroup[];
  publishedScope: PublishedScope[];
}

export interface AssessmentStreamSection {
  topic: AssessmentTopic | null;
  items: ActivitySummary[];
}

export interface AssessmentStreamResponse {
  subjectOfferingId: string;
  gradingPeriod: GradingPeriod;
  teachingGroupId: string | "all";
  topics: AssessmentTopic[];
  sections: AssessmentStreamSection[];
}

export interface RichTextNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: RichTextNode[];
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  text?: string;
}

export type ActivitySectionKind = "overview" | "requirements" | "submission_notes" | "custom";

export interface ActivitySection {
  id: string;
  kind: ActivitySectionKind;
  title: string;
  content: RichTextNode;
}

export interface ActivityDocumentV1 {
  version: 1;
  sections: ActivitySection[];
}

export interface ActivityPart {
  id: string;
  title: string;
  shortLabel: string;
  contentDocument: ActivityDocumentV1;
}

export interface SubmissionRequirement {
  id: string;
  partId: string | null;
  label: string;
  kind: "file" | "file_set";
  filenameTemplate: string;
  allowedExtensions: string[];
  minCount: number;
  required: boolean;
}

export interface SubmissionSpecificationV1 {
  version: 1;
  delivery: "single_file" | "zip" | "either";
  validationMode: "strict" | "warning" | "descriptive";
  allowExtraFiles: boolean;
  requirements: SubmissionRequirement[];
}

export interface RubricCriterion {
  id: string;
  partId: string | null;
  title: string;
  description: string;
  fullCreditEvidence: string;
  points: number;
}

export interface ActivityRubricV1 {
  version: 1;
  mode: "overall" | "per_part";
  expectedPoints: number;
  visibleToStudents: boolean;
  criteria: RubricCriterion[];
}

export interface ActivityBlueprintV1 {
  version: 1;
  mode: "simple" | "progressive";
  progression: "independent" | "sequential";
  parts: ActivityPart[];
  submission: SubmissionSpecificationV1;
  rubric: ActivityRubricV1 | null;
}

export interface SubmissionValidationReport {
  valid: boolean;
  mode: SubmissionSpecificationV1["validationMode"];
  completedThroughPartId: string | null;
  matched: string[];
  missing: string[];
  unexpected: string[];
  invalid: string[];
}

export interface ActivityAsset {
  id: string;
  kind: "image" | "attachment";
  originalFilename: string;
  normalizedFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  fileUrl: string;
}

export interface ActivityCollaborator {
  facultyId: string;
  displayName: string;
  canEdit: boolean;
  canPublish: boolean;
}

export interface ActivityPermissions {
  isCreator: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canManageCollaborators: boolean;
}

export interface FacultyOption {
  id: string;
  displayName: string;
}

export interface ManagedStudent {
  id: string;
  studentNumber: string | null;
  displayName: string;
  mustChangePassword: boolean;
  activationState: string;
  groups: Array<{ id: string; label: string }>;
}

export interface Evaluation {
  id: string;
  score: number;
  manualDeduction: number;
  comments: string;
  annotations: string;
  evaluatedAt: string;
}

export interface Submission {
  id: string;
  studentId: string;
  studentNumber: string | null;
  studentName: string | null;
  originalFilename: string;
  normalizedFilename: string;
  sizeBytes: number;
  sha256: string;
  receivedAt: string;
  status: "fully_received";
  isCurrentSubmission: boolean;
  completedThroughPartId: string | null;
  validationReport: SubmissionValidationReport | null;
  evaluation: Evaluation | null;
}

export interface ActivityAvailableDetail extends ActivitySummary {
  contentAvailable: true;
  contentDocument: ActivityDocumentV1;
  blueprint: ActivityBlueprintV1;
  instructions: string;
  requirements: string[];
  acceptedExtensions: string[];
  maxBytes: number;
  assets: ActivityAsset[];
  draftRevision?: number;
  permissions?: ActivityPermissions;
  collaborators?: ActivityCollaborator[];
  availableCollaborators?: FacultyOption[];
  submissions?: Submission[];
  submissionHistory?: Submission[];
  currentSubmission?: Submission | null;
}

export interface ActivityLockedDetail extends ActivitySummary {
  contentAvailable: false;
  lockedReason: "not_open";
}

export type ActivityDetail = ActivityAvailableDetail | ActivityLockedDetail;

export interface PreviewIdentities {
  faculty: User[];
  students: User[];
}

export interface BootstrapPayload {
  setup: { owner: boolean; canSetup: boolean; offeringIds: string[] };
  currentUser: User;
  academicTerms: AcademicTerm[];
  moduleAvailability: ModuleAvailability;
  previewIdentities: PreviewIdentities | null;
  httpWarning: boolean;
  serverTime: string;
}

export interface ActivityInput {
  subjectOfferingId: string;
  gradingPeriod: GradingPeriod;
  teachingGroupIds: string[];
  title: string;
  contentDocument: ActivityDocumentV1;
  blueprint: ActivityBlueprintV1;
  opensAt: string;
  deadlineAt: string;
  acceptedExtensions: Array<".py" | ".zip">;
  maxBytes: number;
  baseRevision?: number;
  topicId?: string | null;
}

export interface DraftConflict {
  code: "draft_conflict";
  serverRevision: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface EvaluationInput {
  score: number;
  manualDeduction: number;
  comments: string;
  annotations: string;
}
