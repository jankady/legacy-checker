# Security

## Reporting a vulnerability

Please report security problems privately through GitHub: open the repository's
**Security** tab and choose **Report a vulnerability**. Do not open a public issue for a
vulnerability.

You can expect an acknowledgement within seven days. The project is maintained by one
person in their spare time; fixes are released as soon as they are ready, and you are
credited unless you ask not to be.

Only the latest release is supported.

## What Legacy Checker does with your data

Legacy Checker sits between a web application and its database, so it sees everything that passes:
request and response bodies, cookies, credentials, SQL text and parameters.

- **Recordings are raw and local.** The capture store under `.legacy-checker/` contains credentials
  and personal data. It is git-ignored by default. Do not share it and do not record
  production traffic.
- **Exports are redacted.** Text that leaves the tool (`inspect` output, the behaviour map,
  flow files) has known secret values replaced. Redaction works on rules and can miss a
  secret it has no rule for; review generated files before committing them.
- **Flow files contain response data** from the recorded database. Record against test data.
- **No telemetry.** Legacy Checker collects no usage data and opens no network connections other
  than the two upstreams you configure (the application and its database).
- **Replay sends real requests** and resets the database it is pointed at. Never point it at
  a production system.

## Scope

In scope: anything that makes Legacy Checker leak recorded data, alter traffic it relays, connect
somewhere it was not configured to, or execute something the user did not ask for.

Out of scope: weaknesses of the application under observation that Legacy Checker merely reveals.
