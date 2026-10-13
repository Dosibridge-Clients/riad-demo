---
title: "Global Query Filters for Tenant Isolation in EF Core"
slug: "global-query-filters-multitenancy"
excerpt: "Global query filters enforce tenant isolation in EF Core, but raw SQL and IgnoreQueryFilters bypass them. Wire the filter and the write path together."
category: "Data & EF Core"
tags: ["efcore", "query-filters", "multi-tenancy"]
date: "2026-07-08"
level: "Advanced"
author: "Riad Hossain"
---

Global query filters are the closest thing EF Core has to a safety net for multi-tenancy, and they are exactly as strong as the developer who remembers them. A filter configured once on the model is appended to every LINQ query on that entity — until someone writes `FromSql`, calls `IgnoreQueryFilters`, or drops to a raw database command. The filter is a convenience, not a security boundary, and treating it as one is how tenants end up sharing rows.

## Wiring the filter to the request

The filter is a deterministic expression the model stores and EF Core composes into each query. It must reference no nondeterministic state that changes per row, so the usual approach is a scoped service, an injected tenant accessor closed over by the lambda at model-building time. Because the model is cached per context type per service provider, the filter must read the tenant through a service, not capture it as a constant.

```csharp
public sealed class AppDbContext : DbContext
{
    private readonly ICurrentTenant _tenant;

    public AppDbContext(DbContextOptions<AppDbContext> options, ICurrentTenant tenant)
        : base(options) => _tenant = tenant;

    public DbSet<Order> Orders => Set<Order>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Order>().HasQueryFilter(o => o.TenantId == _tenant.Id);
        modelBuilder.Entity<Order>().Property(o => o.RowVersion).IsRowVersion();
    }
}
```

### Where filters do not apply

Filters are composed into LINQ translation, so they vanish the moment you bypass LINQ. `IgnoreQueryFilters` removes them deliberately. `FromSql` and `FromSqlRaw` build a query from raw SQL and are not filtered unless you append your own predicate and use the composable `FromSql` overload. Raw ADO commands and `ExecuteUpdateAsync` or `ExecuteDeleteAsync` operate outside query translation entirely.

Treat every raw SQL path as a place to re-derive the tenant explicitly and to add a test that proves the predicate is present. A filter you cannot see in the generated query is a filter you will eventually forget you bypassed, and the rows it fails to hide are another customer's.

## Guarding the write path

A filter protects reads; it does nothing for inserts. Stamp the tenant on every added entity in `SavingChangesAsync` on an interceptor or in an override of `SaveChangesAsync`, and reject any entity whose value does not match the current tenant. Without this, a buggy or compromised handler can write a row into another tenant's partition, where your filter will then helpfully hide it from everyone.

```csharp
foreach (var entry in ChangeTracker.Entries<ITenantOwned>()
    .Where(e => e.State == EntityState.Added))
{
    if (entry.Entity.TenantId != _tenant.Id)
        throw new InvalidOperationException("Cross-tenant write rejected.");

    entry.Entity.TenantId = _tenant.Id!.Value;
}
```

## Rules that keep it safe

- Prefer shared-schema with filters plus a write guard over disabling filters anywhere.
- Ban `IgnoreQueryFilters` outside admin tooling, and review every use.
- Wrap raw SQL in composable `FromSql` and re-apply the tenant predicate by hand.
- Add an integration test that authenticates as tenant A and asserts tenant B's row is invisible.
- Never resolve the tenant inside the filter from an HTTP context that may be absent in a background job.

## The trade-off

Filters are ergonomic and repeat every query automatically, but they are invisible at the call site: a query returns less than the reader expects for reasons that live in `OnModelCreating`. They also interact badly with `Include` on optional relationships and can force inner-join-style behaviour you did not request. Keep the filter as defence in depth, keep the write guard as the real boundary, and never let a single oversight decide whether two customers share data.
