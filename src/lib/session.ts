/**
 * Remembers who this tab is, so a refresh or a locked phone puts you straight
 * back into your game.
 *
 * sessionStorage (not localStorage) is deliberate: each tab gets its own, so
 * you can test with several player tabs open on one laptop.
 */

export interface HostSession {
  roomCode: string;
  hostToken: string;
}

export interface PlayerSession {
  roomCode: string;
  playerId: string;
}

const HOST_KEY = "roomful:host";
const PLAYER_KEY = "roomful:player";
const NAME_KEY = "roomful:last-name";

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
    // Private mode or storage blocked: the game still works, you just won't auto-rejoin.
  }
}

const session = () => window.sessionStorage;
const local = () => window.localStorage;

export const loadHostSession = () => read<HostSession>(session, HOST_KEY);
export const saveHostSession = (s: HostSession | null) => write(session, HOST_KEY, s);

export const loadPlayerSession = () => read<PlayerSession>(session, PLAYER_KEY);
export const savePlayerSession = (s: PlayerSession | null) => write(session, PLAYER_KEY, s);

/** The name you typed last time, pre-filled for convenience. */
export const loadLastName = () => read<string>(local, NAME_KEY) ?? "";
export const saveLastName = (name: string) => write(local, NAME_KEY, name);
