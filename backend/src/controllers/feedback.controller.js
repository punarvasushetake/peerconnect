const { supabase } = require('../config/supabase');
const { ApiError } = require('../utils/apiError');

const createFeedback = async (req, res) => {
  try {
    const fromUserId = req.user.id;
    const { session_id: sessionId, to_user_id: toUserId, rating, comments } = req.body || {};

    if (!sessionId || !toUserId || rating == null) {
      throw new ApiError(400, 'session_id, to_user_id, and rating are required');
    }

    const numericRating = Number(rating);
    if (!Number.isFinite(numericRating) || numericRating < 1 || numericRating > 5) {
      throw new ApiError(400, 'rating must be a number between 1 and 5');
    }

    if (fromUserId === toUserId) {
      throw new ApiError(400, 'You cannot rate yourself');
    }

    const { data: session, error: sessionError } = await supabase
      .from('video_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (sessionError || !session) {
      throw new ApiError(404, 'Session not found');
    }

    if (session.requester_id !== fromUserId) {
      throw new ApiError(403, 'Only the requester can submit feedback for this session');
    }

    if (session.status !== 'ended') {
      throw new ApiError(400, 'Feedback can only be submitted after the session ends');
    }

    if (toUserId !== session.mentor_user_id) {
      throw new ApiError(400, 'to_user_id must be the requested peer for this session');
    }

    const { data: existingFeedback, error: existingFeedbackError } = await supabase
      .from('feedback')
      .select('id')
      .eq('session_id', sessionId)
      .eq('from_user_id', fromUserId)
      .eq('to_user_id', toUserId)
      .maybeSingle();

    if (existingFeedbackError) throw new ApiError(400, existingFeedbackError.message);
    if (existingFeedback) {
      throw new ApiError(409, 'Feedback has already been submitted for this session');
    }

    const { data, error } = await supabase
      .from('feedback')
      .insert({
        session_id: sessionId,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        rating: numericRating,
        comments: comments || null,
      })
      .select('*')
      .single();

    if (error) throw new ApiError(400, error.message);

    res.status(201).json({
      success: true,
      data,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const getSessionFeedback = async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase
      .from('feedback')
      .select(
        `
          *,
          from_profile:profiles!feedback_from_user_id_fkey(id, full_name, avatar_url),
          to_profile:profiles!feedback_to_user_id_fkey(id, full_name, avatar_url)
        `
      )
      .eq('session_id', id)
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(400, error.message);

    res.json({
      success: true,
      data: data || [],
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const getUserRatings = async (req, res) => {
  try {
    const targetUserId = req.params.id;

    const { data, error } = await supabase
      .from('feedback')
      .select(
        `
          id,
          rating,
          comments,
          session_id,
          created_at,
          from_profile:profiles!feedback_from_user_id_fkey(id, full_name, avatar_url)
        `
      )
      .eq('to_user_id', targetUserId)
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw new ApiError(400, error.message);

    const ratings = data || [];
    const totalRatings = ratings.length;
    const average =
      totalRatings === 0
        ? null
        : Number(
            (ratings.reduce((sum, item) => sum + Number(item.rating || 0), 0) / totalRatings).toFixed(2)
          );

    res.json({
      success: true,
      data: {
        user_id: targetUserId,
        average_rating: average,
        total_ratings: totalRatings,
        recent_feedback: ratings.slice(0, 10),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  createFeedback,
  getSessionFeedback,
  getUserRatings,
};
