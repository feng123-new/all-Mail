# all-Mail External Mail Password Button Design

Date: 2026-04-02
Status: Draft accepted for planning
Scope owner: external email admin list / controlled secret reveal UX

## 1. Goal

Improve operator efficiency in the external mailbox list by making it obvious which accounts have a stored **login password** and by reducing repeated OTP friction when operators need to inspect multiple passwords in one session.

After this change, an operator should be able to answer these questions directly from the list page:
- Does this external mailbox have a stored login password?
- If it does, can I reveal it now without reopening the edit flow?
- If my admin account is protected by 2FA, can I unlock a short viewing window and inspect multiple passwords safely?

This design does **not** broaden the scope to all secrets. It is specifically about the human-meaningful login password that operators may need for website or mailbox-console access.

## 2. Current state

Observed implementation today:
- `GET /admin/emails/:id` is intentionally secret-free.
- `POST /admin/emails/:id/reveal-secrets` exists and requires OTP step-up for allowed secret fields.
- The frontend edit flow no longer preloads secrets and uses an OTP-gated reveal path.
- Existing reveal rules treat secret types differently:
  - password-style accounts can reveal `password`
  - OAuth accounts can reveal `refreshToken`
  - `clientSecret` is intentionally excluded from the current reveal scope
- The external mailbox list currently does **not** expose a row-level signal for whether a login password exists.
- As a result, operators must enter the edit/reveal path to discover whether a password is present, which is inefficient when checking many accounts.

## 3. Scope and non-goals

### 3.1 In scope
- add a row-level password button to the external mailbox list
- make the button color indicate whether a stored login password exists
- require admin 2FA to be enabled before any password reveal is allowed
- replace per-account OTP repetition with a short-lived reveal-unlock window
- keep audit logging for unlock attempts and password reveal events
- keep list/detail payloads secret-free while allowing password-presence metadata

### 3.2 Out of scope
- revealing OAuth `refreshToken` through the new row-level password button
- revealing `clientSecret`
- redesigning the full external mailbox edit page
- storing a new supplemental/manual login password field in this change
- changing export/import semantics in this change
- broad role-model redesign beyond the current admin + 2FA gate

## 4. Recommended architecture

### 4.1 UX surface model

Add a dedicated `密码` action button to each row in the external mailbox table.

Visual state:
- **blue button**: a stored login password exists for this row
- **white/default button**: no stored login password exists

The button state reflects **login-password presence only**. It must not become a generic "has any secret" indicator.

That means:
- rows with a stored `password` show blue
- rows without a stored `password` show white
- OAuth rows that only have `refreshToken` remain white unless they also truly have a stored `password`

This preserves the operator meaning of the label: blue means “there is a password I may be able to view.”

### 4.2 Interaction model

#### White button behavior
If the row has no stored login password:
- the button remains visible but non-secretive
- click may either do nothing or show a lightweight message such as `This account has no stored login password`
- no OTP flow is triggered

#### Blue button behavior
If the row has a stored login password:
1. if admin 2FA is **not enabled**:
   - block reveal
   - show message / modal: `Enable 2FA before revealing stored passwords`
2. if admin 2FA is enabled but no active reveal unlock exists:
   - show OTP modal
   - successful OTP creates a short-lived reveal unlock
3. if admin 2FA is enabled and an active reveal unlock exists:
   - reveal password immediately through the controlled reveal path

This keeps the current security posture but removes repeated OTP prompts during focused operator work.

### 4.3 Reveal-unlock session model

The recommended relaxation is **not** “2FA enabled means reveal without OTP forever.”
Instead, it is:
- 2FA is a hard prerequisite
- OTP is required once to open a short reveal-unlock window
- the unlock window is short-lived and automatically expires

Recommended unlock TTL:
- **10 minutes** default

Recommended storage model:
- return a short-lived reveal-grant token after OTP verification
- keep it in frontend memory only for the current page session
- do not persist it to localStorage
- clear it on refresh, logout, or explicit expiration

Recommended backend semantics for the grant:
- scope the grant to `adminId`
- mark purpose as `external_password_reveal`
- include expiry time
- optionally bind to current auth session context if the existing auth model supports it cheaply

A short-lived signed grant is preferred over removing OTP entirely because it improves usability without making every authenticated admin session a standing password-disclosure session.

### 4.4 Backend contract model

#### List payload metadata
Extend the external mailbox list row payload with a password-presence boolean:
- `hasStoredPassword: boolean`

Rules:
- computed from whether the persisted login-password field is non-empty
- does **not** leak the password value
- does **not** treat `refreshToken` as a password surrogate

The list API remains safe because presence metadata is materially different from secret disclosure.

#### Reveal unlock endpoint
Add a dedicated endpoint for creating a short-lived reveal unlock, for example:
- `POST /admin/emails/reveal-unlock`

Request body:
```json
{
  "otp": "123456"
}
```

Response shape:
```json
{
  "success": true,
  "data": {
    "grantToken": "...",
    "expiresAt": "2026-04-02T12:34:56.000Z"
  }
}
```

Behavior:
- requires authenticated admin
- requires admin 2FA enabled
- verifies OTP using existing step-up verification logic
- writes audit log for success/failure
- returns short-lived reveal grant on success

#### Password reveal endpoint
For row-level password reveal, keep the existing reveal semantics but allow grant-based access, for example by extending:
- `POST /admin/emails/:id/reveal-secrets`

Recommended request evolution:
```json
{
  "fields": ["password"],
  "grantToken": "..."
}
```

Rules:
- only `password` is allowed in the row-button flow
- if `grantToken` is valid, OTP is not required again inside the unlock TTL
- if no valid grant exists, backend rejects with a typed error that the frontend can use to open the OTP modal
- audit log remains mandatory for the actual reveal event

Backward compatibility option:
- keep current `{ otp, fields }` behavior for edit-page reveal if desired
- add grant-token support without breaking the existing contract immediately

### 4.5 Audit model

Audit must remain explicit and queryable.

Recommended events:
1. `ADMIN_REVEAL_EXTERNAL_SECRET_UNLOCK`
   - success / failure
   - includes admin id, target IP, and expiry time when successful
2. `ADMIN_REVEAL_EXTERNAL_SECRET`
   - existing event remains for actual reveal
   - metadata should identify `field=password`

This separation matters because “unlock granted” and “secret actually viewed” are different events.

## 5. Frontend surface

### 5.1 Table changes

In `web/src/pages/emails/index.tsx`:
- add a `密码` button in the row action cluster
- derive button color from `record.hasStoredPassword`
- do not expose raw secret values in table state

Recommended visual language:
- blue / primary when `hasStoredPassword === true`
- white / default when `hasStoredPassword === false`
- keep label text stable as `密码`

### 5.2 Modal behavior

Recommended modal states:

1. **No password present**
   - optional lightweight info modal or message
2. **2FA required**
   - explain that admin must enable 2FA first
   - optionally deep-link to security settings
3. **OTP unlock modal**
   - request 6-digit OTP
   - on success, cache reveal grant in memory with countdown
4. **Password reveal modal/panel**
   - show password in a controlled surface
   - include copy action
   - auto-hide or clear local visible state after a short interval

Recommended display rule:
- do **not** reveal the password inline in the table cell itself
- use a modal/popover/drawer so the action remains deliberate and shoulder-surf risk stays lower

### 5.3 Reveal state management

Add local UI state for:
- `passwordRevealGrant`
- `passwordRevealGrantExpiresAt`
- `passwordRevealTargetRow`
- `passwordRevealVisibleValue`

Rules:
- keep the grant in memory only
- clear visible password on modal close
- clear grant when expired
- show remaining unlock time in the OTP/reveal UI if useful

## 6. Permission and security model

### 6.1 Required conditions
A password reveal is allowed only when all are true:
1. requester is an authenticated admin
2. admin account has 2FA enabled
3. row has a stored login password
4. request uses a valid reveal unlock or passes OTP verification

### 6.2 Explicitly rejected model
This design rejects the following shortcut:
- “if admin has enabled 2FA at account level, allow unlimited password reveal without OTP step-up”

That shortcut is convenient but weakens the current defense too much. The recommended unlock window is the safer compromise.

### 6.3 Secret-type boundary
The new password button is only about **login-password visibility**.
It must not silently become the main entrypoint for:
- OAuth refresh token reveal
- client secret reveal
- generic secret inspection

If the product later wants a unified secret-inspection center, that should be designed separately.

## 7. Error handling

Typed frontend-handled cases should include:
- `TWO_FACTOR_REQUIRED`
- `INVALID_OTP`
- `SECRET_REVEAL_NOT_ALLOWED`
- `PASSWORD_NOT_PRESENT`
- `REVEAL_UNLOCK_EXPIRED`

Recommended behavior:
- `TWO_FACTOR_REQUIRED` -> show 2FA enablement guidance
- `INVALID_OTP` -> keep OTP modal open and allow retry
- `PASSWORD_NOT_PRESENT` -> show non-error info message
- `REVEAL_UNLOCK_EXPIRED` -> reopen OTP unlock flow
- `SECRET_REVEAL_NOT_ALLOWED` -> treat as permission/security failure and do not expose fallback details

## 8. Verification and testing

### 8.1 Backend tests
Add/adjust tests for:
- list payload includes `hasStoredPassword`
- rows with `password` return `hasStoredPassword=true`
- rows with only `refreshToken` return `hasStoredPassword=false`
- reveal-unlock endpoint rejects admins without 2FA
- reveal-unlock endpoint rejects invalid OTP
- reveal-unlock endpoint returns short-lived grant for valid OTP
- reveal endpoint accepts valid grant for `password`
- reveal endpoint rejects expired/invalid grant
- audit records are written for unlock and reveal events

### 8.2 Frontend tests
Add/adjust tests for:
- button color changes with `hasStoredPassword`
- white button does not trigger OTP flow
- blue button with no 2FA shows the correct guidance
- successful OTP unlock avoids repeated OTP within TTL
- expired unlock forces OTP again
- revealed password is cleared from visible state on modal close/timeout

### 8.3 Manual verification
Recommended smoke flow:
1. account without stored password -> white button
2. account with stored password -> blue button
3. 2FA disabled admin -> reveal blocked
4. 2FA enabled admin -> first reveal requests OTP
5. second reveal within TTL -> no OTP prompt
6. reveal after TTL expiry -> OTP required again
7. OAuth-only account with refresh token only -> white button

## 9. Success criteria

This design is complete when all are true:
1. operators can identify password-bearing rows from the list page without entering edit mode
2. password visibility still requires admin 2FA protection
3. OTP friction is reduced from per-row to per-unlock-window
4. list/detail APIs remain secret-free except for boolean presence metadata
5. OAuth token semantics are not confused with login-password semantics
6. audit logs still show both unlock and actual reveal activity

## 10. Recommended implementation order

1. extend backend list contract with `hasStoredPassword`
2. add reveal-unlock backend endpoint and typed errors
3. extend reveal endpoint to accept grant-based password reveal
4. update frontend row actions and OTP unlock state handling
5. add/adjust backend + frontend tests
6. run targeted reveal tests and full build verification

## 11. Follow-up intentionally deferred

The following idea was discussed but is intentionally deferred to a separate design if needed:
- adding a distinct `manualLoginPassword` / `operatorLoginPassword` field for accounts that currently do not store a website-login password

That is a product expansion, not a small UX refinement, and should remain out of this change unless explicitly approved later.
