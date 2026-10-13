---
title: "Secret Rotation and Key Management with Data Protection"
slug: "secret-rotation-key-management"
excerpt: "Keys that never rotate are the quiet failure. Data Protection rotates on a schedule, but only if you persist and version the key ring correctly."
category: "Security & Identity"
tags: ["secrets", "keys", "data-protection"]
date: "2026-01-09"
level: "Advanced"
author: "Riad Hossain"
---

Data Protection is the .NET component that encrypts cookies, antiforgery tokens and anything else you hand it. Its default configuration stores the key ring in the user profile of the machine that generated it and protects it with the machine key. That works on one machine, and it is the source of two production failures: keys vanish on container restart so every existing cookie becomes undecryptable, and keys never leave the box they were born on so a second instance cannot read the first instance's cookies. Rotation is built in — keys expire after ninety days by default — but none of it helps if the ring is not shared and persisted.

## Persisting a shared key ring

`PersistKeysToFileSystem` writes the ring to a directory; point it at a mounted volume or a Kubernetes PVC that every replica mounts. In a web farm the better target is a shared store such as Redis, a database through a custom `IXmlRepository`, or a cloud key vault. `SetApplicationName` must be identical across instances — it is mixed into the key derivation, so a mismatch produces two effectively disjoint rings sharing a directory.

```csharp
builder.Services.AddDataProtection()
    .PersistKeysToFileSystem(new DirectoryInfo("/var/keys"))
    .SetApplicationName("riad-demo-api")
    .SetDefaultKeyLifetime(TimeSpan.FromDays(30))
    .ProtectKeysWithCertificate(keys.Platform);
```

`ProtectKeysWithCertificate` wraps each key in the ring with a certificate so the raw key material on disk is useless without it. Without that, anyone who reads the volume can decrypt every protected payload.

### Rotation and the key ring

Keys carry an activation date and an expiry. When a new key activates, it is used for new payloads; older keys stay in the ring to decrypt. Because decryption walks the ring by key id, rotation is transparent — the only thing that breaks it is deleting old keys before the payloads they protect have expired. Keep at least two lifetime windows of history.

## Where rotation actually goes wrong

- Container with no persisted volume: the ring is regenerated on every deploy and every session is invalidated. Looks like users "randomly logged out" after a release.
- Two rings after an `ApplicationName` typo: instances cannot decrypt each other's cookies, so traffic hitting the wrong replica fails intermittently.
- A certificate with no overlap: rotating the protecting certificate without a grace period makes every existing key unreadable at cutover.
- Keys copied between environments: staging and production sharing a ring means a token minted in staging works in production.

## The trade-off

A shared, certificate-protected key ring adds a mount, a certificate to rotate and a dependency on external storage for the hottest path in the app. The alternative — per-instance keys — is simpler and wrong the moment you scale past one replica. Treat the certificate as a secret of its own, rotate it with an overlap window so old and new keys coexist, and monitor the ring's key count and oldest expiry as an alert, because the failure is silent and only shows up as users being logged out during a deploy.
