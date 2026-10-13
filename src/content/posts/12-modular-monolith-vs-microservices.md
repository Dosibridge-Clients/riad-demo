---
title: "Modular Monolith vs Microservices for .NET Teams"
slug: "modular-monolith-vs-microservices"
excerpt: "Microservices are often adopted for org reasons rather than technical ones. Compare a modular monolith and a distributed system on .NET, and pick deliberately."
category: "Architecture"
tags: ["architecture", "monolith", "microservices"]
date: "2026-08-07"
level: "Advanced"
author: "Riad Hossain"
---

Microservices are usually chosen for the wrong reason. A team of twelve engineers with a single deployable and one on-call rotation renames its folders to "services", adds a message broker, and discovers six months later that every feature still requires a coordinated deploy of five artifacts. That outcome has a name: the distributed monolith. It has all the operational cost of microservices and none of the autonomy, because the boundaries were drawn along technical layers rather than business capabilities.

## Why monoliths become microservices by accident

The trigger is almost never latency or scale. It is organisational: two teams want to release independently, or a platform mandate decides "cloud native". Splitting a codebase cannot fix a coupling that lives in the domain model. If `Order` and `Invoice` share a transaction and a table today, moving them into two processes turns a method call into a network call with partial failure, and the team inherits the distributed transaction problem they were trying to avoid.

## What a modular monolith actually buys you

A modular monolith keeps one process, one deploy, and one database, but enforces internal boundaries as strictly as if they were network boundaries. Each module owns its tables, exposes a public contract, and never reaches into another module's internals. Because the boundary is in-process, a violation is a compile error or a failing test rather than a silent remote call.

### Enforcing boundaries with the compiler

You can make the compiler your architecture reviewer. Give each module its own project and a public interface, and keep the implementation types `internal`. An architecture test then asserts that no module references another module's domain types directly.

```csharp
public interface IModule
{
    void RegisterServices(IServiceCollection services, IConfiguration config);
}

public sealed class OrdersModule : IModule
{
    public void RegisterServices(IServiceCollection services, IConfiguration config)
    {
        services.AddDbContext<OrdersDbContext>(o => o.UseNpgsql(config.GetConnectionString("Orders")));
        services.AddScoped<IOrderService, OrderService>();
    }
}

var modules = typeof(Program).Assembly
    .GetTypes()
    .Where(t => typeof(IModule).IsAssignableFrom(t) && t is { IsAbstract: false, IsInterface: false })
    .Select(t => (IModule)Activator.CreateInstance(t)!);

foreach (var module in modules)
{
    module.RegisterServices(builder.Services, builder.Configuration);
}
```

The rule that keeps this honest is that modules communicate only through their published contracts or through integration events dispatched in-process. No shared `Domain` project that everything references.

## When microservices are genuinely the right answer

- Independent scaling: one workload is orders of magnitude hotter than the rest.
- Independent release cadence: teams with a real organisational boundary and separate on-call.
- Isolated failure domains: a runaway process must not take down the whole product.
- Heterogeneous technology: a Python ML service genuinely cannot live in the .NET process.
- Data residency or regulatory isolation that forces physical separation.

If none of these apply, you are paying for distribution without buying autonomy.

## A migration path that does not rewrite everything

Extract a module into a service only when its boundary is already clean inside the monolith. Because the module talks over a contract, replacing the in-process implementation with an HTTP or messaging adapter is a swap behind the same interface. The database split is the hard part and should happen last, one table group at a time.

## The trade-off

The modular monolith defers the operational cost of distribution, not the design discipline. You still have to enforce boundaries, and nothing in the runtime stops a developer from referencing another module's internals. Microservices enforce boundaries with the network, at the price of latency, partial failure, distributed tracing and eventual consistency. Choose the model whose pain you can staff, and do not let a folder rename make the decision for you.
