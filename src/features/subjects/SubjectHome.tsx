import { ArrowRight, BookOpen, FlaskConical } from "lucide-react";
import { Link } from "react-router-dom";
import type { AcademicTerm, Role } from "../../types";

export function SubjectHome({ academicTerms, role, canSetup = false }: { academicTerms: AcademicTerm[]; role: Role; canSetup?: boolean }) {
  return (
    <main className="subject-home">
      <header className="subject-home__intro">
        <p>{role === "faculty" ? "Faculty workspace" : "Student workspace"}</p>
        <h1>Your subjects</h1>
        <span>Select a subject to open its activities, quizzes, and exams.</span>
        {canSetup ? <Link className="button button--primary setup-entry" to="/course-setup">Set up course</Link> : null}
      </header>
      {academicTerms.length ? academicTerms.map((term) => (
        <section className="term-section" key={term.id}>
          <header><h2>{term.label}</h2><span>{term.offerings.length} subject{term.offerings.length === 1 ? "" : "s"}</span></header>
          <div className="subject-grid">
            {term.offerings.map((offering) => (
              <Link className="subject-card" to={`/subjects/${offering.id}/activities`} key={offering.id}>
                <div className="subject-card__mark"><BookOpen size={22} /></div>
                <div className="subject-card__body">
                  <strong>{offering.code}</strong>
                  <h3>{offering.title}</h3>
                  {offering.setupOnly ? <small>Setup management · {offering.setupState}</small> : null}
                  <div className="group-chip-row">
                    {offering.groups.map((group) => (
                      <span className="group-chip" key={group.id}>
                        {group.componentKind === "laboratory" ? <FlaskConical size={12} /> : null}
                        {group.label}
                      </span>
                    ))}
                  </div>
                </div>
                <ArrowRight className="subject-card__arrow" size={19} />
              </Link>
            ))}
          </div>
        </section>
      )) : (
        <div className="empty-state"><BookOpen size={34} /><h2>No assigned subjects</h2><p>No current subject offering is linked to this account.</p></div>
      )}
    </main>
  );
}
