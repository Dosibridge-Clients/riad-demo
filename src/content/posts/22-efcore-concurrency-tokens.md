---
title: "Optimistic and Pessimistic Concurrency in EF Core"
slug: "efcore-concurrency-tokens"
excerpt: "Row versions give optimistic concurrency and row locks give pessimistic. Picking the wrong one either loses updates silently or pins connections under load."
category: "Data & EF Core"
tags: ["efcore", "concurrency", "transactions"]
date: "2026-06-08"
level: "Advanced"
author: "Riad Hossain"
---

Two operators open the same invoice, both edit it, and both save within a second. Without concurrency control the second write overwrites the first and nobody notices until reconciliation. EF Core supports both the optimistic and the pessimistic answer, and the choice is not stylistic: it decides whether you lose data quietly under load or hold row locks and contend for connections instead.

## Optimistic concurrency with a row version

The optimistic model lets every reader proceed and validates at write time. You mark a property as a concurrency token, and EF Core appends it to the predicate of the update, emitting something equivalent to a conditional update that compares the stored token with the value the entity was loaded with. If the row changed underneath, zero rows match, the provider reports fewer affected rows than expected, and EF Core throws `DbUpdateConcurrencyException`.

```csharp
public sealed class Invoice
{
    public int Id { get; set; }
    public decimal Total { get; set; }

    [Timestamp]
    public byte[]? RowVersion { get; set; }
}

protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    modelBuilder.Entity<Invoice>()
        .Property(i => i.RowVersion)
        .IsRowVersion();
}
```

The exception is not the end of the story; it is the point where you decide what the user meant. The idiomatic recovery reads the current database values, resets the original values to match, and saves again.

```csharp
try
{
    await context.SaveChangesAsync(ct);
}
catch (DbUpdateConcurrencyException ex)
{
    var entry = ex.Entries.Single();
    var databaseValues = await entry.GetDatabaseValuesAsync(ct);
    if (databaseValues is null)
        throw; // the row was deleted by someone else
    entry.OriginalValues.SetValues(databaseValues);
    await context.SaveChangesAsync(ct);
}
```

### Row versions on PostgreSQL

SQL Server has a native rowversion column and the attribute above just works. PostgreSQL has no identical type, so the Npgsql provider exposes the system transaction identifier as a mapped concurrency token instead. You declare a shadow property mapped to the system column and mark it as a row version, and the provider uses it in the same conditional update.

```csharp
modelBuilder.Entity<Invoice>()
    .Property<uint>("xmin")
    .IsRowVersion();
```

Because the token is a system column, it needs no schema migration of its own, but it does mean the token is tied to the physical row and should never be surfaced to clients.

## Pessimistic concurrency with row locks

Sometimes you genuinely need to serialise access, for example when a balance must be checked and decremented atomically without retries. EF Core has no first-class locking operator, so you drop to raw SQL and lock the row for the duration of the transaction. The lock is held until commit, so the transaction must be short and every code path that touches the row must acquire it in the same order to avoid deadlock.

```csharp
await using var tx = await context.Database.BeginTransactionAsync(ct);
var invoice = await context.Invoices
    .FromSqlRaw("SELECT * FROM invoices WHERE id = {0} FOR UPDATE", id)
    .SingleAsync(ct);

invoice.Total -= credit;
await context.SaveChangesAsync(ct);
await tx.CommitAsync(ct);
```

### Retries and user transactions

When retry-on-failure is enabled, EF Core detects transient errors and replays the operation, but it refuses to wrap a user-initiated transaction automatically and throws instead. The correct pattern is to submit the whole transaction to the execution strategy so the retry replays it as a unit.

```csharp
var strategy = context.Database.CreateExecutionStrategy();
await strategy.ExecuteAsync(async () =>
{
    await using var tx = await context.Database.BeginTransactionAsync(ct);
    await ApplyCreditAsync(context, id, credit, ct);
    await tx.CommitAsync(ct);
});
```

The provider supplies `NpgsqlRetryingExecutionStrategy` for PostgreSQL and an equivalent for SQL Server, and both honour the transient detection list you configure.

## Choosing between them

- Optimistic concurrency for read-mostly data, web edits, and any row that many users read and few write.
- Pessimistic concurrency for invariants that must be enforced under contention, such as stock reservation or money movement.
- Bounded retries for optimistic writes, because a lost race should refresh and retry rather than fail the request.
- Strict lock ordering and short transactions for pessimistic writes, because a lock held across an outbound HTTP call will stall every other writer.

The trade-off is direct. Optimistic tokens add a column or a system reference and hand conflict resolution to the application, which must decide whether to merge, overwrite, or surface a conflict to the user. Pessimistic locks keep the logic simple but convert contention into queueing, and a single long transaction can pin a database connection and cascade latency into unrelated endpoints. Measure contention before choosing, and prefer optimistic control until the metric says otherwise.
