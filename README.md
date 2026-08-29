# Psych Ops Source Watch — Regulatory Intelligence

A source registry and monitoring layer for state psilocybin regulation.

A monitor is only as good as its account of what it is watching. This one names
every endpoint it checks, states what that body actually controls, what a change
there would mean operationally, and what the monitor cannot see at all — including
an explicit section on the five different things a quiet sweep can mean, only one
of which justifies reassurance.

Six endpoints in three classes: three official state programmes (Oregon Psilocybin
Services, the Colorado Natural Medicine Program, the New Mexico Medical Psilocybin
Program), two field organisations, and one secondary trade-press class. The class
distinction is load-bearing: a state portal and a newsletter can publish the same
fact, but only one of them is the fact.

**Live:** https://psychops-intel.vercel.app

## Repository contents

`api`, `package.json`, `public`, `vercel.json`.

`api/source-policy.js` defines the monitored endpoints and the host and topic
filters. `public/index.html` carries the source dossiers as static HTML, so the
registry is readable with JavaScript off; the freshness banner, per-source
collection badges and discovered-candidate lists are the only parts that need it.

## Local development

```sh
npm ci
npm test
npm run build
```

## Deployment

Deployed on Vercel from `main`. Every push to `main` triggers a production build.
The sweep runs weekly on Mondays at 09:00 UTC.

## License

Apache-2.0 — see [LICENSE](LICENSE).
