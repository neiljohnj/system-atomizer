import type {
  ActivityAsset,
  ActivityCollaborator,
  ActivityDetail,
  ActivityInput,
  ActivityScope,
  ActivitySummary,
  AssessmentStreamResponse,
  AssessmentTopic,
  AuthSessionPayload,
  BootstrapPayload,
  EvaluationInput,
  ManagedStudent,
  User,
} from "./types";

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: BodyInit | object | null;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly payload?: Record<string, unknown>,
  ) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  let body = options.body as BodyInit | null | undefined;
  if (body && !(body instanceof FormData) && typeof body !== "string") {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }
  const response = await fetch(path, { ...options, credentials: "same-origin", headers, body });
  if (response.status === 204) return undefined as T;
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith("/api/auth/login")) {
      window.dispatchEvent(new CustomEvent("atom:session-expired"));
    }
    throw new ApiError(
      typeof payload?.error === "string" ? payload.error : `Request failed (${response.status})`,
      response.status,
      typeof payload?.code === "string" ? payload.code : undefined,
      payload ?? undefined,
    );
  }
  return payload as T;
}

function scopeQuery(scope: ActivityScope): string {
  return new URLSearchParams({
    subjectOfferingId: scope.subjectOfferingId,
    teachingGroupId: scope.teachingGroupId,
    gradingPeriod: scope.gradingPeriod,
  }).toString();
}

export const atomApi = {
  authSession() {
    return request<AuthSessionPayload>("/api/auth/session");
  },

  login(identifier: string, password: string) {
    return request<AuthSessionPayload>("/api/auth/login", { method: "POST", body: { identifier, password } });
  },

  logout() {
    return request<void>("/api/auth/logout", { method: "POST" });
  },

  changePassword(currentPassword: string, newPassword: string) {
    return request<AuthSessionPayload>("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
  },

  setupStatus() {
    return request<{ setupRequired: boolean; httpWarning: boolean }>("/api/setup");
  },

  initialize(displayName: string, username: string, password: string) {
    return request<AuthSessionPayload>("/api/setup", {
      method: "POST",
      body: { displayName, username, password },
    });
  },

  recoverableFaculty() {
    return request<User[]>("/api/local-recovery/faculty");
  },

  resetFaculty(facultyId: string) {
    return request<{ temporaryPassword: string }>(`/api/local-recovery/faculty/${facultyId}/reset`, { method: "POST" });
  },

  assumeIdentity(userId: string) {
    return request<AuthSessionPayload>("/api/development/assume-identity", { method: "POST", body: { userId } });
  },

  bootstrap() {
    return request<BootstrapPayload>("/api/bootstrap");
  },

  activities(scope: ActivityScope) {
    return request<ActivitySummary[]>(`/api/activities?${scopeQuery(scope)}`);
  },

  assessmentStream(scope: ActivityScope) {
    const query = new URLSearchParams({
      module: "activities",
      teachingGroupId: scope.teachingGroupId,
      gradingPeriod: scope.gradingPeriod,
    });
    return request<AssessmentStreamResponse>(
      `/api/subject-offerings/${scope.subjectOfferingId}/assessment-stream?${query}`,
    );
  },

  createTopic(offeringId: string, gradingPeriod: ActivityScope["gradingPeriod"], title: string) {
    return request<AssessmentTopic>(`/api/subject-offerings/${offeringId}/topics`, {
      method: "POST",
      body: { gradingPeriod, title },
    });
  },

  renameTopic(topicId: string, title: string) {
    return request<AssessmentTopic>(`/api/topics/${topicId}`, { method: "PATCH", body: { title } });
  },

  deleteTopic(topicId: string) {
    return request<void>(`/api/topics/${topicId}`, { method: "DELETE" });
  },

  organizeActivity(activityId: string, topicId: string | null, scope: ActivityScope) {
    return request<ActivityDetail>(`/api/activities/${activityId}/organization?${scopeQuery(scope)}`, {
      method: "PATCH",
      body: { topicId },
    });
  },

  moveAssessmentStreamItem(scope: ActivityScope, entityType: "topic" | "activity", entityId: string, targetIndex: number) {
    return request<AssessmentStreamResponse>(`/api/subject-offerings/${scope.subjectOfferingId}/assessment-order`, {
      method: "POST",
      body: { gradingPeriod: scope.gradingPeriod, entityType, entityId, targetIndex },
    });
  },

  resetAssessmentStreamOrder(scope: ActivityScope, entityType: "topic" | "activity" | "all", entityId?: string) {
    return request<AssessmentStreamResponse>(`/api/subject-offerings/${scope.subjectOfferingId}/assessment-order/reset`, {
      method: "POST",
      body: { gradingPeriod: scope.gradingPeriod, entityType, entityId },
    });
  },

  activity(activityId: string, scope: ActivityScope) {
    return request<ActivityDetail>(`/api/activities/${activityId}?${scopeQuery(scope)}`);
  },

  createActivity(input: ActivityInput) {
    return request<ActivityDetail>("/api/activities", { method: "POST", body: input });
  },

  updateActivity(activityId: string, input: ActivityInput) {
    return request<ActivityDetail>(`/api/activities/${activityId}`, { method: "PATCH", body: input });
  },

  duplicateActivity(activityId: string) {
    return request<ActivityDetail>(`/api/activities/${activityId}/duplicate`, { method: "POST" });
  },

  publishActivity(activityId: string, scope: ActivityScope, expectedDraftRevision: number, acknowledgeRubricMismatch = false) {
    return request<ActivityDetail>(`/api/activities/${activityId}/publish?${scopeQuery(scope)}`, {
      method: "POST",
      body: { expectedDraftRevision, acknowledgeRubricMismatch },
    });
  },

  unpublishActivity(activityId: string, scope: ActivityScope) {
    return request<ActivityDetail>(`/api/activities/${activityId}/unpublish?${scopeQuery(scope)}`, { method: "POST" });
  },

  uploadActivityAsset(activityId: string, file: File) {
    const body = new FormData();
    body.append("file", file);
    return request<ActivityAsset>(`/api/activities/${activityId}/assets`, { method: "POST", body });
  },

  deleteActivityAsset(activityId: string, assetId: string) {
    return request<void>(`/api/activities/${activityId}/assets/${assetId}`, { method: "DELETE" });
  },

  saveCollaborator(activityId: string, facultyId: string, canEdit: boolean, canPublish: boolean) {
    return request<ActivityCollaborator[]>(`/api/activities/${activityId}/collaborators/${facultyId}`, {
      method: "PUT",
      body: { canEdit, canPublish },
    });
  },

  removeCollaborator(activityId: string, facultyId: string) {
    return request<ActivityCollaborator[]>(`/api/activities/${activityId}/collaborators/${facultyId}`, { method: "DELETE" });
  },

  managedStudents(offeringId: string) {
    return request<ManagedStudent[]>(`/api/subject-offerings/${offeringId}/students`);
  },

  resetStudentPassword(offeringId: string, studentId: string) {
    return request<void>(`/api/subject-offerings/${offeringId}/students/${studentId}/reset-password`, { method: "POST" });
  },

  uploadSubmission(activityId: string, file: File, idempotencyKey: string, completedThroughPartId?: string | null) {
    const body = new FormData();
    body.append("file", file);
    if (completedThroughPartId) body.append("completedThroughPartId", completedThroughPartId);
    return request<ActivityDetail>(`/api/activities/${activityId}/submissions`, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body,
    });
  },

  recordEvaluation(submissionId: string, input: EvaluationInput, scope: ActivityScope) {
    const query = new URLSearchParams({ teachingGroupId: scope.teachingGroupId });
    return request<ActivityDetail>(`/api/submissions/${submissionId}/evaluation?${query}`, {
      method: "POST",
      body: input,
    });
  },

  async downloadSubmission(submissionId: string, filename: string) {
    const response = await fetch(`/api/submissions/${submissionId}/file`, { credentials: "same-origin" });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new ApiError(payload?.error || "Download failed", response.status);
    }
    downloadBlob(await response.blob(), filename);
  },

  async downloadActivityAsset(asset: ActivityAsset) {
    const response = await fetch(asset.fileUrl, { credentials: "same-origin" });
    if (!response.ok) throw new ApiError("Teaching file could not be downloaded", response.status);
    downloadBlob(await response.blob(), asset.normalizedFilename);
  },
};

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
