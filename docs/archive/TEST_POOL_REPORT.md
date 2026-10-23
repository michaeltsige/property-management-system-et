# Test worker pool security fix

1. **Changed:** targeted `vitest>tinypool` override to 2.1.2, lockfile, four small
   worker regression tests wired into `pnpm test`. No production dependencies.
2. **Decision:** ADR-0028. Keep Vitest 3 and Node 20; test the major transitive
   override rather than upgrade the whole test framework. Revisit on Vitest upgrade.
3. **Risks:** three moderate and one high tooling findings remain. CI's existing
   critical threshold is unchanged; no audit suppression. Override is scoped to Vitest.
4. **Verified locally:** `pnpm test` passes 231 existing + 4 worker regression tests;
   `pnpm audit --audit-level=critical` exits 0. New tests cover inherited options
   and worker recycling in both supported runtimes. Full CI remains authoritative
   for the build, typecheck, lint and clean-clone smoke checks.
5. **Next:** merge this security fix, rebase and verify the owner hierarchy PR,
   then proceed with its UI slice. No browser smoke suite added here.
