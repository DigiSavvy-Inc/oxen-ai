-- Clear saved Oxen keys whose ciphertext or IV is not structurally valid standard base64,
-- so the user sees "no key" and can re-enter it. Valid rows are untouched; no rows are deleted.
-- Numbered 0020 because open PR #39 already uses 0018 (which also exists on main as 0018_gallery_item_role) and will need 0019.
UPDATE users
SET oxen_key_ciphertext = NULL,
    oxen_key_iv = NULL,
    updated_at = CAST(strftime('%s', 'now') AS INTEGER)
WHERE oxen_key_ciphertext IS NOT NULL
  AND (
    LENGTH(oxen_key_ciphertext) % 4 != 0
    OR oxen_key_ciphertext GLOB '*[^A-Za-z0-9+/=]*'
    OR oxen_key_iv IS NULL
    OR LENGTH(oxen_key_iv) % 4 != 0
    OR oxen_key_iv GLOB '*[^A-Za-z0-9+/=]*'
  );
