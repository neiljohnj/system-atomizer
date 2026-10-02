import * as Select from "@radix-ui/react-select";
import { AlertTriangle, ArrowRight, Check, ChevronDown, KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { atomApi } from "../../api";
import type { AuthSessionPayload, User } from "../../types";

interface AuthPageProps {
  httpWarning: boolean;
  demoAccountsEnabled?: boolean;
  onAuthenticated: (session: AuthSessionPayload, returnTo?: string) => void;
}

export function LoginPage({ httpWarning, demoAccountsEnabled = false, onAuthenticated }: AuthPageProps) {
  const [searchParams] = useSearchParams();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const switching = searchParams.get("mode") === "switch";
  const returnTo = safeReturnPath(searchParams.get("returnTo"));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setBusy(true);
      setError(null);
      const session = await atomApi.login(identifier, password);
      onAuthenticated(session, returnTo);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell httpWarning={httpWarning}>
      <div className="auth-heading">
        <p>{switching ? "Switch account" : "Local account"}</p>
        <h1>{switching ? "Sign in with another account" : "Sign in to ATOM"}</h1>
        <span>Faculty use their local username. Students use their student number.</span>
      </div>
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <label><span>Username or student number</span><input autoComplete="username" autoFocus required value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label>
        <label><span>Password</span><input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button--primary button--wide" disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}<ArrowRight size={17} />
        </button>
      </form>
      {demoAccountsEnabled ? (
        <section className="demo-login-panel" aria-label="Demo accounts">
          <header><strong>Demo access</strong><span>Choose an account to fill both fields.</span></header>
          <div>
            <button type="button" onClick={() => { setIdentifier("faculty-demo"); setPassword("faculty-demo"); setError(null); }}>Faculty Demo</button>
            <button type="button" onClick={() => { setIdentifier("2026-00001"); setPassword("2026-00001"); setError(null); }}>Student Demo</button>
            <button type="button" onClick={() => { setIdentifier("2026-00002"); setPassword("2026-00002"); setError(null); }}>Second Student</button>
          </div>
        </section>
      ) : null}
      <footer className="auth-footer"><Link to="/local-recovery">Faculty account recovery on this computer</Link></footer>
    </AuthShell>
  );
}

export function SetupPage({ httpWarning, onAuthenticated }: AuthPageProps) {
  const [legacyFaculty,setLegacyFaculty]=useState<User[]>([]);
  const [facultyId,setFacultyId]=useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(()=>{let active=true;void atomApi.recoverableFaculty().then(rows=>{if(active)setLegacyFaculty(rows);}).catch(()=>{});return()=>{active=false;};},[]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      onAuthenticated(await atomApi.initialize(displayName, username, password, facultyId || undefined));
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Setup could not be completed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell httpWarning={httpWarning}>
      <div className="auth-heading"><p>Host-local initialization</p><h1>{legacyFaculty.length?"Establish existing faculty access":"Create the installation owner"}</h1><span>{legacyFaculty.length?"Choose the exact existing identity. Authored records retain their IDs. An operator grant at /local-owner is a separate deliberate step after sign-in.":"A fresh installation starts empty. Create your own account, then use Set up course to configure teaching."}</span></div>
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        {legacyFaculty.length?<label><span>Existing faculty identity</span><select required value={facultyId} onChange={e=>setFacultyId(e.target.value)}><option value="">Choose the identity to claim</option>{legacyFaculty.map(f=><option key={f.id} value={f.id}>{f.displayName} · {f.id}</option>)}</select></label>:null}
        <label><span>Faculty name</span><input autoFocus required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
        <label><span>Local username</span><input autoComplete="username" pattern={"[A-Za-z0-9][A-Za-z0-9._\\-]{2,63}"} required value={username} onChange={(event) => setUsername(event.target.value)} /></label>
        <label><span>Password</span><input type="password" minLength={10} maxLength={128} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} /><small>10–128 characters</small></label>
        <label><span>Confirm password</span><input type="password" minLength={10} maxLength={128} autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button--primary button--wide" disabled={busy} type="submit">{busy ? "Creating account…" : "Complete setup"}<ShieldCheck size={17} /></button>
      </form>
    </AuthShell>
  );
}

export function ChangePasswordPage({
  forced,
  onChanged,
  onSignOut,
}: {
  forced: boolean;
  onChanged: (session: AuthSessionPayload) => void;
  onSignOut: () => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      return;
    }
    try {
      setBusy(true);
      setError(null);
      onChanged(await atomApi.changePassword(currentPassword, newPassword));
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "Password could not be changed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell httpWarning={false} compact>
      <div className="auth-heading"><p>{forced ? "Password change required" : "Account security"}</p><h1>{forced ? "Choose your own password" : "Change password"}</h1><span>{forced ? "Your temporary password cannot be used to enter the workspace." : "Changing your password keeps the current browser session active."}</span></div>
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        <label><span>Current password</span><input type="password" autoComplete="current-password" autoFocus required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label>
        <label><span>New password</span><input type="password" minLength={10} maxLength={128} autoComplete="new-password" required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /><small>10–128 characters</small></label>
        <label><span>Confirm new password</span><input type="password" minLength={10} maxLength={128} autoComplete="new-password" required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="button button--primary button--wide" disabled={busy} type="submit">{busy ? "Updating…" : "Change password"}<KeyRound size={17} /></button>
      </form>
      <footer className="auth-footer"><button className="text-button" onClick={onSignOut}><LogOut size={14} />Sign out</button></footer>
    </AuthShell>
  );
}

export function RecoveryPage({ httpWarning }: { httpWarning: boolean }) {
  const [faculty, setFaculty] = useState<User[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void atomApi.recoverableFaculty().then((users) => {
      setFaculty(users);
      setSelectedId(users[0]?.id ?? "");
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Recovery is unavailable"));
  }, []);
  const reset = async () => {
    if (!selectedId) return;
    try {
      setBusy(true);
      setError(null);
      setTemporaryPassword((await atomApi.resetFaculty(selectedId)).temporaryPassword);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Recovery failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell httpWarning={httpWarning}>
      <div className="auth-heading"><p>Host-computer maintenance</p><h1>Recover a faculty account</h1><span>This action works only through localhost and revokes the account’s active sessions.</span></div>
      {temporaryPassword ? (
        <div className="temporary-password"><Check size={22} /><div><strong>Temporary password</strong><code>{temporaryPassword}</code><span>Record it now. ATOM will require a new password at sign-in.</span></div></div>
      ) : (
        <div className="auth-form">
          <label><span>Faculty account</span>
            <Select.Root value={selectedId} onValueChange={setSelectedId}>
              <Select.Trigger className="select-trigger form-select"><Select.Value placeholder="Select faculty" /><Select.Icon><ChevronDown size={15} /></Select.Icon></Select.Trigger>
              <Select.Portal><Select.Content className="select-content" position="popper"><Select.Viewport>{faculty.map((user) => <Select.Item className="select-item" value={user.id} key={user.id}><Select.ItemIndicator><Check size={13} /></Select.ItemIndicator><Select.ItemText>{user.displayName}</Select.ItemText></Select.Item>)}</Select.Viewport></Select.Content></Select.Portal>
            </Select.Root>
          </label>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="button button--primary button--wide" disabled={busy || !selectedId} onClick={() => void reset()}>{busy ? "Resetting…" : "Generate temporary password"}</button>
        </div>
      )}
      <footer className="auth-footer"><Link to="/login">Return to sign in</Link></footer>
    </AuthShell>
  );
}

function AuthShell({ children, httpWarning, compact = false }: { children: React.ReactNode; httpWarning: boolean; compact?: boolean }) {
  return (
    <main className={`auth-shell${compact ? " auth-shell--compact" : ""}`}>
      <section className="auth-brand-panel"><img src="/atom-mark.png" alt="" /><strong>ATOM</strong><span>Local academic workspace</span></section>
      <section className="auth-card">
        {httpWarning ? <div className="transport-warning"><AlertTriangle size={17} /><span>Local HTTP mode is active. Traffic on this LAN is not encrypted until HTTPS is configured.</span></div> : null}
        {children}
      </section>
    </main>
  );
}

function safeReturnPath(value: string | null): string | undefined {
  return value?.startsWith("/") && !value.startsWith("//") ? value : undefined;
}
