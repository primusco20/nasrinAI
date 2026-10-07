# Incident Response Runbook

## Purpose

This runbook is the operational procedure for suspected security incidents,
personal-information breaches, credential compromise, payment abuse, or
material service compromise affecting NasrinAI.

This is an engineering runbook, not legal advice. Notification deadlines and
legal duties must be confirmed against current requirements and the facts of
the incident.

## 1. Detect and record

Immediately create an incident record containing:

- UTC timestamp and person discovering the incident
- affected system/provider
- request IDs, deployment ID, relevant logs and error messages
- suspected data types and affected tenants/users

Do not copy passwords, API keys, access tokens, card data, or full private
messages into the incident record.

## 2. Contain

Depending on the incident:

1. Disable the affected feature or route.
2. Suspend an affected business tenant if abuse is isolated to that tenant.
3. Rotate compromised secrets immediately at their source.
4. Revoke affected business API keys.
5. Rotate GUEST_SESSION_SECRET if guest tokens may be compromised.
6. Rotate CONNECTOR_SECRET_KEY if connector secrets may be exposed.
7. Rotate provider/API credentials and webhook secrets when applicable.
8. Promote a known-good Vercel deployment if the application release is the
   suspected cause.

Preserve the evidence needed to understand scope before deleting logs or data.

## 3. Assess scope

Determine:

- what happened and when
- which systems were accessed
- which users/tenants were affected
- what personal information was involved
- whether credentials or payment information were exposed
- whether data was actually accessed, changed, disclosed, or only at risk
- whether a processor/provider was involved
- whether the incident is ongoing

For payment incidents, NasrinAI does not store card or e-wallet credentials;
PayMongo handles payment details.

## 4. Protect users

If account compromise is suspected:

- invalidate or rotate affected credentials
- revoke affected business keys
- require re-authentication where appropriate
- suspend abusive integrations
- provide affected users with practical protective steps

Do not disclose another person's private information while investigating.

## 5. Legal and privacy assessment

Notify the designated privacy/DPO contact and obtain qualified privacy/legal
assessment when personal information may be involved.

Assess whether notification to the Philippine National Privacy Commission,
affected individuals, customers, payment providers, or other authorities is
required. Do not assume a fixed deadline from this engineering document;
verify the current applicable rule and its exceptions.

If a processor such as Supabase, Vercel, OpenAI, Google, PayMongo, Meta, or an
email provider is involved, follow the applicable contractual/DPA incident
process as well.

## 6. Recovery

Before restoring normal operation:

- confirm compromised secrets are rotated
- confirm affected routes/features are protected
- deploy a reviewed fix
- run the relevant automated tests and red-team suite
- verify Supabase migrations and RLS remain correct
- verify scheduled retention still succeeds
- check logs for recurrence

## 7. Close and learn

Document:

- root cause
- timeline
- affected data/users
- containment and recovery actions
- notifications made and why
- permanent corrective actions
- owner and due date for each corrective action

Review the incident with the DPO/privacy lead and update this runbook and
security tests when the incident reveals a missing control.

## Production contacts

Keep these values current outside source code:

- Security/engineering owner: Nasrin Abubakar — confirm and maintain the operational designation before production launch.
- Data Protection Officer: dpo@nasrinai.com
- Privacy contact: contact@nasrinai.com
- Hosting: Vercel
- Database/Auth: Supabase
- Payments: PayMongo
