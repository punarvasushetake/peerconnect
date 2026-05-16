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
