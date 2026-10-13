---
title: "EF Core Connection Pooling, Batching and Command Timeouts"
slug: "efcore-connection-pooling-batching"
excerpt: "Pooled contexts, batch sizes and command timeouts decide how much throughput a single connection pool can carry. The conservative defaults exist for a reason."
category: "Data & EF Core"
tags: ["efcore", "pooling", "throughput"]
date: "2026-05-15"
level: "Advanced"
author: "Riad"
---

Under load, the database is usually the first component to saturate, and the first symptom is a graph where throughput flatlines while latency climbs. Three knobs dominate that curve in EF Core: how contexts are pooled, how writes are batched into round trips, and how long a command is allowed to run. Tuning them without understanding what each one does produces a system that is fast in benchmarks and fragile in production.

## Two pools, not one

There is a pool of `DbContext` instances and a pool of physical database connections, and they are different things. The context pool exists because constructing a context is cheap but not free: the model, the service provider, and the internal caches are rebuilt each time, which matters when you create thousands of short-lived contexts per second. Add the pooled factory so instances are reset and reused instead of recreated.

```csharp
builder.Services.AddPooledDbContextFactory<AppDbContext>(
    options => options.UseNpgsql(connectionString),
    poolSize: 128);
```

A pooled context is reset between leases, which means you must not store per-request state in its fields. Anything request-specific belongs in the method arguments; state parked on the context will leak across requests and produce a bug that only appears under concurrency.

### Sizing the connection pool

The physical pool lives in the connection string and is enforced by the provider. Every in-flight query holds one connection, so the pool size is effectively your concurrency ceiling for the database.

```csharp
var connectionString =
    "Host=db;Database=app;Username=app;Password=secret;" +
    "Maximum Pool Size=100;Minimum Pool Size=10;Timeout=15;" +
    "Max Auto Prepare=64;Command Timeout=30;";
```

`Maximum Pool Size` caps concurrency, `Timeout` decides how long a caller waits for a free connection before it throws, and `Max Auto Prepare` lets the provider cache prepared statements so repeated shapes skip the parse step. Setting the ceiling above what the database can actually serve does not add throughput; it converts a clear queue into lock contention inside the server.

## Batching writes into round trips

`SaveChangesAsync` does not issue one command per entity. The provider batches compatible statements into a single round trip, honouring `MaxBatchSize`, which caps how many statements travel together. This is why inserting a thousand rows is far faster through one save than through a thousand saves.

```csharp
optionsBuilder.UseNpgsql(connectionString, npgsql => npgsql
    .MaxBatchSize(100)
    .CommandTimeout(30)
    .EnableRetryOnFailure(3, TimeSpan.FromSeconds(5), null));
```

### When batching does not help

- Statements separated by reads cannot be combined, because the second statement depends on the first result.
- Explicit transaction boundaries do not disable batching within a single save, but they do force ordering that can reduce how much can travel together.
- A batch is only as fast as its slowest member, so mixing a trivial update with a heavy one lets the heavy one set the latency for the whole batch.

## Command timeouts and retries

`CommandTimeout` is a wall-clock limit on a single command, not on your request. A query that legitimately runs for forty seconds will be killed by a thirty second timeout regardless of how much of the budget your endpoint has left. Raise it deliberately for known heavy operations and keep the default tight everywhere else, so a runaway query fails fast instead of pinning a connection.

Retry-on-failure wraps the provider's transient error detection and replays the operation. The catch is that a retried write must be safe to replay, and a retried operation that was partially applied can duplicate work. Keep the retried unit small, make writes idempotent where you can, and remember that a user-initiated transaction needs to be submitted through the execution strategy so the retry covers the whole transaction rather than one statement inside it.

### Signs you have tuned the wrong thing

- Latency climbs while throughput is flat, which points at a saturated pool rather than slow queries.
- Connection timeout exceptions appear under load, which means the pool ceiling is below demand or a long transaction is holding connections.
- Random failures from retries that duplicate rows, which means a write is being replayed without idempotency.

The trade-off is that pooling and batching trade predictability for speed. A pooled context reuses internal state you must keep clean, a large batch raises the blast radius of a single failure, and a generous timeout hides a slow query until it does not. Start from the defaults, change one knob at a time, and watch pool wait time and batch latency together, because either in isolation will mislead you.
