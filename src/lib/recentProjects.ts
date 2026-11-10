export interface RecentProject {
  path: string;
  title: string;
  openedAt: string;
}

const KEY = 'tonal.recentProjects.v1';
const LIMIT = 8;

export function readRecentProjects(): RecentProject[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is RecentProject =>
          Boolean(
            entry &&
              typeof entry === 'object' &&
              typeof (entry as RecentProject).path === 'string' &&
              typeof (entry as RecentProject).title === 'string',
          ),
      )
      .slice(0, LIMIT);
  } catch {
    return [];
  }
}

export function rememberRecentProject(path: string, title: string): RecentProject[] {
  const existing = readRecentProjects().filter((entry) => entry.path !== path);
  const next: RecentProject[] = [
    { path, title, openedAt: new Date().toISOString() },
    ...existing,
  ].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Local storage may be unavailable; recents are an optional convenience.
  }
  return next;
}

export function removeRecentProject(path: string): RecentProject[] {
  const next = readRecentProjects().filter((entry) => entry.path !== path);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures.
  }
  return next;
}
