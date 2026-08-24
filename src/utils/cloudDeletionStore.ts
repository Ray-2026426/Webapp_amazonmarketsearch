import { get, set } from 'idb-keyval';

const KEY_PREFIX = 'amzdev_cloud_deletions:';

function key(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

export async function loadPendingCloudDeletions(userId: string): Promise<string[]> {
  const value = await get<unknown>(key(userId));
  return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))] : [];
}

export async function recordPendingCloudDeletion(userId: string, projectId: string): Promise<void> {
  const current = await loadPendingCloudDeletions(userId);
  if (!current.includes(projectId)) await set(key(userId), [...current, projectId]);
}

export async function clearPendingCloudDeletions(userId: string, projectIds: string[]): Promise<void> {
  const cleared = new Set(projectIds);
  const current = await loadPendingCloudDeletions(userId);
  await set(key(userId), current.filter((id) => !cleared.has(id)));
}
