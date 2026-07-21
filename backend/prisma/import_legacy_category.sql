nexINSERT INTO aquaflow.customer_categories (
  category_code,
  category_name,
  description,
  status
)
VALUES (
  'LEGACY',
  'Legacy Customer',
  'Default category assigned during migration',
  'ACTIVE'
)
ON CONFLICT (category_code) DO UPDATE SET
  category_name = EXCLUDED.category_name,
  description = EXCLUDED.description,
  status = EXCLUDED.status,
  updated_at = NOW();
