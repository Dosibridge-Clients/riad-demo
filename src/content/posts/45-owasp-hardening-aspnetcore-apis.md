---
title: "Hardening ASP.NET Core APIs Against the OWASP Top 10"
slug: "owasp-hardening-aspnetcore-apis"
excerpt: "Most OWASP Top 10 findings in .NET APIs come from a handful of framework defaults left unconfigured. Here is what to switch on and why."
category: "Security & Identity"
tags: ["security", "owasp", "api"]
date: "2026-01-21"
level: "Advanced"
author: "Riad Hossain"
---

The OWASP Top 10 reads like a taxonomy of exotic attacks. In a .NET 8 API most of it collapses into a short list of framework defaults nobody configured: detailed error pages left on in production, a CORS policy written with `AllowAnyOrigin`, a `DbContext` whose user id comes from an unvalidated query parameter, a deserializer that binds a whole entity and lets the client set `IsAdmin`. Hardening is less about heroics than about closing the defaults that assume you are still in development.

## Access control and injection

Broken access control is the first category for a reason. The fix is object-level authorisation through a policy handler, never a check the client can influence, and never trusting an id the client supplies as the tenant or owner. For injection, EF Core parameterises LINQ automatically; the danger is `FromSqlRaw` with string concatenation, which is SQL injection the same as any other stack.

```csharp
// Wrong: interpolated into the statement, client controls the value.
var rows = db.Orders.FromSqlRaw($"SELECT * FROM Orders WHERE Sku = '{sku}'");

// Right: a parameter the provider sends as a bound argument.
var rows = db.Orders.FromSqlInterpolated($"SELECT * FROM Orders WHERE Sku = {sku}");
```

### Serialization and mass assignment

Never bind a request body directly to an entity that has server-owned fields. A DTO with only the writable properties removes the entire class of mass-assignment bugs; JSON source generation via a `JsonSerializerContext` also closes the polymorphic-deserialization gadgets that plague `System.Text.Json` when type resolution is loose.

## Security misconfiguration

- Register the exception handler and `UseHsts` in production so stack traces and framework headers never reach the client.
- Set `UseCors` with an explicit origin allow-list and credentials only when needed; `AllowAnyOrigin()` plus `AllowCredentials()` is rejected by the middleware for good reason.
- Add security headers: `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`. There is no built-in middleware, so a small one or a community package.
- Return `ProblemDetails` without inner exception text; log the detail server-side.

```csharp
builder.Services.AddExceptionHandler<GlobalExceptionHandler>();
builder.Services.AddProblemDetails();

var app = builder.Build();
app.UseExceptionHandler();
app.UseHsts();
app.UseHttpsRedirection();

app.UseCors(policy => policy
    .WithOrigins("https://app.example.com")
    .WithHeaders("Authorization", "Content-Type")
    .WithMethods("GET", "POST", "PUT", "DELETE"));
```

## Logging, monitoring and secrets

Insufficient logging means a breach is discovered by a customer. Log authentication failures, authorisation denials and input-validation rejections with a correlation id, but never log tokens, passwords or full card numbers. Map secrets to a vault or environment, keep them out of `appsettings.json`, and treat the connection string as a credential. For SSRF (a Top 10 category since 2021), never fetch a URL supplied by the client without an allow-list of hosts.

## The trade-off

Every hardening step costs something: HSTS locks you into HTTPS for the domain, a strict CSP breaks inline scripts, explicit CORS breaks the quick prototype, and a DTO boundary adds mapping code. The honest position is that these are the price of a production API, not optional polish. Adopt them from the first release, because retrofitting a CSP or an authorisation model onto a live system is where the security debt actually bites.
