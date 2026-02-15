/**
 * Community Profile - user profile pages
 */

export interface UserProfile {
  username: string;
  url: string;
  skills: unknown[];
  totalScore: number;
}

export async function getUserProfile(username: string): Promise<UserProfile> {
  return {
    username,
    url: `https://showcase.muxvo.com/@${username}`,
    skills: [],
    totalScore: 0,
  };
}
