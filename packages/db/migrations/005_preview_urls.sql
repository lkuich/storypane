ALTER TABLE spaces ADD COLUMN preview_urls jsonb NOT NULL DEFAULT '[]';
ALTER TABLE spaces ADD COLUMN default_preview_id uuid;
UPDATE spaces SET default_preview_id=gen_random_uuid() WHERE preview_url<>'';
UPDATE spaces SET preview_urls=jsonb_build_array(jsonb_build_object('id',default_preview_id,'name','Default','url',preview_url)) WHERE preview_url<>'';
ALTER TABLE spaces DROP COLUMN preview_url;
