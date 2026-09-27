# Roadmap

- [x] CI check: catch computed-property / bracket-notation console & process logging aliases
- [x] CI check fixture tests: shadowed console/process bindings — no false positives, no missed calls
- [x] CI check: optional-chaining console/process logging fixtures
- [x] Dependabot config for automated dependency update PRs
- [x] CI check: scan lockfile for known vulnerable dependency versions, fail when a fix is available
- [x] GitHub Actions workflow: run tests + lockfile scan on PRs and push to main
- [x] GitHub Actions workflow: weekly scheduled lockfile vulnerability scan
- [ ] Connect project to GitHub and create the repository (editor step), then create and verify the main ruleset requiring CI to pass before merging
- [ ] Re-run the deeper security review (Security tab) against the latest published changes
- [x] Visitor key screen: short guide on getting an OpenAI API key + OpenAI bills them directly
- [x] Fresh security scan of the published site; fix findings before sharing widely
- [x] Privacy page: visitor keys stay in browser, OpenAI bills visitors directly
- [x] Publish privacy page + visitor-key changes to the live site; verify in a fresh browser

