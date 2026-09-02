-- Adds the two fields the frontend UI uses but public.tasks doesn't have.
-- Run this in the Supabase SQL editor, then set HAS_CATEGORY_PRIORITY = true
-- in frontend/api.js so the values are actually persisted.

alter table public.tasks
  add column if not exists category text not null default 'general',
  add column if not exists priority text not null default 'medium';
