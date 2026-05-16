const { supabase } = require('../config/supabase');
const { ApiError } = require('../utils/apiError');

const DEFAULT_COURSE_THUMBNAIL_URL = `data:image/svg+xml,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2563eb"/>
      <stop offset="0.52" stop-color="#14b8a6"/>
      <stop offset="1" stop-color="#f97316"/>
    </linearGradient>
    <radialGradient id="glow" cx="70%" cy="20%" r="60%">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.34"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="675" fill="url(#bg)"/>
  <rect width="1200" height="675" fill="url(#glow)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity="0.32" stroke-width="16">
    <path d="M346 238h346c44 0 80 36 80 80v196H426c-44 0-80-36-80-80V238Z"/>
    <path d="M426 162h346c44 0 80 36 80 80v196"/>
  </g>
  <circle cx="384" cy="250" r="42" fill="#ffffff" fill-opacity="0.22"/>
  <text x="94" y="535" fill="#ffffff" font-family="Inter,Segoe UI,Arial,sans-serif" font-size="76" font-weight="800">Peer Connect Course</text>
</svg>
`)}`;

const normalizeThumbnailUrl = (thumbnailUrl) => {
  if (typeof thumbnailUrl !== 'string') return DEFAULT_COURSE_THUMBNAIL_URL;
  const trimmed = thumbnailUrl.trim();
  return trimmed || DEFAULT_COURSE_THUMBNAIL_URL;
};

const sortCoursesForUser = (courses, userId) => {
  return [...courses].sort((a, b) => {
    const aIsOwn = a.created_by === userId;
    const bIsOwn = b.created_by === userId;

    if (aIsOwn !== bIsOwn) return aIsOwn ? 1 : -1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
};

/**
 * List courses with pagination and optional category filter.
 */
const getCourses = async (req, res) => {
  try {
    const userId = req.user.id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const { category } = req.query;
    const offset = (page - 1) * limit;

    let query = supabase
      .from('courses')
      .select('*, profiles!courses_created_by_fkey(id, full_name, avatar_url)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error, count } = await query;

    if (error) throw new ApiError(400, error.message);

    const sortedCourses = sortCoursesForUser(data || [], userId);

    res.json({
      success: true,
      data: sortedCourses.slice(offset, offset + limit),
      pagination: {
        page,
        limit,
        total: count,
        pages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Create a new course. Logs activity with 15 XP.
 */
const createCourse = async (req, res) => {
  try {
    const userId = req.user.id;
    const { title, description, category, skill_id, difficulty, thumbnail_url } = req.body;

    if (!title) {
      throw new ApiError(400, 'Title is required');
    }

    const { data, error } = await supabase
      .from('courses')
      .insert({
        title,
        description,
        category,
        skill_id,
        difficulty: difficulty || 'beginner',
        thumbnail_url: normalizeThumbnailUrl(thumbnail_url),
        created_by: userId,
      })
      .select()
      .single();

    if (error) throw new ApiError(400, error.message);

    // Log activity with 15 XP
    const { error: activityError } = await supabase.from('activity_log').insert({
      user_id: userId,
      action_type: 'course_created',
      entity_type: 'course',
      entity_id: data.id,
      xp_earned: 15,
    });
    if (activityError) console.error('Failed to log course activity:', activityError.message);

    // Update user XP
    const { data: profile } = await supabase
      .from('profiles')
      .select('xp_points')
      .eq('id', userId)
      .single();

    if (profile) {
      await supabase
        .from('profiles')
        .update({ xp_points: (profile.xp_points || 0) + 15 })
        .eq('id', userId);
    }

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

/**
 * Get a course by ID with its resources (ordered by order_index).
 */
const getCourseById = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: course, error: courseError } = await supabase
      .from('courses')
      .select('*, profiles!courses_created_by_fkey(id, full_name, avatar_url)')
      .eq('id', id)
      .single();

    if (courseError) throw new ApiError(404, 'Course not found');

    // Fetch resources ordered by order_index
    const { data: resources, error: resError } = await supabase
      .from('resources')
      .select('*')
      .eq('course_id', id)
      .order('order_index', { ascending: true });

    if (resError) throw new ApiError(400, resError.message);

    res.json({
      success: true,
      data: {
        ...course,
        resources,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Update a course (owner only).
 */
const updateCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { title, description, category, skill_id, difficulty, thumbnail_url } = req.body;

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('courses')
      .select('created_by')
      .eq('id', id)
      .single();

    if (fetchError) throw new ApiError(404, 'Course not found');
    if (existing.created_by !== userId) throw new ApiError(403, 'Not authorized to update this course');

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (category !== undefined) updates.category = category;
    if (skill_id !== undefined) updates.skill_id = skill_id;
    if (difficulty !== undefined) updates.difficulty = difficulty;
    if (thumbnail_url !== undefined) updates.thumbnail_url = normalizeThumbnailUrl(thumbnail_url);

    const { data, error } = await supabase
      .from('courses')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new ApiError(400, error.message);

    res.json({
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

/**
 * Delete a course (owner only).
 */
const deleteCourse = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Verify ownership
    const { data: existing, error: fetchError } = await supabase
      .from('courses')
      .select('created_by')
      .eq('id', id)
      .single();

    if (fetchError) throw new ApiError(404, 'Course not found');
    if (existing.created_by !== userId) throw new ApiError(403, 'Not authorized to delete this course');

    const { error } = await supabase
      .from('courses')
      .delete()
      .eq('id', id);

    if (error) throw new ApiError(400, error.message);

    res.json({
      success: true,
      message: 'Course deleted successfully',
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Add a resource to a course.
 */
const addResource = async (req, res) => {
  try {
    const { id: courseId } = req.params;
    const { title, type, url, youtube_id, duration_minutes, order_index } = req.body;

    if (!title || !type) {
      throw new ApiError(400, 'Title and type are required');
    }

    if (!courseId) {
      throw new ApiError(400, 'courseId is required');
    }

    const { data, error } = await supabase
      .from('resources')
      .insert({
        course_id: courseId,
        title,
        type,
        url,
        youtube_id,
        duration_minutes,
        order_index: order_index || 0,
      })
      .select()
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

/**
 * Enroll in a course. Logs activity with 15 XP.
 */
const enrollInCourse = async (req, res) => {
  try {
    const userId = req.user.id;
    console.log('enrollInCourse params:', req.params);
    const { id: courseId } = req.params;

    if (!courseId) {
      throw new ApiError(400, 'courseId is required');
    }

    const { data, error } = await supabase
      .from('enrollments')
      .insert({
        user_id: userId,
        course_id: courseId,
        progress_pct: 0,
      })
      .select()
      .single();

    if (error) throw new ApiError(400, error.message);

    // Log activity with 15 XP
    const { error: activityError } = await supabase.from('activity_log').insert({
      user_id: userId,
      action_type: 'course_enrolled',
      entity_type: 'course',
      entity_id: courseId,
      xp_earned: 15,
    });
    if (activityError) console.error('Failed to log enrollment activity:', activityError.message);

    // Update user XP
    const { data: profile } = await supabase
      .from('profiles')
      .select('xp_points')
      .eq('id', userId)
      .single();

    if (profile) {
      await supabase
        .from('profiles')
        .update({ xp_points: (profile.xp_points || 0) + 15 })
        .eq('id', userId);
    }

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

const COURSE_PASSING_SCORE = 80;
const MAX_CONTENT_PROGRESS = 99;

const hasPassedCourseQuiz = async (userId, courseId) => {
  const { data: courseQuizzes, error: quizError } = await supabase
    .from('quizzes')
    .select('id')
    .eq('source_type', 'course')
    .eq('source_id', courseId);

  if (quizError) throw new ApiError(400, quizError.message);
  const quizIds = (courseQuizzes || []).map((quiz) => quiz.id);
  if (quizIds.length === 0) return false;

  const { data: passedAttempt, error: attemptError } = await supabase
    .from('quiz_attempts')
    .select('id')
    .eq('user_id', userId)
    .gte('score', COURSE_PASSING_SCORE)
    .in('quiz_id', quizIds)
    .limit(1)
    .maybeSingle();

  if (attemptError) throw new ApiError(400, attemptError.message);
  return Boolean(passedAttempt);
};

/**
 * Update enrollment progress from course content. Content progress can reach 99%.
 * A course is completed only after the user passes a course-linked quiz with 80%+.
 */
const updateProgress = async (req, res) => {
  try {
    const userId = req.user.id;
    const { id: enrollmentId } = req.params;
    const { progress_pct } = req.body;

    if (progress_pct === undefined || progress_pct < 0 || progress_pct > 100) {
      throw new ApiError(400, 'progress_pct must be between 0 and 100');
    }

    if (!enrollmentId) {
      throw new ApiError(400, 'enrollmentId is required');
    }

    const { data: enrollment, error: enrollmentError } = await supabase
      .from('enrollments')
      .select('*')
      .eq('id', enrollmentId)
      .eq('user_id', userId)
      .single();

    if (enrollmentError || !enrollment) {
      throw new ApiError(404, 'Enrollment not found');
    }

    const canComplete = progress_pct === 100 && await hasPassedCourseQuiz(userId, enrollment.course_id);
    const nextProgress = canComplete ? 100 : Math.min(progress_pct, MAX_CONTENT_PROGRESS);
    const updates = { progress_pct: nextProgress };

    if (canComplete && !enrollment.completed_at) {
      updates.completed_at = new Date().toISOString();
    }

    const { data, error } = await supabase
      .from('enrollments')
      .update(updates)
      .eq('id', enrollmentId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) throw new ApiError(400, error.message);

    // If completed for the first time, log activity with 100 XP.
    if (canComplete && !enrollment.completed_at) {
      const { error: activityError } = await supabase.from('activity_log').insert({
        user_id: userId,
        action_type: 'course_completed',
        entity_type: 'course',
        entity_id: data.course_id,
        xp_earned: 100,
      });
      if (activityError) console.error('Failed to log course completion activity:', activityError.message);

      const { data: profile } = await supabase
        .from('profiles')
        .select('xp_points')
        .eq('id', userId)
        .single();

      if (profile) {
        await supabase
          .from('profiles')
          .update({ xp_points: (profile.xp_points || 0) + 100 })
          .eq('id', userId);
      }
    }

    res.json({
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

/**
 * Get all enrollments for the authenticated user, joined with courses.
 */
const getMyEnrollments = async (req, res) => {
  try {
    const userId = req.user.id;

    const { data, error } = await supabase
      .from('enrollments')
      .select('*, courses(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) throw new ApiError(400, error.message);

    res.json({
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

module.exports = {
  getCourses,
  createCourse,
  getCourseById,
  updateCourse,
  deleteCourse,
  addResource,
  enrollInCourse,
  updateProgress,
  getMyEnrollments,
};
