---
title: "Zero-Downtime Database Migrations in Production"
slug: "zero-downtime-migrations"
excerpt: "Additive migrations, concurrent index builds and batched backfills let you ship schema changes without a maintenance window if you follow the sequence."
category: "Data & EF Core"
tags: ["migrations", "deployment", "postgres"]
date: "2026-05-21"
level: "Advanced"
author: "Riad"
---

A migration that takes an exclusive lock on a busy table causes an outage even when the application deploy is a clean rolling restart. The database is the part of the release that cannot be rolled forward and backward at will, so schema changes need their own plan. Zero-downtime migrations are not a tool you install; they are a sequence of small, individually safe steps that never leave the old and new code unable to run against the same schema.

## Expand, then contract

The rule is that no single step may break either the running version or the incoming version. You never rename or drop a column while both code versions are live, because the old code reads the old name and the new code needs the new one. Instead you expand: add the new nullable column, migrate data, and write to both shapes during the transition.

```csharp
migrationBuilder.AddColumn<string>(
    name: "display_name",
    table: "users",
    type: "text",
    nullable: true);
```

The new column is nullable on purpose. A `NOT NULL` column with no default cannot be added to a populated table without a full rewrite, and a default value still scans under lock on many engines. Nullable first, backfill second, constrain third.

### Building indexes without blocking writes

On PostgreSQL a plain `CREATE INDEX` takes a write lock for the duration of the build, which on a large table is measured in minutes. The concurrent form avoids that lock but cannot run inside a transaction, and EF Core wraps migrations in a transaction by default, so you must suppress it for that statement specifically.

```csharp
migrationBuilder.Sql(
    "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_users_display_name ON users (display_name);",
    suppressTransaction: true);
```

`CREATE INDEX CONCURRENTLY` can fail and leave an invalid index behind, so the `IF NOT EXISTS` guard and a follow-up check that the index is valid are both worth having in the pipeline.

## Adding constraints without a long lock

A foreign key or check constraint added normally validates every existing row while holding a strong lock. PostgreSQL lets you add the constraint as not valid, which records it without scanning, and then validate it separately under a lock that blocks only other validates. The application sees the constraint immediately for new rows, and the full scan happens later without blocking readers.

```sql
ALTER TABLE orders ADD CONSTRAINT ck_orders_total CHECK (total >= 0) NOT VALID;
ALTER TABLE orders VALIDATE CONSTRAINT ck_orders_total;
```

### Backfills belong in the application

Do the backfill as a batched job, not as SQL inside the migration, so it can be sized, paused, and retried without holding a long transaction open. Small batches keep the write-amplification and bloat bounded and let autovacuum keep up.

```csharp
var affected = await context.Users
    .Where(u => u.DisplayName == null)
    .Take(5_000)
    .ExecuteUpdateAsync(s => s.SetProperty(u => u.DisplayName, u => u.Email), ct);
```

Loop that call until it returns zero, with a short delay between batches. Because it bypasses the change tracker it is fast, but it also bypasses converters and interceptors, so any value transformation must be written into the SQL itself.

## The deploy order that makes it safe

- Deploy the additive migration on its own, before any code that depends on it.
- Ship the application version that writes both the old and new shape and reads the new one when present.
- Run the batched backfill until every row is populated.
- Flip reads to the new column and confirm the old column is no longer written.
- After the retention window, ship a contract migration that drops the old column and validates constraints.

The trade-off is that a rename costs three deploys instead of one, and the schema carries a transitional column for a while. Teams that try to shortcut this with a single atomic migration get a fast local build and an outage in production, because the lock they did not think about is taken by the database against live traffic. Script the migrations with the idempotent output so a re-run after a partial failure is safe, and rehearse the whole sequence against a copy of production data before the first real attempt.
