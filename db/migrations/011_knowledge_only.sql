-- Migration 011: "knowledge only" businesses.
-- A business can be limited to its own knowledge documents (migration 009):
-- questions its documents do not cover get a fixed, polite reply without any
-- AI call, and answers use only its documents (no web, links, tools or
-- general knowledge). Off for everyone by default, including the platform.
-- Run once in the Supabase SQL editor; safe to run again.

alter table public.tenants add column if not exists knowledge_only boolean not null default false;
alter table public.tenants add column if not exists off_topic_reply text;

do $$ begin
  alter table public.tenants add constraint tenants_off_topic_reply_len
    check (off_topic_reply is null or char_length(off_topic_reply) between 1 and 500);
exception when duplicate_object then null; end $$;
