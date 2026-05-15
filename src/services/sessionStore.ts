import * as FileSystem from "expo-file-system/legacy";

export interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface Session {
  id: string;
  startedAt: string;
  lastActivityAt: string;
  messages: Message[];
}

const SESSIONS_DIR = `${FileSystem.documentDirectory}sessions/`;
const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(SESSIONS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(SESSIONS_DIR, { intermediates: true });
  }
}

function sessionPath(id: string): string {
  return `${SESSIONS_DIR}${id}.json`;
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function formatSessionTitle(isoDate: string): string {
  const d = new Date(isoDate);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export async function createSession(): Promise<Session> {
  await ensureDir();
  const now = new Date().toISOString();
  const session: Session = {
    id: generateId(),
    startedAt: now,
    lastActivityAt: now,
    messages: [],
  };
  await FileSystem.writeAsStringAsync(sessionPath(session.id), JSON.stringify(session));
  return session;
}

export async function saveSession(session: Session): Promise<void> {
  await ensureDir();
  await FileSystem.writeAsStringAsync(sessionPath(session.id), JSON.stringify(session));
}

export async function appendMessage(session: Session, message: Message): Promise<Session> {
  const updated: Session = {
    ...session,
    lastActivityAt: new Date().toISOString(),
    messages: [...session.messages, message],
  };
  await saveSession(updated);
  return updated;
}

export async function listSessions(): Promise<Session[]> {
  await ensureDir();
  const files = await FileSystem.readDirectoryAsync(SESSIONS_DIR);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));
  const results = await Promise.all(
    jsonFiles.map(async (file) => {
      try {
        const content = await FileSystem.readAsStringAsync(`${SESSIONS_DIR}${file}`);
        return JSON.parse(content) as Session;
      } catch {
        return null;
      }
    }),
  );
  return results
    .filter((s): s is Session => s !== null)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export async function loadLatestSession(): Promise<Session | null> {
  const sessions = await listSessions();
  return sessions[0] ?? null;
}

export function isSessionStale(session: Session): boolean {
  const lastActivity = new Date(session.lastActivityAt).getTime();
  return Date.now() - lastActivity > IDLE_TIMEOUT_MS;
}

export async function getOrCreateActiveSession(): Promise<Session> {
  const latest = await loadLatestSession();
  if (!latest || isSessionStale(latest)) {
    return createSession();
  }
  return latest;
}
