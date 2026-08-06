<!-- 
PR TITLE CONVENTION:
Please format your PR title using Conventional Commits:
  <type>(<scope>): <short summary>

Examples:
  feat(web): add wish history filter by rarity
  fix(api): invalidate feature flags cache on write
  chore(deps): update bun dependencies
  docs: update setup instructions in README

Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore
Scopes: web, api, shared, game-scripts
-->

## Description

<!-- Provide a brief description of the changes introduced by this PR. -->

## Related Issues

<!-- Link any related issues here (e.g., Closes #123, Fixes #456) -->

## Affected Packages

- [ ] `apps/web`
- [ ] `apps/api`
- [ ] `packages/shared`
- [ ] `packages/game-scripts`
- [ ] Other / Root

## How Has This Been Tested?

<!-- Describe the tests you ran to verify your changes. Provide instructions to reproduce or attach screenshots/videos for UI updates. -->

- [ ] Unit / Integration Tests (`bun test`)
- [ ] Type Checking & Linting (`bun run typecheck`, `bun run lint`)
- [ ] Manual testing (UI / API verification)

## Screenshots / Visual Changes (if applicable)

<!-- Add before/after screenshots or screen recordings if this PR affects the UI. -->

## Checklist

- [ ] My PR title follows Conventional Commits: `type(scope): description` (e.g. `feat(web): ...`).
- [ ] My code follows the code style and conventions of this project.
- [ ] I have performed a self-review of my own code.
- [ ] My changes generate no new warnings or errors.
- [ ] New and existing tests pass locally with my changes.
