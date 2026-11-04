import type { Pool } from 'pg';

export async function isPublishedAsset(
  db: Pick<Pool, 'query'>,
  spaceId: string,
  assetId: string,
  publicOnly = false,
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM assets a JOIN spaces sp ON sp.id=a.space_id
     WHERE a.id=$2 AND a.space_id=$1 AND (NOT $3::boolean OR sp.public_media)
       AND EXISTS (SELECT 1 FROM stories s JOIN story_locales l ON l.story_id=s.id
         JOIN publications p ON p.id=l.published_version_id
         WHERE s.space_id=a.space_id AND s.deleted_at IS NULL
           AND jsonb_path_exists(p.content,'$.**.assetId ? (@ == $assetId)',jsonb_build_object('assetId',$2::text)))`,
    [spaceId, assetId, publicOnly],
  );
  return !!result.rowCount;
}
