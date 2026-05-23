drop index if exists idx_items_translated_gin;

drop table if exists skill_gem_translations;

alter table if exists skill_gem_details
  drop column if exists summary_vi;

alter table if exists currency_items
  drop column if exists description_vi;

alter table if exists items
  drop column if exists translated_json;
