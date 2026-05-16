import { PeerRecommendation } from '@/types';

type LegacyRecommendation = Partial<PeerRecommendation> & {
  teaching_skills?: {
    skill_name?: string;
    proficiency_level?: number;
  }[];
};

export function normalizePeerRecommendations(
  payload: PeerRecommendation[] | { recommendations?: LegacyRecommendation[] } | null | undefined
): PeerRecommendation[] {
  const recommendations = Array.isArray(payload)
    ? payload
    : payload?.recommendations || [];

  return recommendations
    .filter((item): item is LegacyRecommendation => Boolean(item?.user?.id))
    .map((item) => ({
      ...item,
      matchingSkills:
        item.matchingSkills ||
        item.teaching_skills?.map((skill) => ({
          skillName: skill.skill_name || 'Unknown Skill',
          peerProficiency: skill.proficiency_level || 0,
        })) ||
        [],
      matchScore: item.matchScore ?? item.matchingSkills?.length ?? item.teaching_skills?.length ?? 0,
    })) as PeerRecommendation[];
}
