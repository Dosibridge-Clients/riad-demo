---
title: "Custom Model Binding and Validation in ASP.NET Core"
slug: "custom-model-binding-validation"
excerpt: "DataAnnotations and FromBody cover the common cases. Custom binders and validation filters handle the rest, but they come with real costs in clarity and debugging."
category: "ASP.NET Core"
tags: ["model-binding", "validation", "filters"]
date: "2026-09-18"
level: "Advanced"
author: "Riad Hossain"
---

Model binding exists so that action parameters and minimal-endpoint arguments arrive populated from the request without you touching `HttpContext`. Most of the time the built-in sources and `DataAnnotations` are enough. The interesting problems start when a value spans several inputs, arrives in a non-standard format, or needs validation that depends on the rest of the model.

## Binding sources

For controllers, `IModelBinder` and `IModelBinderProvider` let you teach the MVC binder about a new type, and `[ModelBinder]` points a specific parameter at your implementation. Minimal APIs take a different route: a type can describe its own parsing by implementing `IParsable<T>`, or provide a static `BindAsync` method. This is the idiomatic way to bind a compound value without a custom binder provider.

### Implementing BindAsync

```csharp
public sealed record DateRange(DateTime From, DateTime To)
{
    public static ValueTask<DateRange?> BindAsync(HttpContext context)
    {
        var query = context.Request.Query;
        if (!DateTime.TryParse(query["from"], out var from) ||
            !DateTime.TryParse(query["to"], out var to) ||
            from > to)
        {
            return ValueTask.FromResult<DateRange?>(null);
        }

        return ValueTask.FromResult<DateRange?>(new DateRange(from, to));
    }
}
```

The framework calls `BindAsync` before invoking the endpoint and treats a null result as a binding failure. That is your hook to reject malformed input consistently.

## Validation beyond DataAnnotations

`DataAnnotations` are declarative and cheap but limited to attribute-decorated members, which rules out cross-field rules and async checks. Three tools cover the gaps:

- `IValidatableObject` on the model, for rules that compare two properties and do not need I/O.
- A custom `ValidationAttribute` when you want a reusable declarative check with a clear message.
- A dedicated validator library wired through an endpoint filter or a controller action filter when validation is complex or must hit a database.

For minimal APIs, an endpoint filter is the natural home for the last category, because it can short-circuit before the handler and shape a problem-details response:

```csharp
public sealed class BookingValidator : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(
        EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        if (context.Arguments.OfType<BookingRequest>().FirstOrDefault() is not { } request)
        {
            return TypedResults.BadRequest("Missing booking payload");
        }

        var errors = new Dictionary<string, string[]>();
        if (request.End <= request.Start)
        {
            errors["end"] = ["End must be after start"];
        }
        if (errors.Count > 0)
        {
            return TypedResults.ValidationProblem(errors);
        }

        return await next(context);
    }
}
```

### Where validation belongs

Keep parsing in the binder and syntactic validation in the validator. Business rules that depend on current state belong in the domain service, not in an attribute. Pushing everything into binding couples your transport layer to persisted state and makes the rules hard to test.

Reflection-based validation has a performance cost on hot paths, because each attribute is invoked per request. If a validated type sits on the critical path, measure before optimising, then consider a hand-written check in an endpoint filter for the hottest cases. Do not, however, move validation into the binder to save cycles; that couples parsing and rules and makes both harder to reason about.

## The trade-off

Custom binders are powerful, but they are invisible: a reader of the endpoint has no idea what happens before the handler runs, which makes behaviour hard to trace. Prefer an explicit `TryParse`-style record with `BindAsync` over a provider-level binder, and prefer an endpoint filter over an action-filter attribute when the logic is not reusable. The gain in expressiveness is real; the cost in opacity is real too, so keep custom binding to types you bind in many places.
