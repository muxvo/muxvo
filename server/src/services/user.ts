import { query } from '../db/index.js';

export interface UserRow {
  id: string;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  status: string;
  role: string;
  created_at: Date;
  updated_at: Date;
}

export interface FindOrCreateUserParams {
  provider: string;
  providerId: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
  providerData?: Record<string, unknown>;
}

/**
 * Find an existing user by provider identity or email, or create a new one.
 *
 * Resolution order:
 *   1. Look up by (provider, provider_id) in user_identities JOIN users
 *   2. If found: update provider_data, return user
 *   3. If not found and email provided: look up by email in users
 *   4. If email match: create identity link, return user
 *   5. If no match: INSERT new user + INSERT identity, return user
 */
export async function findOrCreateUser(
  params: FindOrCreateUserParams,
): Promise<UserRow> {
  const {
    provider,
    providerId,
    email,
    displayName,
    avatarUrl,
    providerData = {},
  } = params;

  // Step 1: Look up by (provider, provider_id)
  const identityResult = await query<UserRow>(
    `SELECT u.*
     FROM user_identities ui
     JOIN users u ON u.id = ui.user_id
     WHERE ui.provider = $1 AND ui.provider_id = $2`,
    [provider, providerId],
  );

  if (identityResult.rows.length > 0) {
    // Step 2: Update provider_data and updated_at
    const user = identityResult.rows[0];
    await query(
      `UPDATE user_identities
       SET provider_data = $1
       WHERE provider = $2 AND provider_id = $3`,
      [JSON.stringify(providerData), provider, providerId],
    );
    await query(
      `UPDATE users SET updated_at = NOW() WHERE id = $1`,
      [user.id],
    );
    return user;
  }

  // Step 3: If email provided, look up existing user by email
  if (email) {
    const emailResult = await query<UserRow>(
      `SELECT * FROM users WHERE email = $1`,
      [email],
    );

    if (emailResult.rows.length > 0) {
      // Step 4: Link new identity to existing user
      const user = emailResult.rows[0];
      await query(
        `INSERT INTO user_identities (user_id, provider, provider_id, provider_data)
         VALUES ($1, $2, $3, $4)`,
        [user.id, provider, providerId, JSON.stringify(providerData)],
      );
      await query(
        `UPDATE users SET updated_at = NOW() WHERE id = $1`,
        [user.id],
      );
      return user;
    }
  }

  // Step 5: Create new user + identity
  const insertUserResult = await query<UserRow>(
    `INSERT INTO users (display_name, email, avatar_url)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [displayName ?? null, email ?? null, avatarUrl ?? null],
  );

  const newUser = insertUserResult.rows[0];

  await query(
    `INSERT INTO user_identities (user_id, provider, provider_id, provider_data)
     VALUES ($1, $2, $3, $4)`,
    [newUser.id, provider, providerId, JSON.stringify(providerData)],
  );

  return newUser;
}
