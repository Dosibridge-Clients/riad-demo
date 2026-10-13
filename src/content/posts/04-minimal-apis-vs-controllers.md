---
title: "Minimal APIs vs Controllers: Choosing an API Style That Scales"
slug: "minimal-apis-vs-controllers"
excerpt: "Minimal APIs and controllers are different plumbing, not just style. Here is where each one wins and the conventions you silently give up by choosing."
category: "ASP.NET Core"
tags: ["minimal-apis", "controllers", "api-design"]
date: "2026-09-24"
level: "Advanced"
author: "Riad Hossain"
---

The choice between minimal APIs and controllers is usually framed as taste. It is not. They run through different request plumbing, expose different extension points, and impose different constraints on trimming and ahead-of-time compilation. Pick one, and you inherit its model-binding rules, its filter chain and its conventions.

## What controllers buy you

Controllers bring the full MVC machinery. Model binding works from route, query, header, form and body with attributes to disambiguate. Content negotiation goes through the configured output formatters, so XML or a custom formatter is a registration away. The `[ApiController]` attribute enables automatic 400 responses for invalid models, binding-source inference and problem-details error shaping. `IActionResult` and `ApiExplorer` give you a mature story for OpenAPI generation and a large ecosystem of action filters and conventions.

## What minimal APIs give you

Minimal APIs map a delegate directly to a route, skipping the controller activator and the action-invocation pipeline. The per-request overhead is lower and the allocation profile is leaner, which matters when a single endpoint fans out to many services. They are the better citizen for `NativeAOT` and full trimming: with a source-generated `JsonSerializerContext`, the request-delegate path avoids reflection. `TypedResults` gives you strongly typed responses that double as OpenAPI metadata.

### The gap that surprises teams

The `[ApiController]` conveniences are not present by default. A minimal endpoint will happily run your handler with an invalid body unless you validate explicitly. You add that back with an endpoint filter or with explicit checks that return `TypedResults.ValidationProblem`.

```csharp
var products = app.MapGroup("/products")
    .WithTags("Products")
    .AddEndpointFilter(async (ctx, next) =>
    {
        if (ctx.Arguments.OfType<CreateProduct>().FirstOrDefault() is { Name.Length: 0 })
        {
            return TypedResults.ValidationProblem(new Dictionary<string, string[]>
            {
                ["name"] = ["Name is required"],
            });
        }
        return await next(ctx);
    });

products.MapPost("/", async (CreateProduct input, IProductService svc, CancellationToken ct) =>
{
    var created = await svc.CreateAsync(input, ct);
    return TypedResults.Created($"/products/{created.Id}", created);
});
```

Groups keep tags, filters and route prefixes in one place, which recovers some of the controller's organisational ergonomics.

For OpenAPI, controllers get a descriptive contract for free through `ApiExplorer`, while minimal APIs build the document from the delegate signature plus `.WithName`, `.Produces<T>` and `.ProducesProblem`. That metadata is not cosmetic; it drives generated clients and request validation in downstream services. On the testing side, minimal endpoints are trivial to exercise through `WebApplicationFactory` with a lightweight host, whereas controllers let you unit-test an action method in isolation. Route groups and `WithOpenApi` close much of the ergonomic gap, but they do not recreate the filter ecosystem. That ecosystem matters most when many endpoints share authorisation, validation or result-shaping rules, because controllers express those rules once as attributes and conventions rather than repeating the call on every mapping.

## Where the trade-off lands

Controllers win when you need rich binding, formatters, conventions, or a team already fluent in the filter ecosystem. Minimal APIs win on throughput, AOT, and small surfaces where the ceremony of a controller class is pure overhead. The pragmatic answer is often both: minimal APIs for high-volume, thin endpoints and controllers for complex CRUD with heavy conventions. What you should not do is choose minimal APIs for AOT and then pull in reflection-heavy libraries that defeat trimming anyway.
