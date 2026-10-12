# Turso Migration Proof of Concept

This branch is isolated from `main`. It must not be deployed to the production Render service until the migration is fully tested.

## Safety rules

- Keep the current Render PostgreSQL database as the source of truth.
- Never put Turso credentials in GitHub.
- Use a separate Turso database for development/testing.
- Export and verify a PostgreSQL backup before any production data migration.
- Do not change Render's production `DATABASE_URL` during the proof of concept.

## Known compatibility work

The current application uses the Node `pg` package and PostgreSQL syntax across command and service modules. The schema includes `BIGSERIAL`, `TIMESTAMPTZ`, `JSONB`, boolean defaults, CHECK constraints, foreign keys, `NOW()`, `ON CONFLICT`, `RETURNING`, positional parameters (`$1`, `$2`), casts such as `::int`, and PostgreSQL-specific aggregate/order syntax. These must be reviewed individually; changing only the driver or connection URL is not sufficient.

## Proof-of-concept acceptance checklist

- [ ] Create a separate Turso database and store its URL/token only in local/Render environment variables.
- [ ] Create a minimal SQLite-compatible test schema.
- [ ] Verify inserts, reads, updates, unique constraints, foreign keys, and JSON serialization.
- [ ] Verify timestamps and ID behavior.
- [ ] Audit and convert every SQL statement used by production commands/services.
- [ ] Export the source PostgreSQL database and import into the test database.
- [ ] Compare row counts and representative records for every table.
- [ ] Run command-level integration tests against the test database.
- [ ] Confirm the production bot still uses PostgreSQL until all checks pass.
- [ ] Make a rollback plan before any production cutover.

## Initial recommendation

Use a deliberate SQLite/libSQL adapter and convert queries in small groups. Do not attempt a broad automatic SQL rewrite because type conversion and transaction semantics can change behavior.
