---
title: "EF Core Change Tracking and Projection Performance"
slug: "efcore-change-tracking-performance"
excerpt: "Tracking every entity you read is the most common EF Core performance mistake. Project into DTOs, use AsNoTracking, and update without loading."
category: "Data & EF Core"
tags: ["efcore", "change-tracking", "performance"]
date: "2026-07-02"
level: "Advanced"
author: "Riad"
---

The most common EF Core performance mistake is not a missing index. It is reading a thousand tracked entities to display twenty fields. Change tracking is not free: for every materialised entity the context allocates a snapshot of the original values, records the entity in the state manager, performs identity resolution by primary key, and wires up fixup across navigations. A query that returns a million rows to sum one column spends most of its time building tracking graphs no one will ever use.

## What the change tracker actually costs

When a query materialises entities, EF Core creates a snapshot per entity and stores it in the change tracker. On `SaveChanges` it diffs current against original to decide what to update. That snapshot costs memory proportional to columns times rows, and identity resolution adds dictionary lookups. Fixup is worse for graphs: adding one entity can walk navigations to reconnect related instances. None of this happens when you project into a DTO, because a projected type is not tracked.

## Projection is the default fix

Project only the columns you need. A projection into a record or anonymous type bypasses entity materialisation, the snapshot, identity resolution and fixup entirely.

```csharp
var summaries = await _db.Orders
    .Where(o => o.Status == OrderStatus.Open)
    .OrderByDescending(o => o.CreatedOn)
    .Select(o => new OrderSummary(
        o.Id,
        o.CustomerName,
        o.Lines.Sum(l => l.Quantity * l.UnitPrice)))
    .Take(50)
    .AsNoTracking()
    .ToListAsync(cancellationToken);
```

Read-only queries should carry `AsNoTracking`. Reach for `AsNoTrackingWithIdentityResolution` only when the same entity appears twice in the result graph and you need the identical instance — it reintroduces the identity dictionary but skips the change snapshot.

### Streaming versus buffering

For very large reads, do not call `ToListAsync`. Enumerate `AsAsyncEnumerable` and process rows as they arrive, or better, push the aggregation into SQL with `GroupBy` and `Sum` so the database does the work and the network carries a scalar. Materialise a large tracked list and you hold the whole graph in memory.

## Updating without loading

Loading an entity to change one column is a read, a tracking operation and a diff. If your business rules allow it, update in place with `ExecuteUpdateAsync`, which issues a single statement and never materialises an entity.

```csharp
var affected = await _db.Orders
    .Where(o => o.Status == OrderStatus.Stale && o.CreatedOn < cutoff)
    .ExecuteUpdateAsync(s => s
        .SetProperty(o => o.Status, OrderStatus.Cancelled)
        .SetProperty(o => o.UpdatedOn, DateTime.UtcNow), cancellationToken);
```

Use it for bulk, rule-free changes. It bypasses `SaveChanges` interceptors and does not raise domain events, so keep it away from state that other modules observe.

## A short checklist

- Read-only query: `AsNoTracking` plus a projection into a DTO.
- Huge result set: aggregate in SQL, or stream with `AsAsyncEnumerable`.
- Bulk update or delete: `ExecuteUpdateAsync` or `ExecuteDeleteAsync`.
- Same instance required twice: `AsNoTrackingWithIdentityResolution`.
- Genuine graph mutation: track it, but keep the graph small.

## The trade-off

Tracking exists so that `SaveChanges` can compute a minimal diff for you. Projecting and using `ExecuteUpdateAsync` moves that responsibility into your code: you must express the change yourself, and you lose interceptors, events and concurrency checks unless you add them back. That is a fair trade for read-heavy endpoints and bulk jobs, and a poor one for complex aggregates where the diffing is the point.
