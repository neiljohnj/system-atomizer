import { request } from "../../api";
import type { ComponentKind } from "../../types";
export interface SetupGroup { id: string; label: string; componentKind: ComponentKind; facultyIds: string[] }
export interface GroupLink { lectureId: string; laboratoryId: string }
export interface RosterInput { studentNumber: string; displayName: string; groupIds: string[]; reuseUserId?: string }
export interface RosterRow extends RosterInput { id: string; enrollmentId: string; status: string; activationState: string; issues: string[] }
export interface SetupDetail {
  id: string; courseId: string|null; courseCode: string; courseTitle: string; termId: string; termLabel: string; label: string;
  state: string; revision: number; lockedAt: string|null; lockMessage: string; requiredComponents: ComponentKind[];
  groups: SetupGroup[]; links: GroupLink[]; managers: {id: string;displayName: string}[]; roster: RosterRow[]; issues: string[]; canOpenActivities: boolean;
}
export interface SetupCatalog {
  owner: boolean; canSetup: boolean; offeringIds: string[];
  courses: {id: string;code: string;title: string}[]; terms: {id: string;label: string}[];
  faculty: {id: string;displayName: string}[];
  offerings: {id: string;label: string;term: string;state: string;locked: boolean}[];
}
export interface RosterPreview {
  rows: (RosterInput & {index: number;existingUserId: string|null;action: string;issues: string[]})[];
  revision: number; previewToken: string; canApply: boolean;
}
export interface CredentialHandoff { userId: string; identifier: string; temporaryPassword: string; expiresAt: string }
export const setupApi = {
  catalog: ()=>request<SetupCatalog>("/api/academic-setup"),
  detail: (id: string)=>request<SetupDetail>(`/api/academic-setup/offerings/${id}`),
  write: <T,>(path: string, body: object, method="POST")=>request<T>(`/api/academic-setup${path}`,{method,body}),
};
