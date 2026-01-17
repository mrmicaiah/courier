-- Migration: Set send_at_time to 09:00 for all Proverbs Library sequences
-- Run in Cloudflare D1 console

-- Update all steps for sequences on the Proverbs Library list (proverbs-library)
UPDATE sequence_steps 
SET send_at_time = '09:00', updated_at = datetime('now')
WHERE sequence_id IN (
  SELECT s.id FROM sequences s
  JOIN lists l ON s.list_id = l.id
  WHERE l.slug = 'proverbs-library'
);

-- Verify the update
SELECT 
  seq.name as sequence_name,
  ss.position,
  ss.subject,
  ss.delay_minutes,
  ss.send_at_time
FROM sequence_steps ss
JOIN sequences seq ON ss.sequence_id = seq.id
JOIN lists l ON seq.list_id = l.id
WHERE l.slug = 'proverbs-library'
ORDER BY seq.name, ss.position;
