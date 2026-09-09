import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { atomApi } from "./api";
import { AppHeader } from "./components/AppHeader";
import { ChangePasswordPage, LoginPage, RecoveryPage, SetupPage } from "./features/auth/AuthPages";
import { SubjectHome } from "./features/subjects/SubjectHome";
import { SubjectWorkspace } from "./features/subjects/SubjectWorkspace";
import type { AuthSessionPayload, BootstrapPayload } from "./types";

const ActivityAuthoring = lazy(() => import("./features/authoring/ActivityAuthoring"));

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const [session, setSession] = useState<AuthSessionPayload | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unsyncedDraft, setUnsyncedDraft] = useState(false);
  const [loggedOutDestination, setLoggedOutDestination] = useState("/login");

  const loadBootstrap = useCallback(async () => {
    const payload = await atomApi.bootstrap();
    setBootstrap(payload);
    return payload;
  }, []);

  const loadSession = useCallback(async () => {
    try {
      setError(null);
      const payload = await atomApi.authSession();
      setSession(payload);
      if (payload.authenticated && !payload.mustChangePassword) await loadBootstrap();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "ATOM is unavailable");
    } finally {
      setLoading(false);
    }
  }, [loadBootstrap]);

  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => {
    const expired = () => {
      setSession((current) => ({ authenticated: false, setupRequired: false, httpWarning: current?.httpWarning ?? true }));
      setBootstrap(null);
      const returnTo = `${window.location.pathname}${window.location.search}`;
      navigate(`/login?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
    };
    const draftSync = (event: Event) => setUnsyncedDraft(Boolean((event as CustomEvent<{ unsynced: boolean }>).detail?.unsynced));
    window.addEventListener("atom:session-expired", expired);
    window.addEventListener("atom:draft-sync", draftSync);
    return () => {
      window.removeEventListener("atom:session-expired", expired);
      window.removeEventListener("atom:draft-sync", draftSync);
    };
  }, [navigate]);

  const authenticated = async (nextSession: AuthSessionPayload, returnTo?: string) => {
    setSession(nextSession);
    if (nextSession.mustChangePassword) {
      navigate("/change-password", { replace: true });
      return;
    }
    navigate(returnTo ?? "/subjects", { replace: true });
    await loadBootstrap();
  };

  const signOut = async (switching = false) => {
    if (unsyncedDraft && !window.confirm("This draft is saved only on this device. Sign out and keep the recovery copy?")) return;
    const returnTo = switching ? `${location.pathname}${location.search}` : undefined;
    try { await atomApi.logout(); } catch { /* The local UI still clears an expired session. */ }
    const destination = switching
      ? `/login?mode=switch&returnTo=${encodeURIComponent(returnTo ?? "/subjects")}`
      : "/login";
    setLoggedOutDestination(destination);
    setSession({ authenticated: false, setupRequired: false, httpWarning: session?.httpWarning ?? true });
    setBootstrap(null);
    navigate(destination, { replace: true });
  };

  const changePreviewIdentity = async (userId: string) => {
    try {
      setLoading(true);
      const nextSession = await atomApi.assumeIdentity(userId);
      setSession(nextSession);
      navigate("/subjects", { replace: true });
      await loadBootstrap();
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview identity could not be changed");
    } finally {
      setLoading(false);
    }
  };

  const activeOffering = useMemo(() => {
    if (!bootstrap) return null;
    const match = location.pathname.match(/^\/subjects\/([^/]+)/);
    return bootstrap.academicTerms.flatMap((term) => term.offerings).find((offering) => offering.id === match?.[1]) ?? null;
  }, [bootstrap, location.pathname]);

  if (loading && !session) return <div className="app-loading">Opening the local ATOM workspace…</div>;
  if (!session) return <FatalState error={error} onRetry={() => void loadSession()} />;

  if (!session.authenticated) {
    return <Routes>
      <Route path="/setup" element={session.setupRequired ? <SetupPage httpWarning={session.httpWarning} onAuthenticated={(value) => void authenticated(value)} /> : <Navigate to="/login" replace />} />
      <Route path="/local-recovery" element={<RecoveryPage httpWarning={session.httpWarning} />} />
      <Route path="/login" element={session.setupRequired ? <Navigate to="/setup" replace /> : <LoginPage httpWarning={session.httpWarning} demoAccountsEnabled={session.demoAccountsEnabled} onAuthenticated={(value, returnTo) => void authenticated(value, returnTo)} />} />
      <Route path="*" element={<Navigate to={session.setupRequired ? "/setup" : loggedOutDestination} replace />} />
    </Routes>;
  }

  if (session.mustChangePassword) {
    return <Routes><Route path="/change-password" element={<ChangePasswordPage forced onChanged={(value) => void authenticated({ ...session, ...value, authenticated: true })} onSignOut={() => void signOut()} />} /><Route path="*" element={<Navigate to="/change-password" replace />} /></Routes>;
  }

  if (!bootstrap) return error ? <FatalState error={error} onRetry={() => void loadBootstrap()} /> : <div className="app-loading">Loading your subjects…</div>;

  return (
    <div className={`app app--${bootstrap.currentUser.role}`}>
      <AppHeader currentUser={bootstrap.currentUser} activeOffering={activeOffering} previewIdentities={bootstrap.previewIdentities} onUserChange={(id) => void changePreviewIdentity(id)} onSignOut={() => void signOut()} onSwitchAccount={() => void signOut(true)} />
      {error ? <div className="toast toast--error" role="alert">{error}<button onClick={() => setError(null)} aria-label="Dismiss message">×</button></div> : null}
      <Suspense fallback={<div className="app-loading">Opening workspace…</div>}>
        <Routes>
          <Route path="/change-password" element={<ChangePasswordPage forced={false} onChanged={(value) => void authenticated({ ...session, ...value, authenticated: true })} onSignOut={() => void signOut()} />} />
          <Route path="/subjects" element={<SubjectHome academicTerms={bootstrap.academicTerms} role={bootstrap.currentUser.role} />} />
          <Route path="/subjects/:offeringId/activities/new" element={bootstrap.currentUser.role === "faculty" ? <ActivityAuthoring bootstrap={bootstrap} onError={setError} /> : <Navigate to="/subjects" replace />} />
          <Route path="/subjects/:offeringId/activities/:activityId/edit" element={bootstrap.currentUser.role === "faculty" ? <ActivityAuthoring bootstrap={bootstrap} onError={setError} /> : <Navigate to="/subjects" replace />} />
          <Route path="/subjects/:offeringId/activities" element={<SubjectWorkspace bootstrap={bootstrap} module="activities" onError={setError} />} />
          <Route path="/subjects/:offeringId/activities/:activityId" element={<SubjectWorkspace bootstrap={bootstrap} module="activities" onError={setError} />} />
          <Route path="/subjects/:offeringId/quizzes" element={<SubjectWorkspace bootstrap={bootstrap} module="quizzes" onError={setError} />} />
          <Route path="/subjects/:offeringId/exams" element={<SubjectWorkspace bootstrap={bootstrap} module="exams" onError={setError} />} />
          <Route path="/subjects/:offeringId/submissions" element={<SubjectWorkspace bootstrap={bootstrap} module="submissions" onError={setError} />} />
          <Route path="/subjects/:offeringId/students" element={bootstrap.currentUser.role === "faculty" ? <SubjectWorkspace bootstrap={bootstrap} module="students" onError={setError} /> : <Navigate to="/subjects" replace />} />
          <Route path="*" element={<Navigate to="/subjects" replace />} />
        </Routes>
      </Suspense>
    </div>
  );
}

function FatalState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return <main className="fatal-state"><img src="/atom-mark.png" alt="" /><h1>ATOM could not reach the local server</h1><p>{error}</p><button className="button button--primary" onClick={onRetry}>Try again</button></main>;
}
