'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { BriefcaseBusiness, CheckCircle2, GraduationCap, TrendingUp } from 'lucide-react';
import { ColumnDef } from '@tanstack/react-table';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Skeleton from '@/components/ui/Skeleton';
import AdminDataTable from '@/components/admin/AdminDataTable';
import api from '@/lib/api';
import { unwrapData } from '@/lib/apiResponse';
import { supabase } from '@/lib/supabase';

interface ReadinessSkill {
  name: string;
  category: string | null;
  proficiency_level: number;
  is_teaching: boolean;
  is_learning: boolean;
}

interface OpportunityReadiness {
  user: {
    id: string;
    full_name: string;
    headline: string | null;
    location: string | null;
    xp_points: number;
    level: number;
  };
  readiness_score: number;
  readiness_band: 'Ready' | 'Growing' | 'Needs Support';
  recommended_opportunity: string;
  evidence: {
    skills: ReadinessSkill[];
    completed_courses: number;
    enrolled_courses: number;
    average_course_progress: number;
    quiz_attempts: number;
    average_quiz_score: number;
    peer_sessions: number;
    average_feedback_rating: number;
    resources_contributed: number;
  };
}

const bandVariant = (band: OpportunityReadiness['readiness_band']) => {
  if (band === 'Ready') return 'success' as const;
  if (band === 'Growing') return 'warning' as const;
  return 'default' as const;
};

type AdminUser = OpportunityReadiness['user'] & {
  avatar_url?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type FallbackDatasets = {
  skills: any[];
  enrollments: any[];
  quizAttempts: any[];
  feedback: any[];
  articles: any[];
  sessions: any[];
};

const groupBy = <T extends Record<string, any>>(items: T[], key: string) =>
  items.reduce<Record<string, T[]>>((acc, item) => {
    const value = item[key];
    if (!value) return acc;
    acc[value] = acc[value] || [];
    acc[value].push(item);
    return acc;
  }, {});

const average = (values: unknown[]) => {
  const numeric = values.map(Number).filter((value) => Number.isFinite(value));
  if (numeric.length === 0) return 0;
  return numeric.reduce((sum, value) => sum + value, 0) / numeric.length;
};

const getFallbackOpportunity = ({
  user,
  skills,
  readinessScore,
  completedCourses,
  avgFeedback,
}: {
  user: AdminUser;
  skills: ReadinessSkill[];
  readinessScore: number;
  completedCourses: number;
  avgFeedback: number;
}) => {
  const skillNames = skills.map((skill) => skill.name.toLowerCase());
  const hasSkill = (terms: string[]) =>
    terms.some((term) => skillNames.some((name) => name.includes(term)));

  if (readinessScore >= 85 && hasSkill(['machine learning', 'python', 'data analysis', 'statistics'])) {
    return 'Assign ML/data project or analytics opportunity';
  }
  if (readinessScore >= 85 && hasSkill(['system design', 'node', 'typescript', 'backend', 'go'])) {
    return 'Assign backend/API ownership opportunity';
  }
  if (readinessScore >= 80 && hasSkill(['react', 'javascript', 'typescript'])) {
    return 'Assign frontend feature ownership opportunity';
  }
  if (readinessScore >= 75 && avgFeedback >= 4) {
    return 'Invite as peer mentor for guided learning sessions';
  }
  if (completedCourses > 0) {
    return 'Recommend supervised project task with mentor review';
  }
  if ((user.xp_points || 0) >= 700 || (user.level || 0) >= 6) {
    return 'Ready for mentor-led feature ownership or project opportunity';
  }
  if ((user.xp_points || 0) >= 300 || (user.level || 0) >= 3) {
    return 'Assign a guided project with peer review and milestone support';
  }
  return 'Recommend learning path before opportunity assignment';
};

const emptyFallbackDatasets: FallbackDatasets = {
  skills: [],
  enrollments: [],
  quizAttempts: [],
  feedback: [],
  articles: [],
  sessions: [],
};

const fetchFallbackDatasets = async (userIds: string[]): Promise<FallbackDatasets> => {
  if (userIds.length === 0) return emptyFallbackDatasets;

  const [skillsResult, enrollmentsResult, quizAttemptsResult, feedbackResult, articlesResult, sessionsResult] =
    await Promise.all([
      supabase
        .from('user_skills')
        .select('user_id, proficiency_level, is_teaching, is_learning, skills(id, name, category)')
        .in('user_id', userIds),
      supabase
        .from('enrollments')
        .select('user_id, progress_pct, completed_at, courses(id, title, category, difficulty)')
        .in('user_id', userIds),
      supabase.from('quiz_attempts').select('user_id, score').in('user_id', userIds),
      supabase.from('feedback').select('to_user_id, rating').in('to_user_id', userIds),
      supabase.from('articles').select('author_id').in('author_id', userIds),
      supabase
        .from('video_sessions')
        .select('requester_id, mentor_user_id, status')
        .or(`requester_id.in.(${userIds.join(',')}),mentor_user_id.in.(${userIds.join(',')})`),
    ]);

  for (const result of [skillsResult, enrollmentsResult, quizAttemptsResult, feedbackResult, articlesResult, sessionsResult]) {
    if (result.error) throw result.error;
  }

  return {
    skills: skillsResult.data || [],
    enrollments: enrollmentsResult.data || [],
    quizAttempts: quizAttemptsResult.data || [],
    feedback: feedbackResult.data || [],
    articles: articlesResult.data || [],
    sessions: sessionsResult.data || [],
  };
};

const buildFallbackReadiness = (
  users: AdminUser[],
  datasets: FallbackDatasets = emptyFallbackDatasets
): OpportunityReadiness[] => {
  const skillsByUser = groupBy(datasets.skills, 'user_id');
  const enrollmentsByUser = groupBy(datasets.enrollments, 'user_id');
  const quizAttemptsByUser = groupBy(datasets.quizAttempts, 'user_id');
  const feedbackByUser = groupBy(datasets.feedback, 'to_user_id');
  const articlesByUser = groupBy(datasets.articles, 'author_id');
  const sessionsByUser = datasets.sessions.reduce<Record<string, any[]>>((acc, session) => {
    for (const userId of [session.requester_id, session.mentor_user_id]) {
      if (!userId) continue;
      acc[userId] = acc[userId] || [];
      acc[userId].push(session);
    }
    return acc;
  }, {});

  return users.map((user) => {
    const skillRows = skillsByUser[user.id] || [];
    const enrollmentRows = enrollmentsByUser[user.id] || [];
    const quizRows = quizAttemptsByUser[user.id] || [];
    const feedbackRows = feedbackByUser[user.id] || [];
    const articleRows = articlesByUser[user.id] || [];
    const sessionRows = sessionsByUser[user.id] || [];

    const skills = skillRows
      .map((row) => ({
        name: row.skills?.name,
        category: row.skills?.category || null,
        proficiency_level: row.proficiency_level || 1,
        is_teaching: Boolean(row.is_teaching),
        is_learning: Boolean(row.is_learning),
      }))
      .filter((skill) => skill.name) as ReadinessSkill[];

    const avgSkillProficiency = average(skills.map((skill) => skill.proficiency_level));
    const avgCourseProgress = average(enrollmentRows.map((row) => row.progress_pct));
    const completedCourses = enrollmentRows.filter(
      (row) => row.completed_at || Number(row.progress_pct || 0) >= 100
    ).length;
    const avgQuizScore = average(quizRows.map((row) => row.score));
    const avgFeedback = average(feedbackRows.map((row) => row.rating));
    const completedSessions = sessionRows.filter(
      (row) => row.status === 'ended' || row.status === 'accepted'
    ).length;

    const skillScore = Math.min(100, (avgSkillProficiency / 5) * 100);
    const learningScore = Math.min(100, avgCourseProgress);
    const quizScore = Math.min(100, avgQuizScore);
    const feedbackScore = Math.min(100, (avgFeedback / 5) * 100);
    const contributionScore = Math.min(100, completedSessions * 12 + articleRows.length * 10);
    const xpScore = Math.min(100, Number(user.xp_points || 0) / 10);
    const profileFallbackScore = Math.min(
      100,
      Math.min(45, Math.round((user.xp_points || 0) / 20)) +
        Math.min(35, (user.level || 1) * 5) +
        (user.headline ? 10 : 0)
    );

    const evidenceScore = Math.round(
      skillScore * 0.25 +
        learningScore * 0.2 +
        quizScore * 0.2 +
        feedbackScore * 0.15 +
        contributionScore * 0.1 +
        xpScore * 0.1
    );
    const hasEvidence =
      skills.length > 0 ||
      enrollmentRows.length > 0 ||
      quizRows.length > 0 ||
      feedbackRows.length > 0 ||
      articleRows.length > 0 ||
      sessionRows.length > 0;
    const readinessScore = hasEvidence ? evidenceScore : profileFallbackScore;
    const readinessBand =
      readinessScore >= 70 ? 'Ready' : readinessScore >= 40 ? 'Growing' : 'Needs Support';

    return {
      user,
      readiness_score: readinessScore,
      readiness_band: readinessBand,
      recommended_opportunity: getFallbackOpportunity({
        user,
        skills,
        readinessScore,
        completedCourses,
        avgFeedback,
      }),
      evidence: {
        skills: skills.slice(0, 5),
        completed_courses: completedCourses,
        enrolled_courses: enrollmentRows.length,
        average_course_progress: Number(avgCourseProgress.toFixed(1)),
        quiz_attempts: quizRows.length,
        average_quiz_score: Number(avgQuizScore.toFixed(1)),
        peer_sessions: completedSessions,
        average_feedback_rating: Number(avgFeedback.toFixed(2)),
        resources_contributed: articleRows.length,
      },
    };
  });
};

export default function OpportunityReadinessPage() {
  const [rows, setRows] = useState<OpportunityReadiness[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const response = await api.get('/admin/opportunity-readiness?limit=100');
        setRows(unwrapData<OpportunityReadiness[]>(response) || []);
      } catch (error: any) {
        if (error?.response?.status === 404) {
          const fallbackResponse = await api.get('/admin/users?limit=100');
          const users = unwrapData<AdminUser[]>(fallbackResponse) || [];
          const datasets = await fetchFallbackDatasets(users.map((user) => user.id));
          setRows(buildFallbackReadiness(users, datasets));
          toast('Using direct readiness data until the backend endpoint is updated.');
          return;
        }

        toast.error(error?.response?.data?.message || 'Failed to load opportunity readiness');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const summary = useMemo(() => {
    const ready = rows.filter((row) => row.readiness_band === 'Ready').length;
    const growing = rows.filter((row) => row.readiness_band === 'Growing').length;
    const avgScore =
      rows.length === 0
        ? 0
        : Math.round(rows.reduce((sum, row) => sum + row.readiness_score, 0) / rows.length);

    return [
      { label: 'Ready for opportunity', value: ready, icon: CheckCircle2 },
      { label: 'Growing candidates', value: growing, icon: TrendingUp },
      { label: 'Average readiness', value: `${avgScore}%`, icon: GraduationCap },
    ];
  }, [rows]);

  const columns = useMemo<ColumnDef<OpportunityReadiness>[]>(
    () => [
      {
        id: 'employee',
        header: 'Employee',
        cell: ({ row }) => (
          <div>
            <p className="font-medium text-slate-900">{row.original.user.full_name}</p>
            <p className="text-xs text-slate-500">
              {row.original.user.headline || 'No headline'} {row.original.user.location ? `- ${row.original.user.location}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {row.original.evidence.skills.slice(0, 3).map((skill) => (
                <Badge key={skill.name} variant={skill.is_teaching ? 'primary' : 'default'}>
                  {skill.name} L{skill.proficiency_level}
                </Badge>
              ))}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'readiness_score',
        header: 'Readiness',
        cell: ({ row }) => (
          <div className="min-w-32">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900">{row.original.readiness_score}%</span>
              <Badge variant={bandVariant(row.original.readiness_band)}>{row.original.readiness_band}</Badge>
            </div>
            <div className="mt-2 h-2 rounded-full bg-slate-100">
              <div
                className="h-2 rounded-full bg-blue-600"
                style={{ width: `${Math.min(100, Math.max(0, row.original.readiness_score))}%` }}
              />
            </div>
          </div>
        ),
      },
      {
        id: 'evidence',
        header: 'Evidence',
        cell: ({ row }) => (
          <div className="space-y-1 text-xs text-slate-600">
            <p>{row.original.evidence.completed_courses}/{row.original.evidence.enrolled_courses} courses completed</p>
            <p>{row.original.evidence.average_course_progress}% average course progress</p>
            <p>{row.original.evidence.quiz_attempts} quiz attempts, {row.original.evidence.average_quiz_score}% average</p>
            <p>{row.original.evidence.peer_sessions} peer sessions, {row.original.evidence.average_feedback_rating || '--'}/5 feedback</p>
          </div>
        ),
      },
      {
        accessorKey: 'recommended_opportunity',
        header: 'Suggested Opportunity',
        cell: ({ row }) => (
          <p className="max-w-sm text-sm font-medium text-slate-800">{row.original.recommended_opportunity}</p>
        ),
      },
    ],
    []
  );

  if (loading) {
    return <Skeleton variant="rect" className="h-72" />;
  }

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <BriefcaseBusiness className="h-5 w-5 text-blue-500" />
          <h1 className="text-2xl font-bold text-slate-900">Opportunity Readiness</h1>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Review who is ready for new work based on learning progress, skill evidence, quizzes, peer sessions, and feedback.
        </p>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {summary.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className="p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xl font-bold text-slate-900">{item.value}</p>
                  <p className="text-xs text-slate-500">{item.label}</p>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-6">
        <AdminDataTable
          data={rows}
          columns={columns}
          emptyTitle="No readiness data"
          emptyDescription="Readiness appears after employees build skills, complete courses, attempt quizzes, or join peer sessions."
          maxHeightClassName="max-h-[34rem]"
        />
      </Card>
    </div>
  );
}
