---
title: "Compiled Queries and Query Plan Caching in EF Core"
slug: "efcore-compiled-queries"
excerpt: "EF Core caches query plans per shape, so dynamic queries defeat it. Compiled queries and parameterisation keep the cache effective at scale."
category: "Data & EF Core"
tags: ["efcore", "compiled-queries", "performance"]
date: "2026-06-20"
level: "Advanced"
author: "Riad"
---

EF Core recompiles a LINQ query the first time it sees a given shape and then caches the translated plan, keyed by the expression tree with the parameter values factored out. Under load this cache is the difference between a warm, prepared query and a translation on every call. It stops working the moment your queries stop having a fixed shape — inline values, conditional includes, or a dynamically assembled predicate — and the cache fills with near-duplicate plans that never get reused.

## How the query plan cache works

Each LINQ query is an expression tree. EF Core canonicalises it by replacing the constant values that came from variables with parameters, then keys the cache on that canonical shape. Two calls that differ only in a parameter value hit the same cached plan; that is why `Where(o => o.Id == id)` with `id` a captured variable is efficient, and why inlining a literal does not help. When the shape varies per call, the cache thrashes and translation cost returns on the hot path.

## Compiled queries for hot paths

A compiled query caches the translation explicitly in a static delegate, skipping the cache lookup and the query-key computation altogether. For a hammered endpoint it removes measurable per-call overhead.

```csharp
private static readonly Func<AppDbContext, Guid, CancellationToken, Task<Order?>> GetOrderById =
    EF.CompileAsyncQuery((AppDbContext db, Guid id, CancellationToken ct) =>
        db.Orders
            .Include(o => o.Lines)
            .FirstOrDefault(o => o.Id == id));

public static Task<Order?> LoadAsync(AppDbContext db, Guid id, CancellationToken ct)
    => GetOrderById(db, id, ct);
```

### Parameters, not literals

The delegate's arguments are the parameters of the compiled query. Every value the query depends on must be passed as an argument, never captured from the enclosing scope, or the compiled plan is wrong for the new value. Also remember the compiled delegate takes the live context as its first argument, so hand it the contextual instance and not a stale one.

## Where the benefits are real and where they are not

- Hot, stable query shapes: a compiled query pays back the effort almost immediately.
- Reporting or admin queries run a few times a minute: skip it, the cache is already warm.
- Queries built dynamically from filters: fix the shape first by parameterising; a compiled query cannot express a variable number of predicates.
- Queries whose result is a projection: compilable, and often the best candidates.
- Many distinct static queries: you are trading code clarity for a marginal gain in a process with one hot path.

## The trade-off

Compiled queries add a layer of indirection between the LINQ you can read and the delegate you call, and that indirection is easy to get wrong when a parameter is captured instead of passed. They also lost much of their edge in recent versions, because the built-in plan cache got faster and the per-call key computation cheaper; measure before you compile. Reach for them on the two or three endpoints that carry the traffic, keep the plain LINQ everywhere else, and treat the plan cache — not compiled queries — as the thing you actually need to protect.
