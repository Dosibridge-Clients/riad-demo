---
title: "EF Core Interceptors for Auditing and Soft Deletes"
slug: "efcore-interceptors-auditing"
excerpt: "Interceptors run inside the save pipeline, so auditing and soft deletes cannot be bypassed by callers. The cost is that a bug there becomes systemic."
category: "Data & EF Core"
tags: ["efcore", "interceptors", "auditing"]
date: "2026-06-14"
level: "Advanced"
author: "Riad Hossain"
---

Auditing columns written by hand inside every service method drift apart within a quarter. One team sets the update timestamp on the interactive save path, another forgets it during the nightly import, and the soft-delete flag is present in some tables and missing in the rest. EF Core interceptors close that gap because they execute inside the save pipeline itself, at a point no caller can skip. The price is that the interceptor becomes part of your persistence contract, so a defect there is systemic instead of local.

## Where interceptors sit in the save pipeline

EF Core exposes the save lifecycle through `ISaveChangesInterceptor`, registered on the options builder alongside the provider. Before any command is generated the context invokes `SavingChangesAsync`; after a successful round trip it invokes `SavedChangesAsync`; when the command fails it invokes `SaveChangesFailedAsync`. Every callback receives the live context, so you can walk `ChangeTracker.Entries()` and rewrite state before the batch is built. This is the only hook that observes every tracked entity regardless of which repository, import job, or endpoint started the write, and it does so without the application code opting in.

### Auditing through the change tracker

The interceptor below stamps creation and update timestamps and takes the clock as a constructor dependency rather than calling the static wall clock, so tests can advance time deterministically and server skew stays visible.

```csharp
public sealed class AuditInterceptor(TimeProvider clock) : SaveChangesInterceptor
{
    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData,
        InterceptionResult<int> result,
        CancellationToken cancellationToken = default)
    {
        var context = eventData.Context;
        if (context is null)
            return base.SavingChangesAsync(eventData, result, cancellationToken);

        var now = clock.GetUtcNow();
        foreach (var entry in context.ChangeTracker.Entries<IAuditable>())
        {
            if (entry.State == EntityState.Added)
                entry.Entity.CreatedAt = now;
            if (entry.State is EntityState.Added or EntityState.Modified)
                entry.Entity.UpdatedAt = now;
        }

        return base.SavingChangesAsync(eventData, result, cancellationToken);
    }
}
```

The generic overload `Entries<IAuditable>()` filters by interface, so the loop never checks entity types by hand. The interceptor mutates tracked entities rather than issuing SQL, which means the change is picked up by the very same save operation and lands in one batch.

## Soft deletes without leaking deleted rows

A soft delete is a state transition, not a deletion. The interceptor rewrites the entry state from deleted to modified and sets a flag, so the row survives while the application treats it as gone. The dangerous half is reading: nothing stops a query returning soft-deleted rows unless you add a global query filter and a matching index predicate.

```csharp
protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    modelBuilder.Entity<Order>().HasQueryFilter(o => !o.IsDeleted);
    modelBuilder.Entity<Order>()
        .HasIndex(o => new { o.TenantId, o.Number })
        .HasFilter("is_deleted = false")
        .IsUnique();
}
```

The filter is applied to every query EF Core builds for that entity, including includes and navigations, but it is bypassed by `IgnoreQueryFilters()` and it is not applied at all to `FromSqlRaw` results unless EF can see the entity type. Treat that as a feature for admin screens and a hazard for reporting queries that quietly disagree with the application.

### The traps worth knowing

- A query filter that references a navigation can silently exclude the owner when the related row is itself filtered, most often with required navigations.
- A filtered unique index must match the filter predicate, or the database rejects the second soft-deleted row that reuses a business key.
- `ExecuteUpdateAsync` and `ExecuteDeleteAsync` bypass the change tracker entirely, so no interceptor runs and no timestamp is stamped.
- A soft delete issued through `ExecuteDeleteAsync` hard-deletes the row and skips the interceptor, which is precisely the bug you will chase at midnight.

## Registering and scoping the interceptor

Resolve the interceptor from the container so it receives the same clock the rest of the application uses, then attach it through the options callback.

```csharp
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddScoped<AuditInterceptor>();
builder.Services.AddDbContext<AppDbContext>((sp, options) =>
    options.UseNpgsql(sp.GetRequiredService<DbDataSource>())
           .AddInterceptors(sp.GetRequiredService<AuditInterceptor>()));
```

The trade-off is honest and worth stating plainly: an interceptor hides behaviour from the call site. A developer reading a repository method cannot tell that timestamps are rewritten or that deletes are really updates. Document it, keep the logic small, and test it against a real provider rather than the in-memory database, which generates no SQL and therefore never exercises filters, indexes, or state rewriting.
