---
title: "EF Core Split Queries and the Cartesian Explosion"
slug: "efcore-split-queries-cartesian-explosion"
excerpt: "Two collection Includes turn one query into a row explosion. Split queries fix the Cartesian product but add round trips and ordering caveats."
category: "Data & EF Core"
tags: ["efcore", "split-queries", "collections"]
date: "2026-06-26"
level: "Advanced"
author: "Riad Hossain"
---

Include two collections in one query and EF Core generates a single SQL statement with a join per collection. Because the collections are independent, the database multiplies them together: five lines times four attachments produces twenty rows for one order, and EF Core then deduplicates them back in memory. This is the Cartesian explosion. It is invisible in development with three rows per table and catastrophic in production where a single order can carry hundreds of children.

## What a collection Include does to the SQL

`Include` for a reference navigation is a join and adds no duplication, because the reference side is one row. `Include` for a collection navigation multiplies the parent row by the number of children. Include two collections and the row count is the product, not the sum. The context then has to materialise the product and reshape it, which means wasted bandwidth, wasted allocation and a plan that gets slower as the product grows.

## AsSplitQuery and the extra round trips

`AsSplitQuery` tells EF Core to emit one statement per collection instead of joining them, then stitch the results. The row count collapses to the sum of the collections, the reshaped graph is the same, and the cost becomes additional round trips — one per collection include.

```csharp
var orders = await _db.Orders
    .Where(o => o.CustomerId == customerId)
    .Include(o => o.Lines)
    .Include(o => o.Attachments)
    .AsSplitQuery()
    .AsNoTracking()
    .ToListAsync(cancellationToken);
```

### The ordering caveat

Split queries and pagination do not compose safely by default. If you `Skip` and `Take` a parent set that a split query then fans out, EF Core must guarantee a deterministic parent order or you will page through an inconsistent set. Apply the ordering on the primary key and be aware that EF Core materialises the parent page first; a missing `OrderBy` on a split query can produce duplicated or dropped parents across pages.

## When to split and when to keep one query

- Two or more collection includes on the same root: split.
- One collection and long rows with text or blob columns: split, because the duplicated payload dominates.
- Narrow rows, one collection, small page: a single query is usually fine and cheaper on round trips.
- A query you cannot afford two round trips for and whose collections are tiny: keep it joined.
- Any split query used with pagination: verify ordering explicitly.

## Making it the default, carefully

You can flip the splitting behaviour globally with `UseQuerySplittingBehavior(QuerySplittingBehavior.SplitQuery)` and opt back into a single query per call with `AsSingleQuery`. That is a reasonable default for a service whose collections are large, but it silently adds round trips to every query that touches a collection, so confirm your connection latency budget first.

## The trade-off

Split queries trade network round trips for row volume. On a low-latency local connection, avoiding duplicated rows is almost always the win. Across a slow link, the extra round trip can cost more than the duplicated columns, especially for small collections where the product is trivial. Measure both; the explosion is a data-shape problem and the right choice flips as the data grows.
