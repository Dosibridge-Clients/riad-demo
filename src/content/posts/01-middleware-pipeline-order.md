---
title: "Middleware Pipeline Ordering in ASP.NET Core: Why Sequence Is Behaviour"
slug: "middleware-pipeline-order"
excerpt: "Middleware in ASP.NET Core forms a nested closure chain, so the position of each registration silently decides short-circuiting, exception handling and header emission."
category: "ASP.NET Core"
tags: ["middleware", "request-pipeline", "aspnetcore"]
date: "2026-10-12"
level: "Advanced"
author: "Riad"
---

In ASP.NET Core the request pipeline is not a fan-out of independent hooks. Every `Use`-style call wraps the next delegate in a closure, so the position of a line in `Program.cs` decides which middleware can short-circuit the request, which one observes an exception, and whether a header ever reaches the response. Reordering two calls is a behaviour change, not a cosmetic one.

## The pipeline is nested closures

When you register middleware you are building a linked list of `RequestDelegate` instances. Each middleware receives a reference to `next`, and calling `await next(context)` descends toward the terminal endpoint, while the code after that await runs on the way back up. That symmetry is the most important mental model, because everything the pipeline does follows from it. A terminal middleware that never calls `next` truncates the chain, and a middleware that mutates `HttpResponse` after `await next` is decorating whatever the inner chain produced.

```csharp
var builder = WebApplication.CreateBuilder(args);
builder.Services.AddAuthentication().AddJwtBearer();
builder.Services.AddAuthorization();
builder.Services.AddControllers();

var app = builder.Build();

app.UseExceptionHandler("/error");
app.UseHttpsRedirection();
app.UseStaticFiles();
app.UseRouting();
app.UseCors("spa");
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.Run();
```

## Why each slot is where it is

- `UseExceptionHandler` sits first so it wraps the whole terminal chain. Put anything above it and that middleware's own exceptions escape unhandled.
- `UseStaticFiles` runs before `UseRouting` because static assets never need route matching or authorization, and skipping the router for them buys throughput for free.
- `UseCors` must sit between `UseRouting` and `UseAuthorization`. The CORS middleware needs endpoint metadata to pick the policy an endpoint declared through `RequireCors`, and it must emit preflight responses before authorization rejects the request with a 401.

### Authentication before authorization

`UseAuthentication` populates `HttpContext.User` by running the registered schemes. `UseAuthorization` reads that principal to evaluate policies. Swap them and authorization sees an empty, unauthenticated `User`, so every `[Authorize]` endpoint returns 401 even with a perfectly valid token. Neither middleware is broken; the second is reading state that nobody has filled in yet.

## Reproducing the failure

The most common production symptom is a CORS preflight that returns 401. Inspect the order and you will usually find `UseAuthorization` registered before `UseCors`, or `UseCors` placed ahead of `UseRouting` so it cannot resolve the endpoint's policy. Because the response already carries a status code by the time the request unwinds, appending headers further down the chain cannot repair it.

A fast diagnostic is to log the ordered list of middleware descriptors at startup, or to set a breakpoint in the terminal endpoint and read the call stack, which exposes the wrapping order directly. Then treat each ordering invariant you care about as an assertion: a preflight returns 204, an anonymous call to a protected route returns 401, and a thrown exception is rendered as a problem-details body rather than a raw stack trace.

## The trade-off

Explicit ordering is flexible and transparent, but it is also unenforced. The compiler cannot tell you that authentication precedes authorization, and nothing warns you when a middleware is misplaced. Some teams adopt the minimal-hosting convention where `WebApplication` auto-inserts routing at the correct point, trading a little control for fewer footguns. Keep the canonical order, add an integration test that asserts both a preflight and a 401 case, and treat pipeline edits as behaviour changes that deserve review.
