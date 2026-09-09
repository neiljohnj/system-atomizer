import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, CircleUserRound, KeyRound, LogOut, Repeat2, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import type { PreviewIdentities, SubjectOffering, User } from "../types";

interface AppHeaderProps {
  currentUser: User;
  activeOffering: SubjectOffering | null;
  previewIdentities: PreviewIdentities | null;
  onUserChange: (userId: string) => void;
  onSignOut: () => void;
  onSwitchAccount: () => void;
}

export function AppHeader({
  currentUser,
  activeOffering,
  previewIdentities,
  onUserChange,
  onSignOut,
  onSwitchAccount,
}: AppHeaderProps) {
  const identity = currentUser.studentNumber
    ? `${currentUser.studentNumber} · ${currentUser.displayName}`
    : currentUser.displayName;

  return (
    <>
      <header className={`app-header app-header--${currentUser.role}`}>
        <Link className="brand-lockup" to="/subjects" aria-label="ATOM subject home">
          <img src="/atom-mark.png" alt="" className="brand-mark" />
          <span>ATOM</span>
        </Link>
        <div className="header-course" aria-label="Current subject">
          {activeOffering ? (
            <>
              <strong>{activeOffering.code}</strong>
              <span>{activeOffering.title}</span>
            </>
          ) : (
            <span>Subject workspace</span>
          )}
        </div>
        <div className="connection-state">
          <Wifi size={15} aria-hidden="true" />
          <span>Connected locally</span>
          <span className="connection-address">192.168.10.150</span>
        </div>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="account-trigger" aria-label="Open account menu">
            <CircleUserRound size={19} aria-hidden="true" />
            <span className="account-trigger__copy">
              <strong>{identity}</strong>
              <small>{currentUser.role === "faculty" ? "Faculty" : "Student"}</small>
            </span>
            <ChevronDown size={15} aria-hidden="true" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className="menu-content" align="end" sideOffset={7}>
              <DropdownMenu.Label className="menu-label">Signed in locally</DropdownMenu.Label>
              <DropdownMenu.Item className="menu-item" disabled>
                <span>{identity}</span>
                <small>{currentUser.role === "faculty" ? "Faculty account" : "Student account"}</small>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="menu-separator" />
              <DropdownMenu.Item className="menu-item menu-item--action" asChild>
                <Link to="/change-password"><KeyRound size={15} /><span>Change password</span></Link>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item menu-item--action" onSelect={onSwitchAccount}>
                <Repeat2 size={15} /><span>Switch account</span>
              </DropdownMenu.Item>
              <DropdownMenu.Item className="menu-item menu-item--action" onSelect={onSignOut}>
                <LogOut size={15} /><span>Sign out</span>
              </DropdownMenu.Item>
              <DropdownMenu.Arrow className="menu-arrow" />
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </header>
      {previewIdentities ? (
        <div className="preview-bar">
          <span>Development preview</span>
          <Select.Root value={currentUser.id} onValueChange={onUserChange}>
            <Select.Trigger className="select-trigger select-trigger--preview" aria-label="Preview as user">
              <Select.Value />
              <Select.Icon><ChevronDown size={14} /></Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Content className="select-content" position="popper" sideOffset={5}>
                <Select.Viewport>
                  <IdentityGroup label="Faculty" users={previewIdentities.faculty} />
                  <IdentityGroup label="Students" users={previewIdentities.students} />
                </Select.Viewport>
              </Select.Content>
            </Select.Portal>
          </Select.Root>
          <small>Identity switching is available only while the preview flag is enabled.</small>
        </div>
      ) : null}
    </>
  );
}

function IdentityGroup({ label, users }: { label: string; users: User[] }) {
  if (!users.length) return null;
  return (
    <Select.Group>
      <Select.Label className="select-label">{label}</Select.Label>
      {users.map((user) => (
        <Select.Item className="select-item" value={user.id} key={user.id}>
          <Select.ItemIndicator><Check size={13} /></Select.ItemIndicator>
          <Select.ItemText>
            {user.studentNumber ? `${user.studentNumber} · ${user.displayName}` : user.displayName}
          </Select.ItemText>
        </Select.Item>
      ))}
    </Select.Group>
  );
}
