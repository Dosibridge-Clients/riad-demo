---
title: "Multi-Tenancy Strategies in ASP.NET Core"
slug: "multi-tenancy-strategies"
excerpt: "Tenant resolution and data isolation are separate problems. Choose shared schema, shared database or database-per-tenant with a clear operational trade-off."
category: "Architecture"
tags: ["multi-tenancy", "saas", "data-isolation"]
date: "2026-07-14"
level: "Advanced"
author: "Riad Hossain"
---

The leak that ends careers is a tenant that reads another tenant's data because the request never resolved a tenant and every resolver fell back to a default. It does not throw, it does not log an error, and it passes every test where a tenant is always present. Multi-tenancy has two independent problems hiding under one name: how you identify the tenant on a request, and how you isolate its data. Solve them separately or you will solve neither.

## Resolving the tenant per request

Tenant resolution turns something on the request into a tenant identifier. The three common sources have very different properties. A subdomain or custom host header is good for public SaaS. A path prefix is explicit and cache-friendly. A JWT claim is the strongest signal when the token is issued per tenant, because a caller cannot forge it. Never trust a free-form header on a public endpoint without confirming the caller is a member of that tenant.

### Resolution order and the missing-tenant failure

Resolve in a fixed order and fail closed. If no strategy yields a tenant, throw before any query runs. A middleware that resolves the tenant and stores it in a scoped accessor is the standard shape; everything downstream reads the accessor, never the raw request.

## Isolation strategies and their costs

- Shared database, shared schema: every row carries a tenant identifier, enforced by global query filters. Cheapest to operate, highest blast radius if a filter is missed.
- Shared database, schema per tenant: physical separation inside one instance, moderate operational cost, connection routing per request.
- Database per tenant: strongest isolation and per-tenant backup and restore, but migrations must run across every tenant and connection pooling explodes.
- Database per region, schema per tenant: a common hybrid when data residency is a hard requirement.

## A tenant-scoped accessor

Whatever the storage model, inject a scoped current-tenant accessor into the `DbContext` and the write path. The accessor exposes the active tenant and a `Change` method for background jobs that need to act on behalf of a specific tenant.

```csharp
public interface ICurrentTenant
{
    Guid? Id { get; }
    bool IsAvailable { get; }
    IDisposable Change(Guid? id);
}

public sealed class TenantMiddleware
{
    private readonly ITenantResolver _resolver;
    private readonly ICurrentTenant _current;
    private readonly RequestDelegate _next;

    public TenantMiddleware(ITenantResolver resolver, ICurrentTenant current, RequestDelegate next)
        => (_resolver, _current, _next) = (resolver, current, next);

    public async Task InvokeAsync(HttpContext context)
    {
        var tenant = await _resolver.ResolveAsync(context);
        if (tenant is null)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }
        using var scope = _current.Change(tenant.Id);
        await _next(context);
    }
}
```

Background workers and hosted services start with no ambient tenant, so they must wrap their unit of work in a `Change` call explicitly. Forgetting this is the second most common leak.

## The trade-off

Every step up in isolation costs operational effort. Shared-schema is a single migration and one missing `WHERE` clause away from a cross-tenant incident; database-per-tenant is safe but multiplies your backup, migration and connection-management burden by the tenant count. Start with shared schema plus query filters plus a write-path guard, and only move a tenant to its own database when a contract, a regulator or a noisy-neighbour problem demands it.
