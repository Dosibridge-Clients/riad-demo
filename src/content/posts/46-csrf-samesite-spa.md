---
title: "CSRF, SameSite Cookies and SPAs on Separate Origins"
slug: "csrf-samesite-spa"
excerpt: "A cookie-authenticated SPA is CSRF-able by design. SameSite helps until the API lives on another origin, where you need a token too."
category: "Security & Identity"
tags: ["csrf", "cookies", "spa"]
date: "2026-01-15"
level: "Advanced"
author: "Riad Hossain"
---

A browser attaches cookies to a request based on the target origin of that request, not on which page issued it. That single fact is the whole of CSRF: a page on `evil.example` can make the browser POST to `api.example` and the session cookie rides along, so the request is authenticated as the victim. `SameSite` was introduced to blunt this, and it does — right up until your SPA calls an API on a different origin, where `SameSite=Strict` stops sending the cookie at all and the developer falls back to `SameSite=None`, which is precisely the CSRF-able configuration.

## What SameSite actually does

`SameSite=Lax` sends the cookie on top-level navigations (a link click) but not on cross-site subrequests, which blocks the classic cross-site POST. `SameSite=Strict` never sends it cross-site, so an inbound link logs the user out on arrival. `SameSite=None` sends it everywhere and requires `Secure`. The middleware default in modern browsers is `Lax` when unspecified, so an application that never set the attribute is more protected than the developer thinks — until someone sets `None`.

## The separate-origin trap

If the SPA is served from `app.example.com` and the API from `api.example.com`, those are different registrable origins for cookie purposes, so `Lax` blocks the cookie on the XHR. The expedient fix is `SameSite=None; Secure`, and now every cross-site request carries the session cookie. The two correct answers are to put both behind one site (reverse-proxy the API under `/api` on the same origin) or to keep the antiforgery token mandatory.

```csharp
builder.Services.AddAntiforgery(options =>
{
    options.HeaderName = "X-CSRF-TOKEN";
    options.Cookie.Name = "__Host-csrf";
    options.Cookie.SameSite = SameSiteMode.None;
    options.Cookie.SecurePolicy = CookieSecurePolicy.Always;
});

// Minimal API: validate on state-changing verbs.
app.MapPost("/orders", (HttpContext ctx, AntiforgeryToken token, OrderDto dto) => { })
   .RequireAuthorization();
```

### Double-submit and the antiforgery service

ASP.NET Core's `IAntiforgery` is a synchroniser token: the server issues a token bound to the cookie and the client echoes it in a header. Rotate it per session and per request on sensitive operations. When the SPA cannot read an `HttpOnly` cookie, the pattern is to return the request token from a GET endpoint and have the client send it back in the header — the cookie proves the session, the header proves the page has the token, and a cross-site attacker can do neither.

## Why bearer tokens escape this

If your SPA holds a token in memory and sends it in `Authorization`, no cookie is attached automatically and the browser cannot be tricked into signing a request for the attacker. That is the usual argument for abandoning cookies entirely. The cost is the XSS exposure discussed elsewhere: a token in `localStorage` is readable by any injected script, while a cookie can be `HttpOnly`.

- Same origin, cookie auth: `SameSite=Lax` plus antiforgery on unsafe verbs.
- Separate origins, cookie auth: `SameSite=None` plus mandatory antiforgery header — do not skip it.
- Separate origins, token auth: no CSRF surface, but protect against XSS instead.

## The trade-off

Antiforgery is inconvenient: every state-changing request needs a token, and a SPA must fetch it before the first mutation. Relaxing it to `SameSite=None` alone removes the inconvenience and removes most of the protection. The pragmatic path is to serve the SPA and API from one origin so `Lax` suffices, and to keep the antiforgery token as a second layer regardless — defence in depth is cheap here and the failure mode without it is a silently forged request.
