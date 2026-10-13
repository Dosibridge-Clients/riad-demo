---
title: "Dependency Injection Lifetimes and the Captive Dependency Trap"
slug: "di-lifetimes-captive-dependency"
excerpt: "A captive dependency is a long-lived service holding a short-lived one. Register a singleton that depends on a scoped DbContext and you leak state across requests."
category: "ASP.NET Core"
tags: ["dependency-injection", "lifetimes", "captive-dependency"]
date: "2026-10-06"
level: "Advanced"
author: "Riad"
---

A captive dependency is a service with a longer lifetime holding a reference to one with a shorter lifetime. The classic instance is a singleton that takes a scoped `DbContext` in its constructor. The container allows it, the code runs, and then you spend a week chasing stale entities and cross-request data bleed.

## The three lifetimes

Singleton instances live in the root provider for the life of the process. Scoped instances live in a provider scope, which for ASP.NET Core is one per request. Transient instances are created on every resolution and disposed with their owner. The trap is entirely about what happens when a longer-lived provider resolves a shorter-lived service.

### Scope validation

The built-in container detects the mistake only when validation is enabled. `WebApplicationBuilder` turns it on in the Development environment, and you can force it everywhere:

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Host.UseDefaultServiceProvider(options =>
{
    options.ValidateScopes = true;
    options.ValidateOnBuild = true;
});
```

With `ValidateScopes` on, resolving the singleton throws `InvalidOperationException: Cannot consume scoped service 'AppDbContext' from singleton 'ReportCache'`. With it off in production, the singleton captures whichever `DbContext` happened to be resolved first and reuses it forever.

## The mechanism

Scoped registrations resolve from the current `IServiceScope`. The root provider has no scope of its own, so when a singleton is constructed it captures the scoped instance from the root scope. That instance is disposed when the root provider is disposed, meaning never during the process lifetime. A tracked entity graph grows without bound and the same `DbContext` instance is shared by every thread that touches the singleton.

## The fix

Do not inject the scoped service into the singleton. Inject the factory and open a scope per unit of work:

```csharp
public sealed class ReportCache(IServiceScopeFactory factory)
{
    public async Task<Report> LoadAsync(int id, CancellationToken ct)
    {
        await using var scope = factory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Reports.AsNoTracking().SingleAsync(r => r.Id == id, ct);
    }
}
```

For EF Core specifically, `IDbContextFactory<AppDbContext>` is the cleaner dependency when you only create and dispose contexts. Register it with `AddDbContextFactory<T>` and call `CreateDbContextAsync` directly.

One subtlety is `AddDbContextPool<AppDbContext>`, which pools context instances instead of allocating a fresh one per scope. The lifetime is still scoped and the captured-dependency rules are unchanged, but a context returned to the pool must be fully reset, so a singleton that captured it would corrupt every subsequent borrower rather than merely leaking memory. If you cannot enable scope validation in production for performance reasons, at minimum enable it in every non-production environment and add a test that resolves every registered singleton from the root provider, which fails the build whenever someone introduces a captive reference.

## The trade-off

Opening a scope per operation is slightly more verbose and allocates a scope object, but it gives you a fresh, correctly-disposed `DbContext` and honest lifetime boundaries. The alternative, making everything scoped, forces the singleton to become scoped too and often breaks hosted services and caches that legitimately live for the process. The rule to hold onto is simple: a service may depend only on services with an equal or longer lifetime.
