# Roadmap

- [x] CI check: catch computed-property / bracket-notation console & process logging aliases
- [x] CI check fixture tests: shadowed console/process bindings — no false positives, no missed calls
- [x] CI check: optional-chaining console/process logging fixtures
- [x] Dependabot config for automated dependency update PRs
- [x] CI check: scan lockfile for known vulnerable dependency versions, fail when a fix is available
- [x] GitHub Actions workflow: run tests + lockfile scan on PRs and push to main
- [x] GitHub Actions workflow: weekly scheduled lockfile vulnerability scan
- [ ] GitHub ruleset: require CI workflow to pass before merging PRs (blocked: no GitHub connection / repo linked yet)
