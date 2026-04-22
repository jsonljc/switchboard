# Dashboard Launch Cleanup

- Pricing disclaimer removed
- Public metadata assets added
- Dev-only UI kept out of production
- Test setup normalized for browser APIs
- `@anthropic-ai/sdk` remains in `apps/dashboard/package.json` because it is used by `src/app/(auth)/deploy/[slug]/actions.ts`
