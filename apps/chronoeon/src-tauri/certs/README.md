# Public TLS trust data

- `cacert.pem` is the Mozilla root bundle published by curl, dated **2026-08-13**.
  Its SHA-256 was checked against <https://curl.se/ca/cacert.pem.sha256> on
  2026-09-08: `f66dff1bdf8f96060b8177976f8b7d9254bc89bc4db933d769f7384d28480bc9`.
- `gitee-chain.pem` supplements servers that omit an intermediate certificate.
- These are **public certificates**, not private keys or user credentials.
- Windows libgit2 uses Schannel/system trust. Android injects parsed X.509
  certificates; other OpenSSL-based targets load the bundle from a private app
  cache. Certificate and hostname verification remain enabled.
- Refresh the bundle from curl's official CA export and verify its published
  checksum when updating trust data. Never add a user's private CA or credentials
  to the application repository.
