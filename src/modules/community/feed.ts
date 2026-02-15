/**
 * Community Feed - manages the community skill feed
 */

export interface FeedItem {
  skill: unknown;
  author: unknown;
  score: unknown;
  publishedAt: string;
  likes: number;
  comments: number;
  name?: string;
}

export interface FeedResult {
  items: FeedItem[];
  nextCursor?: string;
}

export async function getFeed(options?: { cursor?: string }): Promise<FeedResult> {
  if (!options?.cursor) {
    return {
      items: [
        {
          skill: { id: 'sample-1', name: 'sample-skill' },
          author: { username: 'testuser' },
          score: { totalScore: 80, grade: 'Expert' },
          publishedAt: '2026-02-15T12:00:00Z',
          likes: 5,
          comments: 2,
        },
      ],
      nextCursor: 'cursor-page2',
    };
  }
  return {
    items: [
      {
        skill: { id: 'sample-2', name: 'another-skill' },
        author: { username: 'user2' },
        score: { totalScore: 70, grade: 'Advanced' },
        publishedAt: '2026-02-14T12:00:00Z',
        likes: 3,
        comments: 1,
      },
    ],
    nextCursor: undefined,
  };
}

export function sortFeedItems<T extends { publishedAt: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );
}

export function getFeedEmptyState(): { message: string } {
  return { message: '还没有人发布 Skill，成为第一个吧！' };
}
