'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, Search, Bell, LogOut } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useSocket } from '@/contexts/SocketContext';
import Avatar from '@/components/ui/Avatar';
import api from '@/lib/api';
import { unwrapData } from '@/lib/apiResponse';
import { isGuestUser } from '@/lib/guestSession';

interface TopbarProps {
  onMenuClick: () => void;
}

export default function Topbar({ onMenuClick }: TopbarProps) {
  const router = useRouter();
  const { profile, signOut, user } = useAuth();
  const { socket } = useSocket();
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read_at).length,
    [notifications]
  );

  const loadNotifications = async () => {
    if (!user || isGuestUser(user)) return;
    try {
      const response = await api.get('/notifications?limit=10');
      setNotifications(unwrapData<NotificationItem[]>(response) || []);
    } catch {
      // Notifications should never block the main shell.
    }
  };

  useEffect(() => {
    loadNotifications();
  }, [user?.id]);

  useEffect(() => {
    if (!socket) return;

    const handleNotification = (notification: NotificationItem) => {
      setNotifications((prev) => [notification, ...prev].slice(0, 10));
      toast(
        <div>
          <p className="text-sm font-semibold text-slate-900">{notification.title}</p>
          {notification.message && (
            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{notification.message}</p>
          )}
        </div>
      );
    };

    socket.on('notification:new', handleNotification);
    return () => {
      socket.off('notification:new', handleNotification);
    };
  }, [socket]);

  const handleSignOut = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await signOut();
    } finally {
      setLoggingOut(false);
    }
  };

  const openNotification = async (notification: NotificationItem) => {
    setNotificationsOpen(false);
    if (!notification.read_at) {
      setNotifications((prev) =>
        prev.map((item) =>
          item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item
        )
      );
      await api.post(`/notifications/${notification.id}/read`).catch(() => undefined);
    }
    const actionUrl = notification.metadata?.actionUrl || '/video-session';
    try {
      const parsedUrl = new URL(actionUrl, window.location.origin);
      router.push(`${parsedUrl.pathname}${parsedUrl.search}`);
    } catch {
      router.push('/video-session');
    }
  };

  const markAllRead = async () => {
    setNotifications((prev) =>
      prev.map((item) => ({ ...item, read_at: item.read_at || new Date().toISOString() }))
    );
    await api.post('/notifications/read-all').catch(() => undefined);
  };

  return (
    <header className="fixed top-0 left-0 md:left-64 right-0 h-16 bg-white/80 backdrop-blur-sm border-b border-slate-200 z-30 flex items-center px-4 gap-4">
      {/* Mobile hamburger menu */}
      <button
        onClick={onMenuClick}
        className="p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition md:hidden"
        aria-label="Toggle menu"
      >
        <Menu size={22} />
      </button>

      {/* Search bar */}
      <div className="flex-1 flex justify-center">
        <div className="relative max-w-md w-full">
          <Search
            size={18}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search peers, skills, courses..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg bg-slate-50 border-none pl-10 pr-4 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
          />
        </div>
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-3">
        {/* Notification bell */}
        <div className="relative">
          <button
            onClick={() => setNotificationsOpen((open) => !open)}
            className="relative p-2 rounded-lg text-slate-600 hover:bg-slate-100 transition"
            aria-label="Notifications"
          >
            <Bell size={20} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white ring-2 ring-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {notificationsOpen && (
            <div className="absolute right-0 mt-2 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                <p className="text-sm font-semibold text-slate-900">Notifications</p>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-xs font-medium text-blue-600 hover:text-blue-700"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-500">
                  No notifications yet
                </div>
              ) : (
                <div className="max-h-96 overflow-y-auto py-1">
                  {notifications.map((notification) => (
                    <button
                      key={notification.id}
                      onClick={() => openNotification(notification)}
                      className="block w-full px-4 py-3 text-left hover:bg-slate-50"
                    >
                      <div className="flex items-start gap-2">
                        {!notification.read_at && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900">{notification.title}</p>
                          {notification.message && (
                            <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                              {notification.message}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* User avatar */}
        <button className="flex items-center gap-2 p-1 rounded-lg hover:bg-slate-100 transition">
          <Avatar
            src={profile?.avatar_url}
            name={profile?.full_name ?? 'User'}
            size="sm"
          />
          <span className="hidden sm:block text-sm font-medium text-slate-700 max-w-[120px] truncate">
            {profile?.full_name ?? 'User'}
          </span>
        </button>

        <button
          onClick={handleSignOut}
          disabled={loggingOut}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 disabled:cursor-not-allowed transition"
          aria-label="Sign out"
        >
          <LogOut size={16} />
          <span className="hidden sm:inline">{loggingOut ? 'Signing out...' : 'Logout'}</span>
        </button>
      </div>
    </header>
  );
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message?: string | null;
  read_at?: string | null;
  metadata?: {
    actionUrl?: string;
  };
}
