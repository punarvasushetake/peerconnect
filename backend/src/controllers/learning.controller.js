const { supabase } = require('../config/supabase');
const { ApiError } = require('../utils/apiError');
const { applyCompletedCourseSkill } = require('../services/courseSkill.service');

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

    await reopenCompletedEnrollments(id);

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
    const userId = req.user.id;
    const { id: courseId } = req.params;
    const { title, type, url, youtube_id, duration_minutes, order_index } = req.body;

    if (!title || !type) {
      throw new ApiError(400, 'Title and type are required');
    }

    if (!courseId) {
      throw new ApiError(400, 'courseId is required');
    }

    const { data: existing, error: fetchError } = await supabase
      .from('courses')
      .select('created_by')
      .eq('id', courseId)
      .single();

    if (fetchError) throw new ApiError(404, 'Course not found');
    if (existing.created_by !== userId) throw new ApiError(403, 'Not authorized to update this course');

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

    const reopenedEnrollments = await reopenCompletedEnrollments(courseId, 1);

    res.status(201).json({
      success: true,
      data,
      meta: {
        reopened_enrollments: reopenedEnrollments.count,
        reopened_progress_pct: reopenedEnrollments.progress_pct,
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

const getCourseResourceCount = async (courseId) => {
  const { count, error } = await supabase
    .from('resources')
    .select('id', { count: 'exact', head: true })
    .eq('course_id', courseId);

  if (error) throw new ApiError(400, error.message);
  return count || 0;
};

const calculateAverageProgress = (completedResources, totalResources) => {
  if (totalResources === 0) return MAX_CONTENT_PROGRESS;
  const progress = Math.round((completedResources / totalResources) * 100);
  return Math.min(MAX_CONTENT_PROGRESS, progress);
};

const getReopenedCourseProgress = async (courseId, completedResourceOffset = 0) => {
  const totalResources = await getCourseResourceCount(courseId);
  const completedResources = Math.max(0, totalResources - completedResourceOffset);
  return calculateAverageProgress(completedResources, totalResources);
};

const reopenCompletedEnrollments = async (courseId, completedResourceOffset = 0) => {
  const totalResources = await getCourseResourceCount(courseId);
  const fallbackProgressPct = calculateAverageProgress(
    Math.max(0, totalResources - completedResourceOffset),
    totalResources
  );

  const { data: enrollments, error: fetchError } = await supabase
    .from('enrollments')
    .select('id, progress_pct, completed_at')
    .eq('course_id', courseId);

  if (fetchError) throw new ApiError(400, fetchError.message);

  const updates = (enrollments || [])
    .map((enrollment) => {
      const currentProgress = Number(enrollment.progress_pct || 0);
      const completedResources = currentProgress >= 100
        ? Math.max(0, totalResources - completedResourceOffset)
        : Math.floor((currentProgress / 100) * Math.max(0, totalResources - completedResourceOffset));
      const progressPct = enrollment.completed_at || currentProgress >= 100
        ? fallbackProgressPct
        : calculateAverageProgress(completedResources, totalResources);

      return {
        id: enrollment.id,
        progress_pct: progressPct,
        completed_at: null,
      };
    })
    .filter((update) => update.progress_pct < 100);

  if (updates.length === 0) {
    return { count: 0, progress_pct: fallbackProgressPct };
  }

  await Promise.all(updates.map(async (update) => {
    const { error } = await supabase
      .from('enrollments')
      .update({
        progress_pct: update.progress_pct,
        completed_at: update.completed_at,
      })
      .eq('id', update.id);

    if (error) throw new ApiError(400, error.message);
  }));

  return { count: updates.length, progress_pct: fallbackProgressPct };
};

const repairStaleCompletedEnrollmentsForUser = async (userId) => {
  const { data: enrollments, error: enrollmentError } = await supabase
    .from('enrollments')
    .select('id, course_id, progress_pct, completed_at')
    .eq('user_id', userId)
    .not('completed_at', 'is', null);

  if (enrollmentError) throw new ApiError(400, enrollmentError.message);
  if (!enrollments || enrollments.length === 0) return { count: 0 };

  const courseIds = [...new Set(enrollments.map((enrollment) => enrollment.course_id).filter(Boolean))];
  if (courseIds.length === 0) return { count: 0 };

  const { data: resources, error: resourceError } = await supabase
    .from('resources')
    .select('id, course_id, created_at')
    .in('course_id', courseIds);

  if (resourceError) throw new ApiError(400, resourceError.message);

  const resourcesByCourseId = new Map();
  for (const resource of resources || []) {
    const courseResources = resourcesByCourseId.get(resource.course_id) || [];
    courseResources.push(resource);
    resourcesByCourseId.set(resource.course_id, courseResources);
  }

  const updates = [];
  for (const enrollment of enrollments) {
    const courseResources = resourcesByCourseId.get(enrollment.course_id) || [];
    if (courseResources.length === 0 || !enrollment.completed_at) continue;

    const completedAtMs = new Date(enrollment.completed_at).getTime();
    const completedResources = courseResources.filter(
      (resource) => new Date(resource.created_at).getTime() <= completedAtMs
    ).length;
    const hasCurrentQuizPass = await hasPassedCourseQuiz(userId, enrollment.course_id);

    if (completedResources >= courseResources.length && hasCurrentQuizPass) continue;

    updates.push({
      id: enrollment.id,
      progress_pct: completedResources >= courseResources.length
        ? MAX_CONTENT_PROGRESS
        : calculateAverageProgress(completedResources, courseResources.length),
    });
  }

  await Promise.all(updates.map(async (update) => {
    const { error } = await supabase
      .from('enrollments')
      .update({
        progress_pct: update.progress_pct,
        completed_at: null,
      })
      .eq('id', update.id)
      .eq('user_id', userId);

    if (error) throw new ApiError(400, error.message);
  }));

  return { count: updates.length };
};

const hasCourseCompletionActivity = async (userId, courseId) => {
  const { data, error } = await supabase
    .from('activity_log')
    .select('id')
    .eq('user_id', userId)
    .eq('action_type', 'course_completed')
    .eq('entity_type', 'course')
    .eq('entity_id', courseId)
    .limit(1)
    .maybeSingle();

  if (error) throw new ApiError(400, error.message);
  return Boolean(data);
};

const hasPassedCourseQuiz = async (userId, courseId) => {
  const { data: latestResource, error: resourceError } = await supabase
    .from('resources')
    .select('created_at')
    .eq('course_id', courseId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (resourceError) throw new ApiError(400, resourceError.message);
  if (!latestResource?.created_at) return false;

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
    .gte('completed_at', latestResource.created_at)
    .in('quiz_id', quizIds)
    .limit(1)
    .maybeSingle();

  if (attemptError) throw new ApiError(400, attemptError.message);
  return Boolean(passedAttempt);
};

/**
 * Update enrollment progress from course content. Content progress can reach 99%.
 * A course is completed only after all resources are done and the user passes a course-linked quiz with 80%+.
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
      await applyCompletedCourseSkill({ userId, courseId: data.course_id });

      if (!(await hasCourseCompletionActivity(userId, data.course_id))) {
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

    await repairStaleCompletedEnrollmentsForUser(userId);

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
