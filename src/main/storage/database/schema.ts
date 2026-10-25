export interface DatabaseMigration {
  version: number;
  sql: string;
}

// Applied SQL is immutable: schema changes belong in a new numbered migration.
export const DATABASE_MIGRATIONS: readonly DatabaseMigration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      CREATE TABLE scope_revisions (
        scope TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision >= 0)
      ) STRICT;
      INSERT INTO scope_revisions VALUES
        ('app-config', 0), ('custom-cli-configs', 0), ('config-file-profiles', 0);
      CREATE TABLE app_operations (
        operation_id TEXT PRIMARY KEY, kind TEXT NOT NULL, state TEXT NOT NULL,
        profile_id TEXT, created_at INTEGER NOT NULL, payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE site_groups (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, sort_order INTEGER NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE sites (
        id TEXT PRIMARY KEY, group_id TEXT NOT NULL REFERENCES site_groups(id),
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)), sort_order INTEGER NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;
      CREATE INDEX sites_group ON sites(group_id, sort_order);
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL, payload TEXT NOT NULL
      ) STRICT;
      CREATE INDEX accounts_site ON accounts(site_id, sort_order);
      CREATE TABLE site_defaults (
        site_id TEXT PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE
      ) STRICT;
      CREATE TRIGGER site_default_insert BEFORE INSERT ON site_defaults
        WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE id = NEW.account_id AND site_id = NEW.site_id)
        BEGIN SELECT RAISE(ABORT, 'Default account belongs to another site'); END;
      CREATE TRIGGER site_default_update BEFORE UPDATE ON site_defaults
        WHEN NOT EXISTS(SELECT 1 FROM accounts WHERE id = NEW.account_id AND site_id = NEW.site_id)
        BEGIN SELECT RAISE(ABORT, 'Default account belongs to another site'); END;
      CREATE TRIGGER default_account_owner_update BEFORE UPDATE OF site_id ON accounts
        WHEN EXISTS(SELECT 1 FROM site_defaults WHERE account_id = OLD.id AND site_id != NEW.site_id)
        BEGIN SELECT RAISE(ABORT, 'Default account belongs to another site'); END;
      CREATE TABLE account_keys (
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        source TEXT NOT NULL, key_id TEXT NOT NULL, sort_order INTEGER NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(account_id, source, key_id)
      ) STRICT;
      CREATE TABLE route_rules (
        id TEXT PRIMARY KEY, priority INTEGER NOT NULL, sort_order INTEGER NOT NULL,
        enabled INTEGER NOT NULL CHECK(enabled IN (0, 1)),
        has_site_filter INTEGER NOT NULL CHECK(has_site_filter IN (0, 1)),
        has_account_filter INTEGER NOT NULL CHECK(has_account_filter IN (0, 1)),
        payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE rule_sites (
        rule_id TEXT NOT NULL REFERENCES route_rules(id) ON DELETE CASCADE,
        site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        PRIMARY KEY(rule_id, site_id)
      ) STRICT;
      CREATE TABLE rule_accounts (
        rule_id TEXT NOT NULL REFERENCES route_rules(id) ON DELETE CASCADE,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        PRIMARY KEY(rule_id, account_id)
      ) STRICT;
      CREATE TABLE model_redirects (
        id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE model_exclusions (
        redirect_id TEXT NOT NULL REFERENCES model_redirects(id) ON DELETE CASCADE,
        model_key TEXT NOT NULL, PRIMARY KEY(redirect_id, model_key)
      ) STRICT;
      CREATE TABLE client_routing (
        client_id TEXT PRIMARY KEY, mode TEXT NOT NULL CHECK(mode IN ('client', 'session')),
        pinned INTEGER NOT NULL CHECK(pinned IN (0, 1)), payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE session_choices (
        id TEXT PRIMARY KEY, profile_id TEXT, parent_id TEXT,
        pinned INTEGER NOT NULL CHECK(pinned IN (0, 1)), payload TEXT NOT NULL
      ) STRICT;
      CREATE INDEX session_profile ON session_choices(profile_id);
      CREATE TABLE app_preferences (
        domain TEXT NOT NULL, key TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(domain, key)
      ) STRICT;
      CREATE TABLE custom_cli_configs (
        id TEXT PRIMARY KEY, sort_order INTEGER NOT NULL, payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE custom_cli_keys (
        config_id TEXT NOT NULL REFERENCES custom_cli_configs(id) ON DELETE CASCADE,
        key_id TEXT NOT NULL, sort_order INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(config_id, key_id)
      ) STRICT;
      CREATE TABLE custom_cli_active (
        singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
        config_id TEXT REFERENCES custom_cli_configs(id) ON DELETE SET NULL
      ) STRICT;
      CREATE TABLE config_file_profiles (
        id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision >= 0),
        sort_order INTEGER NOT NULL, payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE profile_files (
        profile_id TEXT NOT NULL REFERENCES config_file_profiles(id) ON DELETE CASCADE,
        file_id TEXT NOT NULL, sort_order INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(profile_id, file_id)
      ) STRICT;
      CREATE TABLE detection_cache (
        owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(owner_kind, owner_id)
      ) STRICT;
      CREATE TABLE site_daily_snapshots (
        site_id TEXT NOT NULL, snapshot_date TEXT NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(site_id, snapshot_date)
      ) STRICT;
      CREATE TABLE route_runtime (
        kind TEXT NOT NULL, record_key TEXT NOT NULL, updated_at INTEGER NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(kind, record_key)
      ) STRICT;
      CREATE INDEX runtime_updated ON route_runtime(updated_at);
      CREATE TABLE session_activity (
        instance_id TEXT PRIMARY KEY, last_request_at INTEGER NOT NULL, payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE session_bindings (
        binding_key TEXT PRIMARY KEY, updated_at INTEGER NOT NULL, payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE route_analytics_buckets (
        bucket_key TEXT PRIMARY KEY, bucket_start INTEGER NOT NULL,
        site_id TEXT, account_id TEXT, cli_type TEXT NOT NULL,
        target_protocol TEXT, target_endpoint TEXT, route_rule_id TEXT,
        canonical_model TEXT, api_key_id TEXT,
        request_count INTEGER NOT NULL CHECK(request_count >= 0),
        success_count INTEGER NOT NULL CHECK(success_count >= 0),
        failure_count INTEGER NOT NULL CHECK(failure_count >= 0),
        neutral_count INTEGER NOT NULL CHECK(neutral_count >= 0),
        prompt_tokens INTEGER NOT NULL CHECK(prompt_tokens >= 0),
        completion_tokens INTEGER NOT NULL CHECK(completion_tokens >= 0),
        total_tokens INTEGER NOT NULL CHECK(total_tokens >= 0),
        updated_at INTEGER NOT NULL, payload TEXT NOT NULL
      ) STRICT;
      CREATE INDEX analytics_time ON route_analytics_buckets(bucket_start);
      CREATE INDEX analytics_site_time ON route_analytics_buckets(site_id, bucket_start);
      CREATE INDEX analytics_account_time ON route_analytics_buckets(account_id, bucket_start);
      CREATE INDEX analytics_endpoint_time ON route_analytics_buckets(target_endpoint, bucket_start);
      CREATE TABLE route_model_sources (
        source_key TEXT PRIMARY KEY, source_type TEXT NOT NULL,
        site_id TEXT, account_id TEXT, last_seen_at INTEGER NOT NULL, payload TEXT NOT NULL
      ) STRICT;
      CREATE INDEX model_sources_seen ON route_model_sources(last_seen_at);
      CREATE TABLE response_affinity (
        namespace TEXT NOT NULL, resource_id TEXT NOT NULL,
        profile_id TEXT, updated_at INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(namespace, resource_id)
      ) STRICT;
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE document_metadata (
        document_id TEXT PRIMARY KEY, payload TEXT NOT NULL
      ) STRICT;
      CREATE TABLE document_records (
        document_id TEXT NOT NULL, collection TEXT NOT NULL, record_key TEXT NOT NULL,
        sort_order INTEGER NOT NULL, payload TEXT NOT NULL,
        PRIMARY KEY(document_id, collection, record_key)
      ) STRICT;
      CREATE INDEX document_record_collection ON document_records(document_id, collection, sort_order);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE rule_sites ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE rule_accounts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE model_exclusions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE route_model_sources ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX analytics_updated ON route_analytics_buckets(updated_at);
    `,
  },
];
