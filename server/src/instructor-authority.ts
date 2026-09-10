import type { DatabaseSync } from "node:sqlite";
import type { AuthUser } from "./auth.js";
import { HttpError } from "./errors.js";

type Activity = Record<string, unknown>;

/** Current assignments/active placements only; no historical membership is inferred. */
export class InstructorAuthority {
  constructor(private readonly db: DatabaseSync) {}

  canRead(activity: Activity, user: AuthUser, groupId: string | null = null): boolean {
    if (user.role !== "faculty") return false;
    const offering = String(activity.subject_offering_id);
    if (!this.db.prepare(`SELECT 1 FROM faculty_group_assignments f
      JOIN teaching_groups g ON g.id=f.teaching_group_id
      WHERE f.faculty_id=? AND g.subject_offering_id=?`).get(user.id, offering)) return false;
    if (groupId && !this.hasGroup(user.id, offering, groupId)) return false;
    if (String(activity.created_by) === user.id) return true;
    if (this.db.prepare(`SELECT 1 FROM activity_collaborators
      WHERE activity_id=? AND faculty_id=? AND (can_edit=1 OR can_publish=1)`)
      .get(String(activity.id), user.id)) return true;
    return Boolean(this.db.prepare(`SELECT 1 FROM activity_targets t
      JOIN teaching_groups g ON g.id=t.teaching_group_id
      JOIN faculty_group_assignments f ON f.teaching_group_id=g.id
      WHERE t.activity_id=? AND f.faculty_id=? AND g.subject_offering_id=?
        ${groupId ? "AND g.id=?" : ""}`)
      .get(String(activity.id), user.id, offering, ...(groupId ? [groupId] : [])));
  }

  assertRead(activity: Activity, user: AuthUser, groupId: string | null = null): void {
    if (!this.canRead(activity, user, groupId)) throw new HttpError(404, "Activity not found");
  }

  hasGroup(facultyId: string, offeringId: string, groupId: string): boolean {
    return Boolean(this.db.prepare(`SELECT 1 FROM faculty_group_assignments f
      JOIN teaching_groups g ON g.id=f.teaching_group_id
      WHERE f.faculty_id=? AND g.subject_offering_id=? AND g.id=?`).get(facultyId, offeringId, groupId));
  }

  assertDestinations(user: AuthUser, offeringId: string, groupIds: string[]): void {
    if (!groupIds.length || groupIds.some(id => !this.hasGroup(user.id, offeringId, id))) {
      throw new HttpError(403, "Every destination must be a teaching group assigned to you. Select authorized destinations before trying again.", "destination_scope_required");
    }
  }

  /** SQL aliases are internal constants, never request input. EXISTS keeps rows deduplicated. */
  submissionFilter(user: AuthUser, groupId: string | null = null) {
    return {
      sql: `EXISTS (SELECT 1 FROM activity_releases authority_release
        JOIN activity_release_scopes authority_scope ON authority_scope.release_id=authority_release.id
        JOIN teaching_groups authority_group ON authority_group.id=authority_scope.teaching_group_id
          AND authority_group.subject_offering_id=a.subject_offering_id
        JOIN faculty_group_assignments authority_faculty ON authority_faculty.teaching_group_id=authority_group.id
        JOIN student_group_placements authority_placement ON authority_placement.teaching_group_id=authority_group.id
        JOIN enrollments authority_enrollment ON authority_enrollment.id=authority_placement.enrollment_id
          AND authority_enrollment.subject_offering_id=a.subject_offering_id
        WHERE authority_release.id=s.release_id AND authority_release.activity_id=s.activity_id
          AND authority_enrollment.student_id=s.student_id AND authority_enrollment.status='active'
          AND authority_faculty.faculty_id=? ${groupId ? "AND authority_group.id=?" : ""})`,
      params: groupId ? [user.id, groupId] : [user.id],
    };
  }

  assertSubmission(submissionId: string, user: AuthUser, groupId: string | null = null): void {
    const filter = this.submissionFilter(user, groupId);
    if (user.role !== "faculty" || !this.db.prepare(`SELECT 1 FROM submissions s
      JOIN activities a ON a.id=s.activity_id WHERE s.id=? AND ${filter.sql}`)
      .get(submissionId, ...filter.params)) throw new HttpError(404, "Submission not found");
  }

  eligibleStudentCount(activityId: string, user: AuthUser, groupId: string | null): number {
    // Published/unpublished evidence retains its current release scope. A never-released
    // draft uses its intended targets, filtered by the same current faculty/placement meet.
    return Number((this.db.prepare(`SELECT COUNT(DISTINCT e.student_id) AS count FROM activities a
      JOIN teaching_groups g ON g.subject_offering_id=a.subject_offering_id
      JOIN faculty_group_assignments f ON f.teaching_group_id=g.id AND f.faculty_id=?
      JOIN student_group_placements p ON p.teaching_group_id=g.id
      JOIN enrollments e ON e.id=p.enrollment_id AND e.subject_offering_id=a.subject_offering_id AND e.status='active'
      WHERE a.id=? ${groupId ? "AND g.id=?" : ""} AND (
        (a.current_release_id IS NOT NULL AND EXISTS (SELECT 1 FROM activity_release_scopes rs
          JOIN activity_releases r ON r.id=rs.release_id AND r.activity_id=a.id
          WHERE rs.release_id=a.current_release_id AND rs.teaching_group_id=g.id)) OR
        (a.current_release_id IS NULL AND EXISTS (SELECT 1 FROM activity_targets t WHERE t.activity_id=a.id AND t.teaching_group_id=g.id)) OR
        EXISTS (SELECT 1 FROM submissions s JOIN activity_release_scopes rs ON rs.release_id=s.release_id
          JOIN activity_releases r ON r.id=s.release_id AND r.activity_id=a.id
          WHERE s.activity_id=a.id AND s.student_id=e.student_id AND s.is_current_submission=1 AND rs.teaching_group_id=g.id))`)
      .get(user.id, activityId, ...(groupId ? [groupId] : [])) as { count: number }).count);
  }
}
