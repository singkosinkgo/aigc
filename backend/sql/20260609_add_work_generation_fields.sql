ALTER TABLE works
  ADD COLUMN generation_params_json LONGTEXT NULL AFTER prompt,
  ADD COLUMN reference_urls_json LONGTEXT NULL AFTER generation_params_json;
