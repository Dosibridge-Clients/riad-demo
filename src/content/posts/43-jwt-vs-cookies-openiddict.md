---
title: "JWT, Cookies and OpenIddict: Picking an Authentication Model"
slug: "jwt-vs-cookies-openiddict"
excerpt: "Bearer JWTs and cookie sessions solve different problems. Know which one your client needs, then let OpenIddict issue and validate the right token."
category: "Security & Identity"
tags: ["authentication", "jwt", "openiddict"]
date: "2026-02-02"
level: "Advanced"
author: "Riad"
---

The default ASP.NET Core template hands you JWT bearer authentication and a `[Authorize]` attribute, and that is enough to ship a mobile API. It is not enough to ship a model for every client, because a bearer token in `localStorage` and an `HttpOnly` session cookie fail in opposite directions and the wrong pick quietly creates the vulnerability you read about six months later. The decision is not JWT versus cookies at the protocol level — it is statelessness versus revocation, and who owns the token.

## What each model actually is

A JWT is a signed, self-contained assertion. The resource server validates the signature and the claims locally without touching the issuer, which is why it scales horizontally for free. A cookie is an opaque reference the browser attaches automatically; the server looks it up in a session store or ticket store, so revocation is a delete. The confusion comes from the fact that a cookie can carry a JWT and a header can carry a session id — the transport is orthogonal to the model.

- Same-origin server-rendered app: cookie session, `HttpOnly`, `Secure`, `SameSite=Lax`. Simplest and safest by default.
- SPA on the same origin or a same-site subdomain: cookie session with antiforgery, still no token in JavaScript.
- Mobile or machine client: bearer JWT, refreshed with a refresh token because access token expiry is your only lever.
- Third-party clients, delegated access, multiple resource servers: an OAuth 2.0 / OpenID Connect server, and OpenIddict is the library that turns your ASP.NET Core app into one.

## Where the bearer token fails

The failure mode is not signature forgery. It is that a JWT cannot be revoked before it expires, and `localStorage` is readable by any script the page runs, so one XSS in an analytics bundle exfiltrates the token for its full lifetime. Shortening the access token lifetime to five minutes pushes the problem onto the refresh token, which then needs rotation and reuse detection. This is why token theft is not a cryptography bug but a client-storage and lifetime bug.

## OpenIddict as an authorisation server

OpenIddict gives you `AddOpenIddict()`, token endpoints and the validation plumbing without hand-rolling JWT signing. On the validation side you configure `UseDataProtection()` and a signing key; the minimal setup wires bearer handling for the same app that issues tokens.

```csharp
builder.Services.AddOpenIddict()
    .AddCore(o => o.UseEntityFrameworkCore().UseDbContext<AuthDbContext>())
    .AddServer(o =>
    {
        o.SetTokenEndpointUris("/connect/token");
        o.AllowClientCredentialsFlow();
        o.AllowAuthorizationCodeFlow().RequireProofKeyForCodeExchange();
        o.AddEncryptionCertificate(keys.Encryption);
        o.AddSigningCertificate(keys.Signing);
        o.UseAspNetCore().EnableTokenEndpointPassthrough();
    })
    .AddValidation(o =>
    {
        o.UseLocalServer();
        o.UseAspNetCore();
    });
```

### Validation events

Use `JwtBearerEvents` or OpenIddict's validation handlers to react on the hot path — logging rejected tokens, rejecting a token whose `jti` is on a deny list, or enforcing a required claim. Keep this synchronous and allocation-light; it runs for every authenticated request.

## The trade-off

Stateless JWTs scale and decouple but cannot be revoked, so you accept a window of exposure and pay for it with short lifetimes and refresh rotation. Cookies revoke instantly and dodge the XSS storage problem, but need CSRF protection and a session store that can itself become the bottleneck. For a first-party browser app the cookie is usually correct; for anything you do not control, issue tokens through OpenIddict and treat the bearer format as an implementation detail.
