import type { PoolClient } from 'pg';

// Call only after the identity provider has verified ownership of the email.
export async function acceptVerifiedEmailInvitations(
  client: PoolClient,
  userId: string,
  email: string,
) {
  await client.query(
    `WITH accepted AS (
    DELETE FROM space_invitations WHERE email=$2 AND expires_at>clock_timestamp() RETURNING space_id,role
  ) INSERT INTO memberships(space_id,user_id,role) SELECT space_id,$1,role FROM accepted
    ON CONFLICT(space_id,user_id) DO NOTHING`,
    [userId, email.trim().toLowerCase()],
  );
}
