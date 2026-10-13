---
title: "Configuration Providers and Secret Management in .NET"
slug: "configuration-providers-secrets"
excerpt: "Configuration in .NET is an ordered provider chain where the last registered value wins. Learn how secrets, Key Vault and options binding actually resolve."
category: "ASP.NET Core"
tags: ["configuration", "secrets", "keyvault"]
date: "2026-08-13"
level: "Advanced"
author: "Riad"
---

The classic production incident is a service that boots fine locally and quietly connects to the wrong database in staging. Nothing throws; the connection string is simply the one from the base `appsettings.json`, because a later provider never overrode it. Configuration in ASP.NET Core is not a single settings object. It is a flat, case-insensitive view over an ordered list of providers, and the rule is brutal in its simplicity: the last provider that registered a key wins. Every override bug is really a question of position in that list.

## How the provider chain resolves a key

`IConfiguration` is a facade over `IConfigurationRoot`, which holds an ordered collection of `IConfigurationProvider` instances. When you read `config["ConnectionStrings:Default"]`, the root asks each provider in reverse order and returns the first non-null answer. That reverse walk is the whole mechanism, and it is why `AddEnvironmentVariables` added after `AddJsonFile` beats the JSON on disk. Providers are also reload tokens: file providers watch for changes and raise a reload, which propagates through the root to any `IOptionsMonitor<T>` bound to it.

## The default order and where it goes wrong

The generic host wires a predictable sequence: `appsettings.json`, then `appsettings.{Environment}.json`, then user secrets in Development, then environment variables, then command-line arguments. This is why an environment-specific file always beats the base file, and why a container environment variable beats both. The trap is calling `builder.Configuration.AddJsonFile` manually after `AddEnvironmentVariables`; you have quietly promoted a file above the environment. Debug it with `GetDebugView`, which prints each resolved value and the provider that supplied it.

### Environment variables and the double underscore

Environment variables cannot contain a colon on every platform, so the configuration binder treats a double underscore as a section separator. Setting `ConnectionStrings__Default` on the host is read as `ConnectionStrings:Default`. A single underscore is not special and will simply create a key you cannot bind to your options type.

## Secrets that must not live next to the code

A connection string or API key committed to `appsettings.json` is in git forever. In development the answer is `dotnet user-secrets`, which stores values outside the repository and is loaded automatically by the host in the Development environment. In production the answer is a real secret store, and for Azure that means Key Vault behind `Azure.Identity`.

```csharp
var builder = WebApplication.CreateBuilder(args);

if (builder.Environment.IsProduction())
{
    builder.Configuration.AddAzureKeyVault(
        new Uri("https://riad-vault.vault.azure.net/"),
        new DefaultAzureCredential());
}

builder.Configuration.AddEnvironmentVariables();

builder.Services
    .AddOptions<StorageOptions>()
    .Bind(builder.Configuration.GetSection("Storage"))
    .ValidateDataAnnotations()
    .ValidateOnStart();
```

Note the two deliberate choices. Key Vault is added before the environment provider, so an operator can still override a vault value without a redeploy. And `ValidateOnStart` turns a missing secret into a startup failure rather than a `NullReferenceException` hours later.

## Binding and reload semantics

Never read `IConfiguration` inside business code. Bind to a typed options class and inject the right lifetime. `IOptions<T>` is a singleton snapshot resolved once; `IOptionsSnapshot<T>` recomputes per request; `IOptionsMonitor<T>` is a singleton that raises `OnChange` when any watched provider reloads. Use `IOptionsMonitor<T>` for secrets you rotate at runtime and `IOptions<T>` for values that are fixed at boot.

## The trade-off

Layering is powerful precisely because it is opaque: the same key can have five sources and only one you can see in the editor. Key Vault adds a network dependency and startup latency you must budget for, which is why production deployments pin the vault provider to a cached endpoint rather than resolving every key on every cold start. The honest rule is to keep exactly one override layer per environment and to make the resolution order obvious in the host builder, never implicit in the order of the lines.
