---
title: "Authorization Policies, Requirements and Resource-Based Handlers"
slug: "authorization-policies-handlers"
excerpt: "Role checks stop working once access depends on the resource. Requirements and handlers move that decision into code without scattering ifs."
category: "Security & Identity"
tags: ["authorization", "policies", "aspnetcore"]
date: "2026-01-27"
level: "Advanced"
author: "Riad Hossain"
---

`[Authorize(Roles = "Admin")]` answers a question about the user. Most real endpoints need to answer a question about the user and the resource: can this doctor read this patient's record, can this tenant member edit this document. The instinct is to load the resource inside the controller and write an `if`. That works until the same rule is needed from a minimal API, a background job and a SignalR hub, and now the check lives in four places and one of them gets it wrong during a refactor. Policies, requirements and handlers are the framework's answer: composable, testable, and declared at the endpoint.

## Policies are named requirement sets

A policy is a name bound to a set of requirements plus optional role or claim checks. You register it once and reference it by name, which means the rule has one home and the endpoint states intent rather than mechanics.

```csharp
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("CanEditDocument", policy =>
        policy.Requirements.Add(new DocumentOwnerRequirement()));
    options.AddPolicy("EmployeeOnly", policy =>
        policy.RequireClaim("department", "engineering", "platform"));
});

builder.Services.AddSingleton<IAuthorizationHandler, DocumentOwnerHandler>();
```

A requirement is just a marker carrying data — often nothing more than an empty class, sometimes a minimum age or a permission string.

## Resource-based handlers

The interesting case is the resource itself. `IAuthorizationService.AuthorizeAsync` takes the resource as an argument, and the handler receives it. In minimal APIs you call it from the endpoint filter; in controllers you inject `IAuthorizationService` or use the `AuthorizeAsync` extension on `IHttpContextAccessor`.

```csharp
public sealed class DocumentOwnerHandler
    : AuthorizationHandler<DocumentOwnerRequirement, Document>
{
    private readonly ICurrentUser _user;

    public DocumentOwnerHandler(ICurrentUser user) => _user = user;

    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        DocumentOwnerRequirement requirement,
        Document resource)
    {
        if (context.User.IsInRole("Admin") || resource.OwnerId == _user.Id)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}
```

### Failing closed

A handler that never calls `Succeed` means the requirement fails, and the request gets a 403. That is the correct default, but it also means a handler that throws or returns early on a null resource silently denies everything — log the deny path so a broken handler is visible instead of looking like a permissions change.

## Why not just `if` in the controller

- The rule is stated at the endpoint with `RequireAuthorization("CanEditDocument")`, so it survives a controller rewrite.
- Handlers are dependency-injected, so they can reach the current user, a repository or a cache cleanly.
- They are unit-testable without spinning up the pipeline.
- Centralised denial means one place to log, audit and rate-limit authorisation failures.

## The trade-off

Handlers add indirection: the endpoint says "CanEditDocument" and the logic lives elsewhere, so a reader must jump. They also tempt you into loading the resource twice — once inside the handler and once in the endpoint — unless you flow the loaded entity through `HttpContext.Items` or an endpoint filter. The payoff is a rule that exists once, is testable, and does not drift as the surface grows. Reach for the `if` only when the endpoint is genuinely the only caller and will stay that way.
