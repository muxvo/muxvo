/**
 * Community Comments - manages skill comments
 */

export interface Comment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  likes: number;
}

export interface CommentsResult {
  comments: Comment[];
}

export async function getComments(_skillId: string): Promise<CommentsResult> {
  return {
    comments: [
      {
        id: 'comment-1',
        author: 'user1',
        content: 'Great skill!',
        createdAt: '2026-02-15T10:00:00Z',
        likes: 3,
      },
    ],
  };
}
