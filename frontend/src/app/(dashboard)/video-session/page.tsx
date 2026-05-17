'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import {
  Video,
  Users,
  Star,
  MonitorUp,
  PhoneOff,
  Mail,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { JitsiMeeting } from '@jitsi/react-sdk';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import { unwrapData } from '@/lib/apiResponse';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { isGuestUser } from '@/lib/guestSession';

interface Skill {
  id: string;
  name: string;
}

interface PeerRequest {
  id: string;
  topic: string;
  status: string;
  skill_id: string;
  created_at: string;
  skills?: Skill;
}

interface MatchItem {
  id: string;
  matched_user_id: string;
  match_score: number;
  accepted: boolean;
  profiles?: {
    id: string;
    full_name: string;
    avatar_url?: string | null;
    headline?: string | null;
  };
}

interface SessionItem {
  id: string;
  room_name: string;
  join_url: string;
  provider: string;
  status: SessionStatus;
  requester_id?: string;
  started_at: string | null;
  ended_at?: string | null;
  expires_at?: string | null;
  declined_at?: string | null;
  decline_reason?: string | null;
  mentor_user_id?: string;
  peer_requests?: {
    id: string;
    topic: string;
    description?: string | null;
    status: string;
  };
  profiles?: {
    id: string;
    full_name: string;
    headline?: string | null;
  };
}

type SessionStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled' | 'ended';

interface SessionRequestResponse {
  session: SessionItem;
  email_sent: boolean;
  message: string;
}

interface FeedbackItem {
  id: string;
  session_id: string;
  from_user_id: string;
  to_user_id: string;
}

const ENGINEERING_SKILLS: Skill[] = [
  { id: 'eng-dsa', name: 'Data Structures & Algorithms' },
  { id: 'eng-system-design', name: 'System Design' },
  { id: 'eng-backend', name: 'Backend Engineering' },
  { id: 'eng-distributed', name: 'Distributed Systems' },
  { id: 'eng-ml', name: 'Machine Learning' },
  { id: 'eng-dl', name: 'Deep Learning' },
  { id: 'eng-nlp', name: 'Natural Language Processing' },
  { id: 'eng-cv', name: 'Computer Vision' },
  { id: 'eng-mlops', name: 'MLOps' },
  { id: 'eng-cloud', name: 'Cloud & DevOps' },
];

const GUEST_MENTORS: MatchItem[] = [
  {
    id: 'mentor-1',
    matched_user_id: 'mentor-user-1',
    match_score: 96,
    accepted: false,
    profiles: {
      id: 'mentor-user-1',
      full_name: 'Aisha Verma',
      avatar_url: null,
      headline: 'Backend + System Design',
    },
  },
  {
    id: 'mentor-2',
    matched_user_id: 'mentor-user-2',
    match_score: 92,
    accepted: false,
    profiles: {
      id: 'mentor-user-2',
      full_name: 'Rahul Nair',
      avatar_url: null,
      headline: 'AIML (NLP/LLMs)',
    },
  },
  {
    id: 'mentor-3',
    matched_user_id: 'mentor-user-3',
    match_score: 89,
    accepted: false,
    profiles: {
      id: 'mentor-user-3',
      full_name: 'Neha Singh',
      avatar_url: null,
      headline: 'Computer Vision + MLOps',
    },
  },
];

const JITSI_DOMAIN = (process.env.NEXT_PUBLIC_JITSI_DOMAIN || 'meet.jit.si')
  .replace(/^https?:\/\//, '')
  .replace(/\/$/, '');
const JITSI_APP_ID = (process.env.NEXT_PUBLIC_JITSI_APP_ID || '').replace(/^\/+|\/+$/g, '');

const getJitsiRoomName = (roomName: string) => (JITSI_APP_ID ? `${JITSI_APP_ID}/${roomName}` : roomName);
const getJitsiJoinUrl = (roomName: string) => `https://${JITSI_DOMAIN}/${getJitsiRoomName(roomName)}`;

const getEffectiveSessionStatus = (session: SessionItem): SessionStatus => {
  if (session.status === 'pending' && session.expires_at && new Date(session.expires_at).getTime() <= Date.now()) {
    return 'expired';
  }
  if (session.status) return session.status;
  return session.started_at ? 'accepted' : 'pending';
};

const getStatusBadge = (status: SessionStatus): { label: string; variant: 'default' | 'primary' | 'success' | 'warning' | 'error' } => {
  switch (status) {
    case 'accepted':
      return { label: 'Accepted', variant: 'success' };
    case 'declined':
      return { label: 'Declined', variant: 'error' };
    case 'expired':
      return { label: 'Expired', variant: 'warning' };
    case 'cancelled':
      return { label: 'Cancelled', variant: 'default' };
    case 'ended':
      return { label: 'Ended', variant: 'default' };
    default:
      return { label: 'Waiting', variant: 'primary' };
  }
};

const formatTimeRemaining = (expiresAt?: string | null) => {
  if (!expiresAt) return 'No expiry set';
  const diffMs = new Date(expiresAt).getTime() - Date.now();
  if (diffMs <= 0) return 'Expired';
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export default function VideoSessionPage() {
  const searchParams = useSearchParams();
  const { profile, user } = useAuth();
  const guestMode = isGuestUser(user);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [requests, setRequests] = useState<PeerRequest[]>([]);
  const [selectedRequestId, setSelectedRequestId] = useState('');
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<SessionItem[]>([]);
  const [activeSession, setActiveSession] = useState<SessionItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [requestingMatchId, setRequestingMatchId] = useState<string | null>(null);
  const [acceptingSessionId, setAcceptingSessionId] = useState<string | null>(null);
  const [decliningSessionId, setDecliningSessionId] = useState<string | null>(null);
  const [cancellingSessionId, setCancellingSessionId] = useState<string | null>(null);
  const [endingSessionId, setEndingSessionId] = useState<string | null>(null);
  const [feedbackSession, setFeedbackSession] = useState<SessionItem | null>(null);
  const [feedbackRating, setFeedbackRating] = useState(5);
  const [feedbackComments, setFeedbackComments] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [submittedFeedbackSessionIds, setSubmittedFeedbackSessionIds] = useState<Set<string>>(new Set());
  const [, setClockTick] = useState(0);

  const [topic, setTopic] = useState('');
  const [description, setDescription] = useState('');
  const [skillId, setSkillId] = useState('');

  const loadInitial = async () => {
    if (guestMode) {
      setSkills(ENGINEERING_SKILLS);
      setRequests([]);
      setMatches([]);
      setSkillId((prev) => prev || ENGINEERING_SKILLS[0]?.id || '');
      setSelectedRequestId('');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [skillsRes, reqRes, sessionsRes, incomingRes] = await Promise.all([
        api.get('/skills'),
        api.get('/peer/requests'),
        api.get('/peer/sessions'),
        api.get('/peer/session-requests'),
      ]);
      const loadedSkills = unwrapData<Skill[]>(skillsRes) || [];
      const loadedRequests = unwrapData<PeerRequest[]>(reqRes) || [];
      const loadedSessions = unwrapData<SessionItem[]>(sessionsRes) || [];
      setSkills(loadedSkills);
      setRequests(loadedRequests);
      setSessions(loadedSessions);
      setIncomingRequests(unwrapData<SessionItem[]>(incomingRes) || []);
      setSkillId((prev) => prev || loadedSkills[0]?.id || '');
      setSelectedRequestId((prev) => prev || loadedRequests[0]?.id || '');
      await loadSubmittedFeedback(loadedSessions);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to load session data');
    } finally {
      setLoading(false);
    }
  };

  const loadSubmittedFeedback = async (sessionRows: SessionItem[]) => {
    if (!user?.id || guestMode) {
      setSubmittedFeedbackSessionIds(new Set());
      return;
    }

    const feedbackEligibleSessions = sessionRows.filter(
      (session) =>
        getEffectiveSessionStatus(session) === 'ended' &&
        session.requester_id === user.id &&
        Boolean(session.mentor_user_id)
    );

    if (feedbackEligibleSessions.length === 0) {
      setSubmittedFeedbackSessionIds(new Set());
      return;
    }

    const feedbackResults = await Promise.all(
      feedbackEligibleSessions.map(async (session) => {
        const response = await api.get(`/feedback/session/${session.id}`);
        return {
          sessionId: session.id,
          feedback: unwrapData<FeedbackItem[]>(response) || [],
        };
      })
    );

    setSubmittedFeedbackSessionIds(
      new Set(
        feedbackResults
          .filter((result) =>
            result.feedback.some((item) => item.from_user_id === user.id)
          )
          .map((result) => result.sessionId)
      )
    );
  };

  useEffect(() => {
    loadInitial();
  }, [guestMode]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const sessionId = searchParams.get('acceptSession');
    if (!sessionId || guestMode) return;

    acceptSession(sessionId);
  }, [searchParams, guestMode]);

  const loadMatches = async (requestId: string) => {
    if (!requestId) {
      setMatches([]);
      return;
    }

    if (guestMode) {
      setMatches(
        GUEST_MENTORS.map((mentor, index) => ({
          ...mentor,
          id: `${requestId}-mentor-${index + 1}`,
        }))
      );
      return;
    }

    try {
      const res = await api.get(`/peer/matches?request_id=${requestId}`);
      setMatches(unwrapData<MatchItem[]>(res) || []);
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to load matches');
    }
  };

  useEffect(() => {
    loadMatches(selectedRequestId);
  }, [selectedRequestId]);

  const createRequest = async () => {
    if (!topic.trim() || !skillId) {
      toast.error('Topic and skill are required');
      return;
    }
    try {
      setSubmitting(true);

      if (guestMode) {
        const newRequest: PeerRequest = {
          id: `guest-request-${Date.now()}`,
          topic: topic.trim(),
          status: 'open',
          skill_id: skillId,
          created_at: new Date().toISOString(),
          skills: skills.find((item) => item.id === skillId),
        };
        setRequests((prev) => [newRequest, ...prev]);
        setSelectedRequestId(newRequest.id);
        setMatches(
          GUEST_MENTORS.map((mentor, index) => ({
            ...mentor,
            id: `${newRequest.id}-mentor-${index + 1}`,
            match_score: Math.max(75, mentor.match_score - index * 3),
          }))
        );
        setTopic('');
        setDescription('');
        toast.success('Peer request created (demo mode)');
        return;
      }

      const res = await api.post('/peer/requests', {
        topic: topic.trim(),
        description: description.trim() || null,
        skill_id: skillId,
      });
      const payload = unwrapData<{ request: PeerRequest; matches: MatchItem[] }>(res);
      const newRequest = payload?.request;
      if (newRequest) {
        setRequests((prev) => [newRequest, ...prev]);
        setSelectedRequestId(newRequest.id);
      }
      setMatches(payload?.matches || []);
      setTopic('');
      setDescription('');
      toast.success('Peer request created');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to create request');
    } finally {
      setSubmitting(false);
    }
  };

  const requestSession = async (match: MatchItem) => {
    if (!selectedRequestId) {
      toast.error('Select a request first');
      return;
    }
    try {
      setRequestingMatchId(match.id);
      if (guestMode) {
        const roomName = `peer-demo-${Date.now()}`;
        const session: SessionItem = {
          id: `guest-session-${Date.now()}`,
          room_name: roomName,
          join_url: getJitsiJoinUrl(roomName),
          provider: 'jitsi',
          status: 'accepted',
          requester_id: user?.id,
          mentor_user_id: match.matched_user_id,
          started_at: new Date().toISOString(),
        };
        setSessions((prev) => [session, ...prev]);
        setActiveSession(session);
        toast.success('Demo session room created');
        return;
      }

      const response = await api.post('/peer/sessions', {
        request_id: selectedRequestId,
        peer_user_id: match.matched_user_id,
      });
      const payload = unwrapData<SessionRequestResponse>(response);
      if (payload?.session) {
        setSessions((prev) => {
          const withoutDuplicate = prev.filter((item) => item.id !== payload.session.id);
          return [payload.session, ...withoutDuplicate];
        });
        toast.success(
          payload.email_sent
            ? payload.message || 'Request sent successfully.'
            : payload.message || 'Request sent. The peer can accept it from their notifications.'
        );
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to request session');
    } finally {
      setRequestingMatchId(null);
    }
  };

  const acceptSession = async (sessionId: string) => {
    try {
      setAcceptingSessionId(sessionId);
      const response = await api.post(`/peer/sessions/${sessionId}/accept`);
      const session = unwrapData<SessionItem>(response);
      if (session) {
        setIncomingRequests((prev) => prev.filter((item) => item.id !== session.id));
        setSessions((prev) => {
          const withoutDuplicate = prev.filter((item) => item.id !== session.id);
          return [session, ...withoutDuplicate];
        });
        setActiveSession(session);
        toast.success('Session accepted. Opening video room.');
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to accept session request');
    } finally {
      setAcceptingSessionId(null);
    }
  };

  const declineSession = async (sessionId: string) => {
    try {
      setDecliningSessionId(sessionId);
      const response = await api.post(`/peer/sessions/${sessionId}/decline`);
      const session = unwrapData<SessionItem>(response);
      if (session) {
        setIncomingRequests((prev) => prev.filter((item) => item.id !== session.id));
        setSessions((prev) => {
          const withoutDuplicate = prev.filter((item) => item.id !== session.id);
          return [session, ...withoutDuplicate];
        });
        toast.success('Session request declined');
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to decline session request');
    } finally {
      setDecliningSessionId(null);
    }
  };

  const cancelSession = async (sessionId: string) => {
    try {
      setCancellingSessionId(sessionId);
      const response = await api.post(`/peer/sessions/${sessionId}/cancel`);
      const session = unwrapData<SessionItem>(response);
      if (session) {
        setSessions((prev) => prev.map((item) => (item.id === session.id ? session : item)));
        toast.success('Session request cancelled');
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to cancel session request');
    } finally {
      setCancellingSessionId(null);
    }
  };

  const getFeedbackTargetId = (session: SessionItem) => {
    if (!user?.id) return null;
    if (session.requester_id === user.id) return session.mentor_user_id || null;
    return null;
  };

  const canGiveFeedback = (session: SessionItem) =>
    getEffectiveSessionStatus(session) === 'ended' &&
    Boolean(getFeedbackTargetId(session)) &&
    !submittedFeedbackSessionIds.has(session.id);

  const endSession = async (sessionId: string) => {
    try {
      setEndingSessionId(sessionId);
      const currentSession = activeSession?.id === sessionId
        ? activeSession
        : sessions.find((item) => item.id === sessionId) || null;
      if (guestMode) {
        const endedAt = new Date().toISOString();
        const endedSession = currentSession
          ? { ...currentSession, status: 'ended' as SessionStatus, ended_at: endedAt }
          : null;
        setSessions((prev) =>
          prev.map((item) =>
            item.id === sessionId ? { ...item, status: 'ended', ended_at: endedAt } : item
          )
        );
        setActiveSession(null);
        if (endedSession && canGiveFeedback(endedSession)) setFeedbackSession(endedSession);
        toast.success('Session ended');
        return;
      }

      const response = await api.post(`/peer/sessions/${sessionId}/end`);
      const session = unwrapData<SessionItem>(response);
      if (session) {
        setSessions((prev) => prev.map((item) => (item.id === session.id ? session : item)));
        setActiveSession(null);
        if (canGiveFeedback(session)) setFeedbackSession(session);
        toast.success('Session ended');
      }
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to end session');
    } finally {
      setEndingSessionId(null);
    }
  };

  const submitFeedback = async () => {
    if (!feedbackSession) return;

    if (guestMode) {
      setSubmittedFeedbackSessionIds((prev) => new Set(prev).add(feedbackSession.id));
      setFeedbackSession(null);
      setFeedbackComments('');
      setFeedbackRating(5);
      toast.success('Feedback submitted (demo mode)');
      return;
    }

    const toUserId = getFeedbackTargetId(feedbackSession);
    if (!toUserId) {
      toast.error('Could not find the other participant for feedback');
      return;
    }

    try {
      setSubmittingFeedback(true);
      await api.post('/feedback', {
        session_id: feedbackSession.id,
        to_user_id: toUserId,
        rating: feedbackRating,
        comments: feedbackComments.trim() || null,
      });
      setSubmittedFeedbackSessionIds((prev) => new Set(prev).add(feedbackSession.id));
      setFeedbackSession(null);
      setFeedbackComments('');
      setFeedbackRating(5);
      toast.success('Feedback submitted');
    } catch (error: any) {
      toast.error(error?.response?.data?.message || 'Failed to submit feedback');
    } finally {
      setSubmittingFeedback(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton variant="rect" className="h-24" />
        <Skeleton variant="rect" className="h-72" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <Video className="h-5 w-5 text-blue-500" />
          <h1 className="text-2xl font-bold text-slate-900">Video Session Hub</h1>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Create peer-help requests, email a matched mentor, and start Jitsi after they accept.
        </p>
      </Card>

      {incomingRequests.length > 0 && (
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <Mail className="h-5 w-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-slate-900">Incoming Session Requests</h2>
          </div>
          <div className="space-y-3">
            {incomingRequests.map((request) => (
              <div key={request.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-slate-900">
                        {request.peer_requests?.topic || request.room_name}
                      </p>
                      <Badge variant={getStatusBadge(getEffectiveSessionStatus(request)).variant}>
                        {getStatusBadge(getEffectiveSessionStatus(request)).label}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      From {request.profiles?.full_name || 'Peer Connect user'} - Expires in {formatTimeRemaining(request.expires_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      loading={acceptingSessionId === request.id}
                      disabled={getEffectiveSessionStatus(request) !== 'pending'}
                      onClick={() => acceptSession(request.id)}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Accept & Start
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      loading={decliningSessionId === request.id}
                      disabled={getEffectiveSessionStatus(request) !== 'pending'}
                      onClick={() => declineSession(request.id)}
                    >
                      <XCircle className="h-4 w-4 mr-1" />
                      Decline
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="p-6 xl:col-span-1 space-y-3">
          <h2 className="text-lg font-semibold text-slate-900">New Peer Request</h2>
          <Input
            label="Topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Need help with API architecture"
          />
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Skill</label>
            <select
              value={skillId}
              onChange={(e) => setSkillId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">Select skill</option>
              {skills.map((skill) => (
                <option key={skill.id} value={skill.id}>
                  {skill.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Share details so a peer can help quickly..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <Button onClick={createRequest} loading={submitting}>
            Create Request
          </Button>
        </Card>

        <Card className="p-6 xl:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <Users className="h-5 w-5 text-emerald-500" />
            <h2 className="text-lg font-semibold text-slate-900">Request Matches</h2>
          </div>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Select Request</label>
            <select
              value={selectedRequestId}
              onChange={(e) => setSelectedRequestId(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
            >
              <option value="">Select request</option>
              {requests.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.topic} ({request.status})
                </option>
              ))}
            </select>
          </div>

          {matches.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title="No matches yet"
              description="Add another user with this skill marked as Teaching and proficiency 3/5 or higher."
            />
          ) : (
            <div className="space-y-3">
              {matches.map((match) => (
                <div key={match.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-900">
                        {match.profiles?.full_name || 'Recommended peer'}
                      </p>
                      <p className="text-xs text-slate-500">{match.profiles?.headline || 'Mentor profile'}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="success">Score {match.match_score}</Badge>
                      {match.accepted && <Badge variant="primary">Accepted</Badge>}
                    </div>
                  </div>
                  <div className="mt-3">
                    <Button
                      size="sm"
                      loading={requestingMatchId === match.id}
                      onClick={() => requestSession(match)}
                    >
                      <Mail className="h-4 w-4 mr-1" />
                      Request Session
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card className="p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-4">Session Requests</h2>
        {sessions.length === 0 ? (
          <EmptyState
            icon={<Video className="h-8 w-8" />}
            title="No session requests"
            description="Request a session from the matched peers list."
          />
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => {
              const status = getEffectiveSessionStatus(session);
              const badge = getStatusBadge(status);
              const canJoin = status === 'accepted';
              const canCancel = status === 'pending' || status === 'expired';
              return (
                <div key={session.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium text-slate-900">
                          {session.peer_requests?.topic || session.room_name}
                        </p>
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {status === 'pending' && (
                          <>
                            Waiting for {session.profiles?.full_name || 'peer'} to accept - Expires in{' '}
                            {formatTimeRemaining(session.expires_at)}
                          </>
                        )}
                        {status === 'accepted' && 'Accepted and ready. You can join the meeting now.'}
                        {status === 'declined' && 'Peer declined this request. Choose another matched peer.'}
                        {status === 'expired' && 'This request expired. Send a new request or choose another peer.'}
                        {status === 'cancelled' && 'This request was cancelled.'}
                        {status === 'ended' && 'This session has ended.'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => setActiveSession(session)}
                        disabled={!canJoin}
                      >
                        <MonitorUp className="h-4 w-4 mr-1" />
                        Join in App
                      </Button>
                      {canCancel && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={cancellingSessionId === session.id}
                          onClick={() => cancelSession(session.id)}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Cancel
                        </Button>
                      )}
                      {canGiveFeedback(session) && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setFeedbackSession(session)}
                        >
                          <Star className="h-4 w-4 mr-1" />
                          Give Feedback
                        </Button>
                      )}
                      {status === 'ended' && (
                        <Button size="sm" variant="outline" disabled>
                          <PhoneOff className="h-4 w-4 mr-1" />
                          Closed
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {activeSession && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Live Session: {activeSession.room_name}</h2>
              <p className="text-xs text-slate-500">{activeSession.provider}</p>
            </div>
            <Button
              variant="outline"
              loading={endingSessionId === activeSession.id}
              onClick={() => endSession(activeSession.id)}
            >
              <PhoneOff className="h-4 w-4 mr-1" />
              End Meeting
            </Button>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200">
            <JitsiMeeting
              domain={JITSI_DOMAIN}
              roomName={getJitsiRoomName(activeSession.room_name)}
              configOverwrite={{
                startWithAudioMuted: false,
                startWithVideoMuted: false,
                prejoinPageEnabled: false,
              }}
              interfaceConfigOverwrite={{
                MOBILE_APP_PROMO: false,
              }}
              userInfo={{
                displayName: profile?.full_name || 'Peer Connect User',
                email: user?.email || 'guest@peerconnect.local',
              }}
              onReadyToClose={() => endSession(activeSession.id)}
              getIFrameRef={(iframeRef) => {
               iframeRef.setAttribute('allow', 'camera; microphone; display-capture; fullscreen; autoplay');
                iframeRef.style.height = '560px';
                iframeRef.style.width = '100%';
              }}
            />
          </div>
        </Card>
      )}

      {feedbackSession && (
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <Star className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-slate-900">Session Feedback</h2>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[12rem_1fr_auto] md:items-end">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Rating</label>
              <select
                value={feedbackRating}
                onChange={(event) => setFeedbackRating(Number(event.target.value))}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm"
              >
                {[5, 4, 3, 2, 1].map((rating) => (
                  <option key={rating} value={rating}>
                    {rating}/5
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Comments</label>
              <Input
                value={feedbackComments}
                onChange={(event) => setFeedbackComments(event.target.value)}
                placeholder="Share what went well or what could improve..."
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setFeedbackSession(null)}>
                Cancel
              </Button>
              <Button onClick={submitFeedback} loading={submittingFeedback}>
                Submit
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
