create index if not exists idx_game_entities_item_base_typed
  on game_entities(
    extract_version_id,
    lower(display_name),
    ((normalized_json ->> 'item_class')),
    ((normalized_json ->> 'drop_level')),
    entity_key
  )
  where entity_type = 'item_base';

create index if not exists idx_game_entities_mod_typed
  on game_entities(
    extract_version_id,
    lower(display_name),
    ((normalized_json ->> 'level')),
    ((normalized_json ->> 'domain')),
    entity_key
  )
  where entity_type = 'mod';

create index if not exists idx_game_entities_active_skill_typed
  on game_entities(
    extract_version_id,
    lower(display_name),
    ((normalized_json ->> 'is_gem')),
    entity_key
  )
  where entity_type = 'active_skill';

create index if not exists idx_game_entities_passive_node_typed
  on game_entities(
    extract_version_id,
    lower(display_name),
    ((normalized_json ->> 'node_id')),
    ((normalized_json ->> 'notable')),
    ((normalized_json ->> 'keystone')),
    entity_key
  )
  where entity_type = 'passive_node';

create index if not exists idx_game_entities_stat_typed
  on game_entities(
    extract_version_id,
    entity_key,
    ((normalized_json ->> 'hash')),
    ((normalized_json ->> 'semantic'))
  )
  where entity_type = 'stat';

create index if not exists idx_game_entities_monster_variety_typed
  on game_entities(
    extract_version_id,
    lower(display_name),
    ((normalized_json ->> 'life_multiplier')),
    ((normalized_json ->> 'damage_multiplier')),
    entity_key
  )
  where entity_type = 'monster_variety';

create index if not exists idx_game_entities_world_area_typed
  on game_entities(
    extract_version_id,
    lower(display_name),
    ((normalized_json ->> 'act')),
    ((normalized_json ->> 'area_level')),
    ((normalized_json ->> 'endgame')),
    entity_key
  )
  where entity_type = 'world_area';

create index if not exists idx_game_entities_crafting_recipe_typed
  on game_entities(
    extract_version_id,
    lower(display_name),
    ((normalized_json ->> 'tier')),
    ((normalized_json ->> 'required_level')),
    entity_key
  )
  where entity_type = 'crafting_recipe';

create index if not exists idx_game_entities_endgame_map_typed
  on game_entities(
    extract_version_id,
    ((normalized_json ->> 'boss_area')),
    ((normalized_json ->> 'min_watchstone_tier')),
    entity_key
  )
  where entity_type = 'endgame_map';

create index if not exists idx_game_assets_image_typed
  on game_assets(extract_version_id, logical_path, asset_key)
  where kind = 'image';

create index if not exists idx_game_assets_video_typed
  on game_assets(extract_version_id, logical_path, asset_key)
  where kind = 'video';

create index if not exists idx_game_relations_has_stat_typed
  on game_entity_relations(
    extract_version_id,
    from_entity_type,
    from_entity_key,
    to_entity_key
  )
  where relation_type = 'has_stat';

create index if not exists idx_game_relations_has_tag_typed
  on game_entity_relations(
    extract_version_id,
    from_entity_type,
    from_entity_key,
    to_entity_key
  )
  where relation_type = 'has_tag';

create index if not exists idx_game_relations_monster_refs_typed
  on game_entity_relations(
    extract_version_id,
    from_entity_key,
    relation_type,
    to_entity_type,
    to_entity_key
  )
  where from_entity_type = 'monster_variety'
    and relation_type in ('has_mod', 'has_tag', 'uses_granted_effect', 'uses_skill');

create index if not exists idx_game_relations_uses_asset_typed
  on game_entity_relations(
    extract_version_id,
    from_entity_type,
    from_entity_key,
    relation_type,
    to_entity_key
  )
  where relation_type in ('uses_icon', 'uses_video');
