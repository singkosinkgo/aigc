ALTER TABLE model_configs
  ADD COLUMN portrait_url VARCHAR(1024) NULL AFTER params_json;
