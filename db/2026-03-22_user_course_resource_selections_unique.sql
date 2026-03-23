-- Ensure one latest resource selection per user per course.
-- 1) Deduplicate existing rows, keeping the most recent selection.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, course_id
      ORDER BY selected_at DESC, id DESC
    ) AS rn
  FROM user_course_resource_selections
)
DELETE FROM user_course_resource_selections
WHERE id IN (
  SELECT id
  FROM ranked
  WHERE rn > 1
);

-- 2) Add unique constraint for upsert conflict target.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_course_resource_selections_user_course_key'
  ) THEN
    ALTER TABLE user_course_resource_selections
    ADD CONSTRAINT user_course_resource_selections_user_course_key
    UNIQUE (user_id, course_id);
  END IF;
END $$;

