# all-Mail-Desktop Flow Design

## 1. Flow design principles

`all-Mail-Desktop` should feel like a Windows-native operator console, while keeping the underlying product model aligned with `all-Mail`.

Core principles:

- first screen must explain the runtime mode clearly
- core users should not see Cloudflare complexity by default
- advanced features must be opt-in, never part of the first-run path
- desktop should guide, not assume Docker / Cloudflare expertise

## 2. Runtime mode flow

### 2.1 First launch flow

```text
App start
  -> local config exists?
    -> no: open welcome wizard
    -> yes: restore last runtime mode

Welcome wizard
  -> choose mode
    -> Connect to existing all-Mail server
    -> Start with local desktop mode (future)
    -> Enable developer extensions later

Save config
  -> health check target
  -> open login screen
```

### 2.2 Connected server mode flow

```text
Choose "Connect to existing server"
  -> input base URL
  -> run /health check
  -> validate version compatibility
  -> save endpoint profile
  -> go to login
```

Expected UX:

- endpoint history list
- connection test button
- explicit error states for unreachable server / auth failure / version mismatch

### 2.3 Local runtime mode flow (future)

```text
Choose "Local desktop mode"
  -> check embedded runtime availability
  -> start local service
  -> wait for health signal
  -> initialize local storage if needed
  -> open login or bootstrap-admin setup
```

## 3. Authentication flows

### 3.1 Desktop login flow

```text
Login screen
  -> username/password
  -> optional 2FA
  -> receive session/token
  -> store session securely
  -> enter dashboard
```

Requirements:

- renderer should not persist secrets casually in localStorage by default
- desktop sign-out must clear local session state and cached endpoint metadata where required

### 3.2 Bootstrap admin flow (local runtime mode)

```text
No admin exists
  -> desktop asks for bootstrap admin username/password
  -> create bootstrap admin
  -> sign in automatically
```

## 4. Core mailbox management flows

### 4.1 Add mailbox account flow

```text
Mailbox list
  -> Add mailbox
    -> choose provider (Outlook / Gmail / QQ)
    -> choose auth type (OAuth / app password where supported)
    -> enter provider configuration
    -> run verification
    -> create or update mailbox account
    -> refresh mailbox list
```

Desktop rule:

- provider onboarding remains part of the core product
- Cloudflare/domain mailbox options do not appear in the default add-account flow

### 4.2 Outlook OAuth flow

```text
Select Outlook OAuth
  -> fill client config or select saved app profile
  -> generate auth URL
  -> open system browser
  -> receive callback / paste callback URL
  -> exchange token
  -> verify Graph/IMAP access
  -> save account
```

Desktop v1 recommendation:

- prefer system browser for consent
- keep helper-script parity as an advanced troubleshooting path, not the default UI path

### 4.3 Gmail OAuth flow

```text
Select Gmail OAuth
  -> fill callback/app config
  -> generate auth URL
  -> open system browser
  -> complete consent
  -> exchange token
  -> run inbox verification
  -> save account
```

### 4.4 QQ / app-password flow

```text
Select QQ or app-password provider
  -> enter server/auth parameters
  -> test inbound access
  -> optionally test outbound send
  -> save account
```

## 5. Mail operations flows

### 5.1 Mailbox browsing flow

```text
Mailbox list
  -> select account
  -> choose folder (inbox / sent / junk)
  -> load messages
  -> open message detail
```

### 5.2 Mail detail flow

```text
Open message
  -> render summary
  -> render html/text body
  -> show extracted verification code when available
  -> allow refresh / reopen / copy actions
```

### 5.3 Send mail flow

```text
Open compose dialog
  -> choose account
  -> enter recipients / subject / body
  -> validate capability
  -> send
  -> store send result
  -> jump to sent history if needed
```

## 6. Dashboard and operations flows

### 6.1 Dashboard flow

```text
Login success
  -> dashboard summary
  -> mailbox health cards
  -> provider distribution
  -> recent API/log activity
  -> quick actions
```

### 6.2 Log / API management flow

```text
Open logs page
  -> filter by actor/action/provider
  -> inspect details
  -> export or clear according to desktop policy
```

## 7. Settings and environment flows

### 7.1 Connection profile flow

```text
Settings
  -> endpoint profiles
  -> test connection
  -> set default endpoint
  -> remove stale profile
```

### 7.2 Desktop mode settings

```text
Settings
  -> start on login (future)
  -> check for updates
  -> open logs folder
  -> toggle developer extensions
```

## 8. Extension flow design

### 8.1 Developer extension enablement

```text
Settings -> Extensions
  -> show "Cloudflare / domain-mail" as disabled by default
  -> user explicitly enables developer mode
  -> desktop warns that advanced server-side setup is required
  -> extension menus become visible
```

Rules:

- extension enablement must be reversible
- extension screens must show environment prerequisites clearly
- extension should never block core mailbox-console startup

### 8.2 Cloudflare extension flow (future)

```text
Developer mode on
  -> open extension panel
  -> validate server capability and extension availability
  -> expose domain-mail / Cloudflare-specific controls
  -> redirect users to server docs when runtime prerequisites are unmet
```

## 9. Update flow

### 9.1 Desktop update flow

```text
App start / manual check
  -> query release endpoint
  -> newer version found?
    -> no: remain current
    -> yes: prompt user
  -> download installer/update package
  -> restart and apply
```

### 9.2 Version compatibility flow

```text
Desktop starts
  -> read desktop version
  -> query server version/capability
  -> if incompatible:
       show compatibility warning
       block risky pages if needed
```

## 10. Error-state flow design

Desktop v1 must explicitly handle these error classes:

- server unreachable
- invalid base URL
- login failed
- OAuth callback failed
- provider token refresh failed
- mailbox capability mismatch
- extension unavailable
- desktop version incompatible with server version

Each of these should have:

- short user-facing explanation
- retry path
- advanced details toggle

## 11. Flow boundaries for v1

Included in v1:

- welcome wizard
- connected server mode
- login
- core mailbox add/edit/delete
- mailbox browsing
- send mail
- dashboard
- connection settings
- disabled-by-default extension center

Excluded from v1:

- full standalone local runtime onboarding
- Cloudflare extension default menus
- Windows tray / silent background mode
- OS-native notification center integration
- native mailto/protocol capture

## 12. Flow design outcome

The desktop product should launch as a focused operator console:

- simple first-run path
- no Cloudflare cognitive overload in core mode
- clear split between core users and developer extensions
- reusable API and UI flows from the existing `all-Mail` repository

This keeps `all-Mail-Desktop` practical for Windows users without forcing the server edition's full deployment complexity into the very first desktop release.
