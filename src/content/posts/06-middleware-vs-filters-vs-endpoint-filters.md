---
title: "Middleware, Filters and Endpoint Filters: Where Logic Belongs"
slug: "middleware-vs-filters-vs-endpoint-filters"
excerpt: "Middleware, MVC filters and endpoint filters are three extension points at three pipeline stages. Pick the wrong one and your logic runs at the wrong time or not at all."
category: "ASP.NET Core"
tags: ["middleware", "filters", "endpoint-filters"]
date: "2026-09-12"
level: "Advanced"
author: "Riad"
---

Three extension points, one recurring question: at which stage of the request does this logic belong? Middleware wraps everything. MVC filters run inside the action pipeline. Endpoint filters wrap a single endpoint delegate. They overlap enough that teams pick the wrong one and only discover it when the logic cannot see the data it needs.

## Middleware: transport and cross-cutting

Middleware sits in the raw `HttpContext` pipeline, before and after routing. It sees the request as bytes and headers, not as a typed action argument, and it cannot read endpoint metadata until routing has run. That makes it the right home for concerns that are agnostic to the endpoint: correlation identifiers, request logging, response compression, header enrichment, and global rate limiting. It is cheap, it runs once, and it composes by position.

## MVC filters: the action lifecycle

Filters run inside MVC and therefore have access to `ActionExecutingContext`, the bound model, the action descriptor and the result being returned. Authorization filters, resource filters, action filters, exception filters and result filters each sit at a defined point around the action. They are the right tool for validating a bound model, transforming an action result, or mapping a domain exception to a status code at the action boundary. They are useless for minimal APIs because there is no action to filter.

### Endpoint filters: one delegate

`IEndpointFilter` wraps the endpoint's delegate and receives an `EndpointFilterInvocationContext` carrying the resolved arguments. It works for minimal APIs and, since .NET 8, for controllers mapped as endpoints too, which makes it the unifying extension point. It can inspect arguments, short-circuit, and decorate the result.

```csharp
public sealed class TenantFilter(ITenantResolver resolver) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var header = context.HttpContext.Request.Headers["X-Tenant"];
        if (string.IsNullOrWhiteSpace(header))
        {
            return TypedResults.Problem(statusCode: 400, title: "Tenant header required");
        }

        context.HttpContext.Items["tenant"] = await resolver.ResolveAsync(header!);
        return await next(context);
    }
}
```

Attach it with `MapGroup(...).AddEndpointFilter<TenantFilter>()` to cover a whole surface in one registration.

## Choosing between them

- Correlation id, compression, security headers, global throttling: middleware. It must run even for requests that never reach an endpoint.
- Model validation, result shaping, action-level exception translation in an MVC app: filters.
- Per-endpoint or per-group behaviour in a minimal API, or anything that needs typed arguments: endpoint filters.

## The trade-off

Middleware is broad and cheap but blind to endpoint metadata and typed arguments. MVC filters are precise and lifecycle-aware but tie the logic to the controller model. Endpoint filters unify both styles but only run after the endpoint delegate has been selected, so they cannot influence routing or handle a request that fails to match, and they do not see model-binding failures the way an MVC action filter does. The useful heuristic is to ask what the logic needs to know; the answer tells you how far down the pipeline it must sit. A second rule is to put the logic in the layer that can be tested most cheaply: cross-cutting middleware is awkward to test in isolation, whereas an endpoint filter is a plain class you can invoke directly with a fabricated context.
