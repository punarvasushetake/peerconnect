import api from './api';

const adminUserIds = (process.env.NEXT_PUBLIC_ADMIN_USER_IDS || '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

export function isConfiguredAdmin(userId?: string | null): boolean {
  return Boolean(userId && adminUserIds.includes(userId));
}

export async function hasAdminAccess(): Promise<boolean> {
  try {
    await api.get('/admin/access');
    return true;
  } catch {
    return false;
  }
}
