/**
 * Remembers who this tab is, so a refresh or a locked phone puts you straight
 * back into the quiz.
 *
 * sessionStorage (not localStorage) is deliberate: each tab gets its own, so
 * several Participant tabs can be tested on one laptop. If a phone closes the
 * tab completely, typing the same name again reclaims the seat.
 */

export interface HostSession {
  roomCode: string;
  hostToken: string;
}

export interface ParticipantSession {
  roomCode: string;
  participantId: string;
}

export interface AdminSession {
  roomCode: string;
  pin: string;
}

function read<T>(storage: () => Storage, key: string): T | null {
  try {
    const raw = storage().getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: unknown) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or storage blocked: everything still works, just no auto-rejoin.
  }
}

const session = () => window.sessionStorage;
const local = () => window.localStorage;

export const loadHostSession = () => read<HostSession>(session, "hermes:host");
export const saveHostSession = (s: HostSession | null) => write(session, "hermes:host", s);

export const loadParticipantSession = () => read<ParticipantSession>(session, "hermes:participant");
export const saveParticipantSession = (s: ParticipantSession | null) => write(session, "hermes:participant", s);

export const loadAdminSession = () => read<AdminSession>(session, "hermes:admin");
export const saveAdminSession = (s: AdminSession | null) => write(session, "hermes:admin", s);

/** The name typed last time, pre-filled for convenience. */
export const loadLastName = () => read<string>(local, "hermes:last-name") ?? "";
export const saveLastName = (name: string) => write(local, "hermes:last-name", name);
