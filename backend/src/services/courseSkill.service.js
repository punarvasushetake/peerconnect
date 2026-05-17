const { supabase } = require('../config/supabase');
const { ApiError } = require('../utils/apiError');

const difficultyToProficiency = (difficulty) => {
  const normalized = String(difficulty || '').toLowerCase();

  if (normalized === 'advanced') return 5;
  if (normalized === 'intermediate') return 3;
  return 1;
};

const applyCompletedCourseSkill = async ({ userId, courseId }) => {
  if (!userId || !courseId) return null;

  const { data: course, error: courseError } = await supabase
    .from('courses')
    .select('id, skill_id, difficulty')
    .eq('id', courseId)
    .maybeSingle();

  if (courseError) throw new ApiError(400, courseError.message);
  if (!course?.skill_id) return null;

  const proficiencyLevel = difficultyToProficiency(course.difficulty);

  const { data: existingSkill, error: existingError } = await supabase
    .from('user_skills')
    .select('id, proficiency_level')
    .eq('user_id', userId)
    .eq('skill_id', course.skill_id)
    .maybeSingle();

  if (existingError) throw new ApiError(400, existingError.message);

  if (existingSkill) {
    const nextProficiency = Math.max(Number(existingSkill.proficiency_level || 1), proficiencyLevel);

    if (nextProficiency === Number(existingSkill.proficiency_level || 1)) {
      return existingSkill;
    }

    const { data, error } = await supabase
      .from('user_skills')
      .update({ proficiency_level: nextProficiency })
      .eq('id', existingSkill.id)
      .select()
      .single();

    if (error) throw new ApiError(400, error.message);
    return data;
  }

  const { data, error } = await supabase
    .from('user_skills')
    .insert({
      user_id: userId,
      skill_id: course.skill_id,
      proficiency_level: proficiencyLevel,
      is_teaching: false,
      is_learning: false,
    })
    .select()
    .single();

  if (error) throw new ApiError(400, error.message);
  return data;
};

module.exports = {
  applyCompletedCourseSkill,
  difficultyToProficiency,
};
