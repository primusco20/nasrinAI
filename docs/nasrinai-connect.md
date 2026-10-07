# NasrinAI Connect — No-Code Managed Installation

## Product objective

NasrinAI Connect is a planned capability that lets a business add a NasrinAI AI workforce to an existing website or web application **without requiring the business owner to know coding, APIs, backend systems, SDKs, repositories, hosting, or deployment**.

The business should provide its website URL, complete a clear authorization step, configure what the AI should do, and tap **Activate**.

The core experience is:

```
Website URL
    ↓
Analyze / Verify
    ↓
Choose AI workforce + capabilities
    ↓
Configure SmartChat
    ↓
Activate
    ↓
NasrinAI manages installation
    ↓
SmartChat goes live
```

## Customer promise

> **Connect your website. Activate your AI. No coding required.**

The customer should not be presented with implementation details such as:

- API keys
- JavaScript snippets
- SDK installation
- npm commands
- GitHub repositories
- webhooks
- backend configuration
- database configuration
- deployment instructions

Those details belong to NasrinAI's internal installation system.

## Target customer

The primary target is a business owner or operator who:

- already has a website or web application;
- may not know what technology powers it;
- does not have a developer available;
- does not understand APIs or backend infrastructure;
- wants an AI assistant without rebuilding their website.

This capability should prioritize **unsupported or custom platforms**, rather than depending only on first-party integrations such as Shopify or WordPress.

## Desired customer flow

### 1. Enter website

The business enters a URL such as:

`https://example-business.com`

NasrinAI verifies that the business controls or is authorized to connect the website.

### 2. Analyze

NasrinAI analyzes the website to determine:

- website availability;
- domain and origin;
- public content;
- basic site structure;
- likely platform/hosting characteristics when detectable;
- possible installation paths.

### 3. Configure the AI

The business selects what NasrinAI should do, for example:

- Customer Support
- Sales Assistant
- Booking Assistant
- Receptionist
- Product/Service Advisor
- Lead Qualification
- Business Assistant
- Custom AI Workforce

The business can also configure:

- AI name;
- logo/branding;
- position of SmartChat;
- welcome message;
- tone/personality;
- business knowledge;
- uploaded documents;
- allowed actions;
- human handoff;
- permissions and limits.

### 4. Activate

The primary action should be simple:

**Activate NasrinAI**

After explicit authorization, NasrinAI's installation system determines the safest supported installation path.

### 5. Verify

NasrinAI verifies that the SmartChat installation is functioning and that the configured business origin is correctly associated with the business tenant.

### 6. Live

The website receives a SmartChat experience such as:

**✨ SmartChat**

The customer can open the assistant and interact with the business's configured NasrinAI workforce.

## Internal architecture direction

The feature should be implemented as an **Installation Orchestrator**, not as a simple static embed generator.

```
Business
   ↓
NasrinAI Connect
   ↓
Website Verification
   ↓
Installation Orchestrator
   ↓
Detect available installation path
   ├── Authorized hosting access
   ├── Authorized CMS/admin access
   ├── Authorized repository/deployment access
   ├── Supported platform/API
   └── Managed installation fallback
   ↓
Install / provision SmartChat
   ↓
Verify
   ↓
Activate
```

The orchestrator should hide implementation complexity from the business while maintaining explicit authorization and security controls.

## Important technical boundary

A URL by itself does not grant permission to modify a third-party website.

NasrinAI must **never silently modify or inject code into a website without explicit authorization**.

The product should therefore separate:

1. **Website discovery** — what NasrinAI can learn from a public URL.
2. **Authorization** — what the business explicitly permits NasrinAI to access or change.
3. **Installation** — the technical mechanism used after authorization.
4. **Verification** — confirmation that the integration works.
5. **Ongoing control** — the business can deactivate, reconnect, or remove NasrinAI.

If a website cannot expose a safe authorized installation path, NasrinAI must not pretend that automatic installation is possible. The system should provide an appropriate managed-installation or compatibility path instead.

## Security requirements

The installation system must be designed around:

- explicit customer authorization;
- tenant isolation;
- domain/origin verification;
- least-privilege access;
- short-lived credentials where possible;
- encrypted credential storage;
- credential revocation;
- installation audit logs;
- installation status tracking;
- rollback/removal capability;
- protection against SSRF and malicious URLs;
- protection against unauthorized cross-tenant installation;
- confirmation before consequential changes;
- clear ownership and authorization records.

The business's website credentials or tokens must never be exposed to the AI model as ordinary conversation content.

## Existing NasrinAI foundations

NasrinAI already has architectural pieces that can support this direction, including:

- business/tenant isolation;
- business keys;
- allowed-origin controls;
- AI gateway;
- tool and connector infrastructure;
- authentication;
- SmartChat/chat orchestration;
- web access;
- business knowledge;
- configurable AI professionals.

NasrinAI Connect should build on these foundations rather than creating a separate AI platform.

## Product principle

**The customer sees one simple action. NasrinAI handles the complexity behind it.**

The desired experience is not:

> "Here is some code. Ask your developer to install it."

It is:

> "Enter your website, authorize NasrinAI, configure your AI, and tap Activate."

## Future direction

NasrinAI Connect can eventually support different installation paths while keeping the same customer experience:

- custom websites;
- custom web applications;
- managed hosting;
- CMS platforms;
- e-commerce platforms;
- deployment platforms;
- repositories;
- mobile applications where technically supported.

The installation mechanism may change, but the customer-facing workflow should remain consistent:

**Connect → Configure → Activate → Verify → Live**

## Non-goals

This feature is not intended to:

- secretly inject code into websites;
- bypass platform security;
- obtain unauthorized credentials;
- modify a website without owner authorization;
- require every customer to understand technical implementation;
- promise automatic installation on platforms that provide no authorized installation mechanism.

## Success criteria

The first production milestone should make the following possible:

1. A non-technical business owner enters their website URL.
2. NasrinAI verifies the website and authorization.
3. The owner configures their SmartChat/AI workforce.
4. The owner taps **Activate**.
5. NasrinAI selects an authorized installation path.
6. NasrinAI installs or provisions the integration.
7. NasrinAI verifies the result.
8. SmartChat becomes available on the business website.
9. The business can deactivate or remove the integration from NasrinAI.

The defining product metric is:

> **How little technical knowledge the business needs to successfully deploy NasrinAI.**


## Current implementation contract (2026-10-08)

Connect is now being built as an installation system, not merely a URL verifier. The core flow is:

**Discover → Authorize → Configure → Preview → Approve → Install → Verify → Activate**

### Installation safety gate

- Discovery never grants write permission.
- Installation requires explicit website authorization.
- Installation requires an explicit customer approval action.
- A provider adapter must perform the actual authorized write.
- The adapter must return a deployment/install receipt.
- The live website must be verified before Connect can mark the installation active.
- Failed verification triggers rollback when the provider supports it.
- If rollback fails, the installation is not reported as active and requires recovery.
- Unsupported provider methods fail closed; Connect never simulates success.

### Provider adapter contract

Providers are registered behind a central registry and must expose the capabilities needed for the requested operation, including:

- preview
- install
- verify
- rollback

Provider-specific integrations must not bypass tenant isolation, authorization, approval, or the central Connect lifecycle.

### Lifecycle

`discovered → verification_required → authorized → ready → installing → active`

Recovery and operations:

`installing → failed → ready`

`active → paused → ready`

`active/paused/failed → removed`

### Product standard

The customer should never be asked to understand JavaScript, npm, GitHub, API keys, backend configuration, or deployment internals when an authorized automated path exists. If automation is unavailable, Connect must explain the limitation clearly rather than pretending an installation succeeded.

### Documentation rule

`CLAUDE.md` and this document are living specifications. Any Connect implementation change must update both documents when it changes architecture, lifecycle, APIs, provider behavior, security guarantees, or customer experience.


## Current implementation contract (2026-10-08)

### SmartChat V1 runtime

The first customer-facing runtime now exists at `public/connect/smartchat.js`. It is designed for an eventual no-code activation flow and accepts only an **origin-locked publishable key**. It must never contain a secret business key, Supabase secret, provider credential, or installation credential.

The runtime obtains a guest session from `/v1/guest/sessions`. Connect guest tokens are now cryptographically bound to the requesting HTTPS origin; the gateway rejects a token presented from a different origin. The resulting guest caller has chat-only scope.

### Safety boundary

A public widget key does not authorize website modification. Website modification remains a separate Connect capability requiring explicit authorization and explicit installation approval. The widget is therefore a serving/runtime layer, not an installation mechanism.

### Delivery rule

Every Connect milestone must update this document and `CLAUDE.md`. Never describe an unimplemented provider or installation path as live.

### Server-side widget key provisioning

After website authorization, Connect can provision an origin-locked `nsp_` publishable key with chat scope. The key is created through the server's Supabase service connection; the browser never receives a secret business key. The activation endpoint returns only the publishable widget key and the authorized origin needed by the widget runtime.

The widget key does not grant website write access. Installation authorization and activation remain separate controls.
