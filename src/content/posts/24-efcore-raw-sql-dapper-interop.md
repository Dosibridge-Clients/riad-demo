---
title: "Raw SQL, Table-Valued Functions and Dapper Interop"
slug: "efcore-raw-sql-dapper-interop"
excerpt: "EF Core and Dapper coexist well if you keep tracked entities out of raw SQL. Table-valued functions and unmapped result types close most of the remaining gaps."
category: "Data & EF Core"
tags: ["efcore", "dapper", "sql"]
date: "2026-05-27"
level: "Advanced"
author: "Riad Hossain"
---

The moment a query outstrips what the LINQ provider can express, teams reach for raw SQL, and the moment they reach for raw SQL they wonder whether to keep EF Core in the picture at all. The answer is usually yes, but only if you understand where the abstraction stops being useful. EF Core and Dapper share a connection cleanly, and the failure modes come from mixing tracked entities with untracked results, not from the tools themselves.

## Raw SQL without interpolation hazards

The provider offers two entry points, and picking the wrong one is a security bug. String concatenation into SQL is injectable; the interpolated overload parameterises every interpolated hole, so the value never reaches the server as text.

```csharp
var threshold = 500m;
var orders = await context.Orders
    .FromSql($"SELECT * FROM orders WHERE total > {threshold}")
    .Where(o => o.CustomerId == customerId)
    .AsNoTracking()
    .ToListAsync(ct);
```

A raw query must be composable to be wrapped in LINQ, which means it has to be a plain `SELECT`; EF Core nests it as a subquery and appends your predicates and includes on top. If the query is a `SELECT` plus a set operation or a statement that returns no shape EF Core recognises, it will refuse to compose and you must run it as a scalar or keyless query instead.

### Keyless types for shapes that have no table

When the result is a report row or a scalar aggregate, you map an unmapped type and project through it. No key means no tracking and no change detection, so reads are cheap by construction.

```csharp
public sealed class OrderSummary
{
    public int CustomerId { get; set; }
    public decimal TotalSpend { get; set; }
}

var rows = await context.Database
    .SqlQuery<OrderSummary>($"SELECT customer_id AS \"CustomerId\", sum(total) AS \"TotalSpend\" FROM orders GROUP BY customer_id")
    .ToListAsync(ct);
```

## Table-valued functions with a database function

A table-valued function is a queryable source that takes parameters and returns a set, and EF Core maps it as a database function you can call from LINQ. You declare a static method that returns a queryable and register it in the model; the method body is never executed, it exists only as a signature the provider translates.

```csharp
public static IQueryable<OrderSummary> RecentOrders(AppDbContext ctx, DateOnly since)
    => throw new NotSupportedException();

protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    var method = typeof(AppDbContext).GetMethod(nameof(RecentOrders))!;
    modelBuilder.HasDbFunction(method)
        .HasName("recent_orders")
        .HasSchema("reporting");
}
```

Because the return value is a queryable, you can layer composition on top, so the function becomes one clause in a larger SQL statement rather than a round trip of its own. That is the main reason to prefer a table-valued function over a stored procedure for reporting: the database does the heavy lifting while EF Core keeps the predicates type-checked.

## Sharing one connection with Dapper

Dapper is not a competing data layer; it is a mapper. You hand it the same `DbConnection` EF Core uses and, importantly, the same transaction, so both tools see a consistent snapshot and the same commit boundary. Obtain the underlying connection and transaction rather than opening a second one, or the two will deadlock on locks the other cannot see.

```csharp
await using var connection = context.Database.GetDbConnection();
await using var tx = await context.Database.BeginTransactionAsync(ct);
var rows = await connection.QueryAsync<OrderRow>(
    new CommandDefinition(
        "SELECT id, total FROM orders WHERE tenant_id = @TenantId",
        new { TenantId = tenantId },
        tx.GetDbTransaction(),
        cancellationToken: ct));
await tx.CommitAsync(ct);
```

### Where Dapper earns its place

- Read-heavy projections with many joins, where Dapper's hand-written SQL is easier to read and to tune than the generated LINQ.
- Bulk reporting queries inside a background worker that never needs tracking or change detection.
- Legacy systems with views and stored procedures that predate the ORM and are not worth reproducing in LINQ.

## The traps of mixing

The temptation is to load a few tracked entities with EF Core, then run a raw `UPDATE` over the same rows with Dapper inside the same transaction. That is fine only if you clear the change tracker or never save the tracked copies, because the context still believes it owns the pre-update values and will write them back on the next save. Composable raw reads default to tracking, so annotate them as no-tracking unless you specifically want the entities in the graph, and remember that `ExecuteUpdateAsync` bypasses the tracker entirely, which is good for bulk writes and confusing for anyone expecting interceptors to fire.

The trade-off is maintenance load spread across two styles. Every Dapper query is SQL you own and must test against schema changes, while every LINQ query is portable and version-tolerant. Use raw SQL for the hot, irregular reads and keep the writes on the ORM, where tracking, concurrency tokens, and interceptors still protect you.
