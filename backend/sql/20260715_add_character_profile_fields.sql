ALTER TABLE characters
  ADD COLUMN birthplace VARCHAR(255) NULL AFTER gender,
  ADD COLUMN age INT NULL AFTER birthplace,
  ADD COLUMN height_cm INT NULL AFTER age,
  ADD COLUMN weight_kg DECIMAL(6,2) NULL AFTER height_cm,
  ADD COLUMN skin_tone VARCHAR(100) NULL AFTER weight_kg,
  ADD COLUMN hairstyle VARCHAR(255) NULL AFTER skin_tone,
  ADD COLUMN clothing_style VARCHAR(255) NULL AFTER hairstyle;
