const { randomUUID } = require('crypto');
const { supabase } = require('../config/supabase');
const { ApiError } = require('../utils/apiError');
const { getRecommendedPeers } = require('../services/recommendation.service');
const { sendPeerSessionRequestEmail, sendPeerSessionUpdateEmail } = require('../services/email.service');
const { createNotification } = require('../services/notification.service');

const SESSION_REQUEST_EXPIRY_MINUTES = Number(process.env.SESSION_REQUEST_EXPIRY_MINUTES || 15);
const PENDING_SESSION_STATUSES = ['pending', 'accepted'];
const JITSI_DOMAIN = (process.env.JITSI_DOMAIN || 'meet.jit.si').replace(/^https?:\/\//, '').replace(/\/$/, '');
const JITSI_APP_ID = (process.env.JITSI_APP_ID || '').replace(/^\/+|\/+$/g, '');

const buildJitsiRoomName = (roomName) => (JITSI_APP_ID ? `${JITSI_APP_ID}/${roomName}` : roomName);
const buildJitsiJoinUrl = (roomName) => `https://${JITSI_DOMAIN}/${buildJitsiRoomName(roomName)}`;

const getAuthUserEmail = async (userId) => {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) return null;
  return data?.user?.email || null;
};

const getProfile = async (userId) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, headline')
    .eq('id', userId)
    .single();

  if (error) return null;
  return data;
};

const getSessionStatus = (session) => {
  if (session.status === 'pending' && session.expires_at && new Date(session.expires_at) <= new Date()) {
    return 'expired';
  }

  if (session.status) return session.status;
  if (session.ended_at) return 'ended';
  if (session.started_at) return 'accepted';
  return 'pending';
};

const markExpiredSessions = async (sessions = []) => {
  const expiredIds = sessions
    .filter((session) => getSessionStatus(session) === 'expired' && session.status !== 'expired')
    .map((session) => session.id);

  if (expiredIds.length > 0) {
    await supabase
      .from('video_sessions')
      .update({ status: 'expired' })
      .in('id', expiredIds);

    for (const session of sessions.filter((item) => expiredIds.includes(item.id))) {
      await createNotification({
        userId: session.requester_id,
        type: 'video_session_expired',
        title: 'Your video session request expired',
        message: 'The peer did not respond before the request expired. You can choose another peer or send a new request.',
        entityType: 'video_session',
        entityId: session.id,
        metadata: {
          actionUrl: `${(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/video-session`,
          requestId: session.request_id,
          mentorId: session.mentor_user_id,
        },
      });
    }
  }

  return sessions.map((session) => ({
    ...session,
    status: getSessionStatus(session),
  }));
};

const listPeerRequests = async (req, res) => {
  try {
    const userId = req.user.id;
    const { status } = req.query;

    let query = supabase
      .from('peer_requests')
      .select('*, skills(id, name, category)')
      .eq('requester_id', userId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data: requests, error } = await query;
    if (error) throw new ApiError(400, error.message);

    const requestIds = (requests || []).map((r) => r.id);
    let matchCounts = {};
    if (requestIds.length > 0) {
      const { data: matches, error: matchesError } = await supabase
        .from('peer_matches')
        .select('request_id')
        .in('request_id', requestIds);

      if (matchesError) throw new ApiError(400, matchesError.message);

      for (const row of matches || []) {
        matchCounts[row.request_id] = (matchCounts[row.request_id] || 0) + 1;
      }
    }

    const enriched = (requests || []).map((r) => ({
      ...r,
      matches_count: matchCounts[r.id] || 0,
    }));

    res.json({
      success: true,
      data: enriched,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const createPeerRequest = async (req, res) => {
  try {
    const userId = req.user.id;
    const { topic, description, skill_id } = req.body || {};

    if (!topic || !skill_id) {
      throw new ApiError(400, 'topic and skill_id are required');
    }

    const { data: requestRow, error } = await supabase
      .from('peer_requests')
      .insert({
        requester_id: userId,
        topic,
        description: description || null,
        skill_id,
        status: 'open',
      })
      .select('*, skills(id, name, category)')
      .single();

    if (error) throw new ApiError(400, error.message);

    const recommendations = await getRecommendedPeers(userId, 8, [skill_id]);

    let createdMatches = [];
    if (recommendations.length > 0) {
      const payload = recommendations.map((rec) => ({
        request_id: requestRow.id,
        matched_user_id: rec.user.id,
        match_score: rec.matchScore,
        accepted: false,
      }));

      const { data: matches, error: matchesError } = await supabase
        .from('peer_matches')
        .upsert(payload, { onConflict: 'request_id,matched_user_id' })
        .select('*, profiles!peer_matches_matched_user_id_fkey(id, full_name, avatar_url, headline)');

      if (matchesError) throw new ApiError(400, matchesError.message);
      createdMatches = matches || [];
    }

    res.status(201).json({
      success: true,
      data: {
        request: requestRow,
        matches: createdMatches,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const getPeerMatches = async (req, res) => {
  try {
    const userId = req.user.id;
    const { request_id: requestId } = req.query;

    if (requestId) {
      const { data: requestRow, error: requestError } = await supabase
        .from('peer_requests')
        .select('*')
        .eq('id', requestId)
        .eq('requester_id', userId)
        .single();

      if (requestError || !requestRow) {
        throw new ApiError(404, 'Peer request not found');
      }

      const { data: existingMatches, error: existingError } = await supabase
        .from('peer_matches')
        .select('*, profiles!peer_matches_matched_user_id_fkey(id, full_name, avatar_url, headline)')
        .eq('request_id', requestId)
        .order('match_score', { ascending: false });

      if (existingError) throw new ApiError(400, existingError.message);

      if (existingMatches && existingMatches.length > 0) {
        return res.json({
          success: true,
          data: existingMatches,
        });
      }

      const recommendations = await getRecommendedPeers(userId, 8, [requestRow.skill_id]);

      if (recommendations.length === 0) {
        return res.json({
          success: true,
          data: [],
        });
      }

      const payload = recommendations.map((rec) => ({
        request_id: requestRow.id,
        matched_user_id: rec.user.id,
        match_score: rec.matchScore,
        accepted: false,
      }));

      const { data: created, error: createdError } = await supabase
        .from('peer_matches')
        .upsert(payload, { onConflict: 'request_id,matched_user_id' })
        .select('*, profiles!peer_matches_matched_user_id_fkey(id, full_name, avatar_url, headline)')
        .order('match_score', { ascending: false });

      if (createdError) throw new ApiError(400, createdError.message);

      return res.json({
        success: true,
        data: created || [],
      });
    }

    const recommendations = await getRecommendedPeers(userId, 8);
    res.json({
      success: true,
      data: recommendations,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const listPeerSessions = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: sessions, error } = await supabase
      .from('video_sessions')
      .select('*, peer_requests(id, topic, description, status), profiles!video_sessions_mentor_user_id_fkey(id, full_name, headline)')
      .or(`requester_id.eq.${userId},mentor_user_id.eq.${userId}`)
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(400, error.message);

    res.json({
      success: true,
      data: await markExpiredSessions(sessions || []),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const listIncomingSessionRequests = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data: sessions, error } = await supabase
      .from('video_sessions')
      .select('*, peer_requests(id, topic, description, status), profiles!video_sessions_requester_id_fkey(id, full_name, headline)')
      .eq('mentor_user_id', userId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(400, error.message);

    res.json({
      success: true,
      data: await markExpiredSessions(sessions || []),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const requestPeerSession = async (req, res) => {
  try {
    const requesterId = req.user.id;
    const { request_id: requestId, peer_user_id: peerUserId, provider = 'jitsi' } = req.body || {};

    if (!requestId || !peerUserId) {
      throw new ApiError(400, 'request_id and peer_user_id are required');
    }

    const { data: requestRow, error: requestError } = await supabase
      .from('peer_requests')
      .select('*')
      .eq('id', requestId)
      .eq('requester_id', requesterId)
      .single();

    if (requestError || !requestRow) {
      throw new ApiError(404, 'Peer request not found');
    }

    const { data: matchRow, error: matchError } = await supabase
      .from('peer_matches')
      .select('*')
      .eq('request_id', requestId)
      .eq('matched_user_id', peerUserId)
      .single();

    if (matchError || !matchRow) {
      throw new ApiError(400, 'Selected peer is not matched for this request');
    }

    const { data: existingSession, error: existingSessionError } = await supabase
      .from('video_sessions')
      .select('*')
      .eq('request_id', requestId)
      .eq('mentor_user_id', peerUserId)
      .in('status', PENDING_SESSION_STATUSES)
      .maybeSingle();

    if (existingSessionError) throw new ApiError(400, existingSessionError.message);

    if (existingSession) {
      return res.json({
        success: true,
        data: {
          session: existingSession,
          email_sent: false,
          message: getSessionStatus(existingSession) === 'accepted'
            ? 'This session has already started.'
            : 'A request is already waiting for this peer to accept.',
        },
      });
    }

    const roomName = `peer-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const joinUrl = buildJitsiJoinUrl(roomName);
    const expiresAt = new Date(Date.now() + SESSION_REQUEST_EXPIRY_MINUTES * 60 * 1000).toISOString();

    const { data: session, error: sessionError } = await supabase
      .from('video_sessions')
      .insert({
        request_id: requestId,
        requester_id: requesterId,
        mentor_user_id: peerUserId,
        room_name: roomName,
        provider,
        join_url: joinUrl,
        started_at: null,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('*')
      .single();

    if (sessionError) throw new ApiError(400, sessionError.message);

    const { error: updateRequestError } = await supabase
      .from('peer_requests')
      .update({ status: 'pending_acceptance' })
      .eq('id', requestId);
    if (updateRequestError) throw new ApiError(400, updateRequestError.message);

    const [recipientEmail, requesterProfile, recipientProfile] = await Promise.all([
      getAuthUserEmail(peerUserId),
      getProfile(requesterId),
      getProfile(peerUserId),
    ]);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const acceptUrl = `${frontendUrl.replace(/\/$/, '')}/video-session?acceptSession=${session.id}`;
    const sessionUrl = `${frontendUrl.replace(/\/$/, '')}/video-session`;
    const emailResult = await sendPeerSessionRequestEmail({
      to: recipientEmail,
      recipientName: recipientProfile?.full_name,
      requesterName: requesterProfile?.full_name || req.user.email,
      topic: requestRow.topic,
      acceptUrl,
    });

    await createNotification({
      userId: peerUserId,
      type: 'video_session_request',
      title: `${requesterProfile?.full_name || 'A peer'} requested a video session`,
      message: `Topic: ${requestRow.topic}. Accept or decline within ${SESSION_REQUEST_EXPIRY_MINUTES} minutes.`,
      entityType: 'video_session',
      entityId: session.id,
      metadata: {
        actionUrl: sessionUrl,
        requestId,
        requesterId,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        session,
        email_sent: emailResult.sent,
        message: emailResult.sent
          ? 'Request sent successfully.'
          : 'Request sent. The peer can accept it from their notifications.',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    console.error(error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const acceptPeerSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;

    const { data: session, error: sessionError } = await supabase
      .from('video_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('mentor_user_id', userId)
      .single();

    if (sessionError || !session) {
      throw new ApiError(404, 'Session request not found');
    }

    const status = getSessionStatus(session);
    if (status === 'expired') {
      await supabase.from('video_sessions').update({ status: 'expired' }).eq('id', sessionId);
      throw new ApiError(410, 'This session request has expired');
    }
    if (status !== 'pending' && status !== 'accepted') {
      throw new ApiError(400, `This session request is ${status}`);
    }

    const startedAt = session.started_at || new Date().toISOString();
    const [mentorProfile, requesterProfile, requesterEmail, requestRow] = await Promise.all([
      getProfile(userId),
      getProfile(session.requester_id),
      getAuthUserEmail(session.requester_id),
      supabase
        .from('peer_requests')
        .select('topic')
        .eq('id', session.request_id)
        .single()
        .then(({ data }) => data),
    ]);

    const { data: updatedSession, error: updateSessionError } = await supabase
      .from('video_sessions')
      .update({ started_at: startedAt, accepted_at: startedAt, status: 'accepted' })
      .eq('id', sessionId)
      .select('*')
      .single();

    if (updateSessionError) throw new ApiError(400, updateSessionError.message);

    const { error: updateRequestError } = await supabase
      .from('peer_requests')
      .update({ status: 'in_session' })
      .eq('id', session.request_id);
    if (updateRequestError) throw new ApiError(400, updateRequestError.message);

    const { error: updateMatchError } = await supabase
      .from('peer_matches')
      .update({ accepted: true })
      .eq('request_id', session.request_id)
      .eq('matched_user_id', userId);
    if (updateMatchError) throw new ApiError(400, updateMatchError.message);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const sessionUrl = `${frontendUrl.replace(/\/$/, '')}/video-session`;

    await createNotification({
      userId: session.requester_id,
      type: 'video_session_accepted',
      title: `${mentorProfile?.full_name || 'Your peer'} accepted your session request`,
      message: 'Your meeting is ready. You can join now.',
      entityType: 'video_session',
      entityId: session.id,
      metadata: {
        actionUrl: sessionUrl,
        requestId: session.request_id,
        mentorId: userId,
      },
    });

    await sendPeerSessionUpdateEmail({
      to: requesterEmail,
      recipientName: requesterProfile?.full_name,
      peerName: mentorProfile?.full_name,
      topic: requestRow?.topic,
      status: 'accepted',
      sessionUrl,
    });

    res.json({
      success: true,
      data: updatedSession,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const declinePeerSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;
    const { reason } = req.body || {};

    const { data: session, error: sessionError } = await supabase
      .from('video_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('mentor_user_id', userId)
      .single();

    if (sessionError || !session) {
      throw new ApiError(404, 'Session request not found');
    }

    const status = getSessionStatus(session);
    if (status !== 'pending') {
      throw new ApiError(400, `This session request is ${status}`);
    }

    const now = new Date().toISOString();
    const [mentorProfile, requesterProfile, requesterEmail, requestRow] = await Promise.all([
      getProfile(userId),
      getProfile(session.requester_id),
      getAuthUserEmail(session.requester_id),
      supabase
        .from('peer_requests')
        .select('topic')
        .eq('id', session.request_id)
        .single()
        .then(({ data }) => data),
    ]);

    const { data: updatedSession, error: updateSessionError } = await supabase
      .from('video_sessions')
      .update({
        status: 'declined',
        declined_at: now,
        decline_reason: reason || null,
      })
      .eq('id', sessionId)
      .select('*')
      .single();

    if (updateSessionError) throw new ApiError(400, updateSessionError.message);

    const { error: updateRequestError } = await supabase
      .from('peer_requests')
      .update({ status: 'open' })
      .eq('id', session.request_id);
    if (updateRequestError) throw new ApiError(400, updateRequestError.message);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const sessionUrl = `${frontendUrl.replace(/\/$/, '')}/video-session`;

    await createNotification({
      userId: session.requester_id,
      type: 'video_session_declined',
      title: `${mentorProfile?.full_name || 'Your peer'} declined your session request`,
      message: reason || 'You can choose another matched peer or send a new request.',
      entityType: 'video_session',
      entityId: session.id,
      metadata: {
        actionUrl: sessionUrl,
        requestId: session.request_id,
        mentorId: userId,
      },
    });

    await sendPeerSessionUpdateEmail({
      to: requesterEmail,
      recipientName: requesterProfile?.full_name,
      peerName: mentorProfile?.full_name,
      topic: requestRow?.topic,
      status: 'declined',
      sessionUrl,
    });

    res.json({
      success: true,
      data: updatedSession,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const cancelPeerSession = async (req, res) => {
  try {
    const requesterId = req.user.id;
    const { sessionId } = req.params;

    const { data: session, error: sessionError } = await supabase
      .from('video_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('requester_id', requesterId)
      .single();

    if (sessionError || !session) {
      throw new ApiError(404, 'Session request not found');
    }

    const status = getSessionStatus(session);
    if (status !== 'pending' && status !== 'expired') {
      throw new ApiError(400, `This session request is ${status}`);
    }

    const { data: updatedSession, error: updateSessionError } = await supabase
      .from('video_sessions')
      .update({ status: 'cancelled' })
      .eq('id', sessionId)
      .select('*')
      .single();

    if (updateSessionError) throw new ApiError(400, updateSessionError.message);

    const { error: updateRequestError } = await supabase
      .from('peer_requests')
      .update({ status: 'open' })
      .eq('id', session.request_id);
    if (updateRequestError) throw new ApiError(400, updateRequestError.message);

    const [requesterProfile, requestRow] = await Promise.all([
      getProfile(requesterId),
      supabase
        .from('peer_requests')
        .select('topic')
        .eq('id', session.request_id)
        .single()
        .then(({ data }) => data),
    ]);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    await createNotification({
      userId: session.mentor_user_id,
      type: 'video_session_cancelled',
      title: `${requesterProfile?.full_name || 'A peer'} cancelled the session request`,
      message: requestRow?.topic ? `Topic: ${requestRow.topic}` : 'The pending session request was cancelled.',
      entityType: 'video_session',
      entityId: session.id,
      metadata: {
        actionUrl: `${frontendUrl.replace(/\/$/, '')}/video-session`,
        requestId: session.request_id,
        requesterId,
      },
    });

    res.json({
      success: true,
      data: updatedSession,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const endPeerSession = async (req, res) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;

    const { data: session, error: sessionError } = await supabase
      .from('video_sessions')
      .select('*')
      .eq('id', sessionId)
      .or(`requester_id.eq.${userId},mentor_user_id.eq.${userId}`)
      .single();

    if (sessionError || !session) {
      throw new ApiError(404, 'Session not found');
    }

    const status = getSessionStatus(session);
    if (status !== 'accepted') {
      throw new ApiError(400, `This session is ${status}`);
    }

    const endedAt = new Date().toISOString();
    const { data: updatedSession, error: updateSessionError } = await supabase
      .from('video_sessions')
      .update({ status: 'ended', ended_at: endedAt })
      .eq('id', sessionId)
      .select('*')
      .single();

    if (updateSessionError) throw new ApiError(400, updateSessionError.message);

    const { error: updateRequestError } = await supabase
      .from('peer_requests')
      .update({ status: 'completed' })
      .eq('id', session.request_id);
    if (updateRequestError) throw new ApiError(400, updateRequestError.message);

    const otherUserId = userId === session.requester_id ? session.mentor_user_id : session.requester_id;
    const actorProfile = await getProfile(userId);

    await createNotification({
      userId: otherUserId,
      type: 'video_session_ended',
      title: `${actorProfile?.full_name || 'Your peer'} ended the video session`,
      message: 'The meeting is now closed and cannot be joined again from Peer Connect.',
      entityType: 'video_session',
      entityId: session.id,
      metadata: {
        actionUrl: `${(process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/video-session`,
        requestId: session.request_id,
      },
    });

    res.json({
      success: true,
      data: updatedSession,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  listPeerRequests,
  createPeerRequest,
  getPeerMatches,
  listPeerSessions,
  listIncomingSessionRequests,
  requestPeerSession,
  createPeerSession: requestPeerSession,
  acceptPeerSession,
  declinePeerSession,
  cancelPeerSession,
  endPeerSession,
};
