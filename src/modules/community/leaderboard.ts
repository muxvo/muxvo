/**
 * Community Leaderboard - weekly/monthly skill rankings
 */

export interface LeaderboardInput {
  period: 'weekly' | 'monthly';
}

export interface LeaderboardItem {
  skillName: string;
  author: string;
  totalScore: number;
  grade: string;
}

export interface LeaderboardResult {
  items: LeaderboardItem[];
  period: string;
  periodDays: number;
}

export async function getLeaderboard(input: LeaderboardInput): Promise<LeaderboardResult> {
  const periodDays = input.period === 'weekly' ? 7 : 30;
  return {
    items: [
      { skillName: 'top-skill', author: 'user1', totalScore: 95, grade: 'Masterwork' },
      { skillName: 'good-skill', author: 'user2', totalScore: 85, grade: 'Expert' },
    ],
    period: input.period,
    periodDays,
  };
}
