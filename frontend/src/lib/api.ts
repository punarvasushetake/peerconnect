import axios from 'axios';
import { clearStoredSupabaseSession, getCurrentSession } from './supabase';
import { isGuestSessionActive } from './guestSession';

const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use(async (config) => {
  if (isGuestSessionActive()) {
    return config;
  }

  const session = await getCurrentSession();
  if (session?.access_token) {
    config.headers.Authorization = `Bearer ${session.access_token}`;
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      if (isGuestSessionActive()) {
        return Promise.reject(error);
      }

      clearStoredSupabaseSession();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
