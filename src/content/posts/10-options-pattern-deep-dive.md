---
title: "The Options Pattern: IOptions, IOptionsSnapshot and IOptionsMonitor"
slug: "options-pattern-deep-dive"
excerpt: "IOptions, IOptionsSnapshot and IOptionsMonitor look interchangeable but differ in lifetime, reload behaviour and where they can be injected."
category: "ASP.NET Core"
tags: ["options", "configuration", "reload"]
date: "2026-08-19"
level: "Advanced"
author: "Riad Hossain"
---

The options pattern wraps a configuration section in a strongly typed class so application code depends on a type, not a string key. Three interfaces expose those instances and they look interchangeable at a glance. They are not: each has a different lifetime, a different reload story, and a different set of places it can legally be injected.

## The three interfaces

`IOptions<T>` resolves a singleton instance. It is created once, cached forever, and never observes a configuration change. It is the cheapest option and correct for values that are fixed at startup, such as a connection string used to build a client once.

`IOptionsSnapshot<T>` is scoped. It recomputes the bound instance once per scope, which for a web request is once per request, so a value changed on disk is visible to the next request without a restart. Because it is scoped, injecting it into a singleton throws `InvalidOperationException`, the options-pattern version of a captive dependency.

`IOptionsMonitor<T>` is a singleton that caches the current value and exposes `CurrentValue` plus an `OnChange` callback fired through a change token. It is the one to use from singleton services and background workers.

### Registering and validating

Bind sections, add validation, and fail fast at startup rather than on the first request:

```csharp
builder.Services
    .AddOptions<SmtpOptions>()
    .Bind(builder.Configuration.GetSection("Smtp"))
    .ValidateDataAnnotations()
    .Validate(o => o.Port is > 0 and < 65536, "Port must be a valid TCP port")
    .ValidateOnStart();

public sealed class SmtpOptions
{
    public required string Host { get; init; }
    [Range(1, 65535)] public int Port { get; init; }
    public bool UseTls { get; init; }
}
```

`ValidateOnStart` surfaces a bad configuration as a startup failure instead of a null reference deep inside a request.

## How reload actually works

Each interface is backed by an `IOptionsFactory<T>`. The monitor keeps a per-name cache and subscribes to the registered `IOptionsChangeTokenSource<T>`, which for the file configuration provider is wired to the file reload token. When the source fires, the monitor invalidates its cache and raises `OnChange`, so the next read of `CurrentValue` re-runs the factory. `IOptions<T>` never subscribes, and `IOptionsSnapshot<T>` only re-reads because each new scope builds a fresh instance.

## Where each one bites

Injecting `IOptionsSnapshot<T>` into a singleton fails at resolution. Reading `IOptions<T>` inside a background service and expecting edits to appear is a quieter bug: the service keeps using the startup value indefinitely. Named options add another layer, where `IOptionsMonitor<TOptions>.Get("name")` returns per-name instances that must be requested by that name consistently.

## The trade-off

`IOptions<T>` is fastest and simplest but frozen. `IOptionsSnapshot<T>` gives per-request consistency under concurrent reloads, but only inside a scope. `IOptionsMonitor<T>` gives live reload and change notifications with the flexibility of singleton injection, but it caches values and its change notifications come with disposal concerns for long-lived subscriptions. Match the interface to the lifetime you already have rather than upgrading to the monitor by reflex.

Named options add a wrinkle that trips people up: names are not case-insensitive by default, and a typo quietly yields a fully default instance instead of an error unless you validate. Pair every `Get(name)` with `ValidateOnStart`, or the failure surfaces as a runtime misconfiguration far from the registration that caused it.
