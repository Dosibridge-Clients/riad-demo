---
title: "Value Objects as Owned Entities in EF Core"
slug: "efcore-value-objects-owned-entities"
excerpt: "Owned entities model value objects without a separate identity. Getting nullability and table splitting right is the difference between clean SQL and surprises."
category: "Data & EF Core"
tags: ["efcore", "value-objects", "owned-entities"]
date: "2026-06-02"
level: "Advanced"
author: "Riad"
---

A value object has no identity and is compared by its values, which is exactly what an owned entity models when you want it stored next to its owner. EF Core maps owned types into the owner's table by default, so a money value with an amount and a currency becomes two columns rather than a second table with a foreign key nobody needs. That default is convenient and occasionally wrong, and the difference is worth understanding before you commit a schema you cannot easily change.

## Mapping a value object with an owned reference

You tell the model that the value is part of the owner rather than a separate entity, then give the columns names that match the database conventions your team already uses. There is no primary key to declare, because the owned type borrows the owner's identity.

```csharp
public sealed record Money(decimal Amount, string Currency);

public sealed class Order
{
    public int Id { get; set; }
    public Money Total { get; set; } = new(0m, "GBP");
}

protected override void OnModelCreating(ModelBuilder modelBuilder)
{
    modelBuilder.Entity<Order>().OwnsOne(o => o.Total, money =>
    {
        money.Property(m => m.Amount).HasColumnName("total_amount").HasPrecision(18, 2);
        money.Property(m => m.Currency).HasColumnName("total_currency").HasMaxLength(3);
    });
}
```

Because the owned type lives in the owner's table, filtering and projecting on its columns is a normal SQL predicate. A query that compares the amount compiles to a column comparison, not to a join, which is the whole reason to prefer this shape over a navigation.

### Nullability and required owned types

EF Core 8 lets an owned reference be optional when the CLR property is nullable, and it materialises the value as null when every backing column is null. When the CLR property is non-nullable, EF Core treats the value as required and throws if the database returns a row whose owned columns are all null. That distinction matters during migration: a non-nullable value object added to an existing table needs a default for every existing row, or the first read of old data fails materialisation.

```csharp
modelBuilder.Entity<Order>()
    .Navigation(o => o.Total)
    .IsRequired();
```

## Owned collections and table splitting

An owned collection cannot be table-split because a single table cannot hold a variable number of rows per owner, so EF Core requires a separate table and a shadow foreign key back to the owner. Cascade delete is the default, and the collection is loaded as part of the aggregate.

```csharp
modelBuilder.Entity<Order>().OwnsMany(o => o.Lines, lines =>
{
    lines.ToTable("order_lines");
    lines.WithOwner().HasForeignKey("order_id");
    lines.Property(l => l.Sku).HasColumnName("sku").HasMaxLength(64);
    lines.HasKey("order_id", "LineNumber");
});
```

### When a separate entity is the better call

- The values are referenced from more than one aggregate, which implies they need their own identity.
- The data is queried independently of the owner, for example a report over all lines across orders.
- The value has a lifecycle longer than the owner, such as a rate card that must survive an order being archived.
- The collection is large and mostly untouched, so carrying it with every owner read is wasteful.

## Query behaviour and the aggregate boundary

Owned entities are always loaded with the owner because they are part of the aggregate; there is no lazy loading of a value object, and there is no way to partially load one. When an owner has several owned collections, a single query produces a cartesian explosion across the joins, so splitting the query is often the right move.

```csharp
var orders = await context.Orders
    .Include(o => o.Lines)
    .AsSplitQuery()
    .TagWith("LoadOrderAggregate")
    .ToListAsync(ct);
```

The projection and filtering story is clean: predicates on owned columns are inlined, and projection can select a single owned property without a join. What you lose is independence. You cannot reference one owned instance from two owners, you cannot give it a foreign key of its own, and a change to the value object is a change to the owner's row, which means optimistic concurrency tokens move together and updates touch the parent table.

The trade-off is that the owner's table widens with every value object you inline, and a heavily normalised model may end up fighting the happy path. The rule I use is simple: if the value is always read with its owner, has no identity, and is never shared, make it owned. The moment any of those three stops being true, promote it to a full entity and pay for the join.
