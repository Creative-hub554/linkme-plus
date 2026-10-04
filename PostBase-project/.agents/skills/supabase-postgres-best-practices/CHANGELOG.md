# Changelog

## Local modifications (not upstream)

Added by this repository, not by Supabase; an upstream refresh of this skill will not contain it.

### Features

* generate a complete per-category rule index in `SKILL.md` from the reference files — each category's rules ordered by their front-matter impact level, most impactful first (CRITICAL, HIGH, …, anything unranked last) with the file name as the tiebreak — via `npm run skill:index` and the shared `.freebuff/skill-index.mjs`

The index is generated, not hand-written, and lives between the `<!-- rule-index:start -->` and `<!-- rule-index:end -->` markers in `SKILL.md`. Regenerate it after adding, renaming or retitling a rule. `src/test/skill-index.test.ts` and `src/test/skill-categories.test.ts` fail if the index or the category classification drifts — including if an upstream refresh drops the markers — so the local addition cannot be lost quietly.

## [1.6.0](https://github.com/supabase/agent-skills/compare/supabase-postgres-best-practices-v1.5.0...supabase-postgres-best-practices-v1.6.0) (2026-07-30)


### Features

* add schema-constraints reference for safe migration patterns ([#30](https://github.com/supabase/agent-skills/issues/30)) ([9b236f3](https://github.com/supabase/agent-skills/commit/9b236f3ebd65d76a2c570f19931353da9c858d5a))
* using Supabase agent skills ([#12](https://github.com/supabase/agent-skills/issues/12)) ([7c2e389](https://github.com/supabase/agent-skills/commit/7c2e3894fddfde8eb6c77d2a8921904543b9be7a))


### Bug Fixes

* correct broken reference link in postgres best practices skill ([#58](https://github.com/supabase/agent-skills/issues/58)) ([f4e2277](https://github.com/supabase/agent-skills/commit/f4e22777fd8573537297b568c16e5a45a25927da))
* cover SECURITY DEFINER, auth.role() deprecation, and BOLA in security checklist ([#85](https://github.com/supabase/agent-skills/issues/85)) ([133f43e](https://github.com/supabase/agent-skills/commit/133f43e8c2ffc48823ff0630c692cabecea3e3a3))
* **supabase-postgres-best-practices:** make skill description trigger-rich ([#194](https://github.com/supabase/agent-skills/issues/194)) ([3291216](https://github.com/supabase/agent-skills/commit/32912161e2732c3e5001c6811a76c1f8308ed0da))

## [1.5.0](https://github.com/supabase/agent-skills/compare/supabase-postgres-best-practices-v1.4.0...supabase-postgres-best-practices-v1.5.0) (2026-07-30)


### Features

* add schema-constraints reference for safe migration patterns ([#30](https://github.com/supabase/agent-skills/issues/30)) ([9b236f3](https://github.com/supabase/agent-skills/commit/9b236f3ebd65d76a2c570f19931353da9c858d5a))
* using Supabase agent skills ([#12](https://github.com/supabase/agent-skills/issues/12)) ([7c2e389](https://github.com/supabase/agent-skills/commit/7c2e3894fddfde8eb6c77d2a8921904543b9be7a))


### Bug Fixes

* correct broken reference link in postgres best practices skill ([#58](https://github.com/supabase/agent-skills/issues/58)) ([f4e2277](https://github.com/supabase/agent-skills/commit/f4e22777fd8573537297b568c16e5a45a25927da))
* cover SECURITY DEFINER, auth.role() deprecation, and BOLA in security checklist ([#85](https://github.com/supabase/agent-skills/issues/85)) ([133f43e](https://github.com/supabase/agent-skills/commit/133f43e8c2ffc48823ff0630c692cabecea3e3a3))
* **supabase-postgres-best-practices:** make skill description trigger-rich ([#194](https://github.com/supabase/agent-skills/issues/194)) ([3291216](https://github.com/supabase/agent-skills/commit/32912161e2732c3e5001c6811a76c1f8308ed0da))

## [1.4.0](https://github.com/supabase/agent-skills/compare/v1.3.0...v1.4.0) (2026-07-10)


### Features

* add schema-constraints reference for safe migration patterns ([#30](https://github.com/supabase/agent-skills/issues/30)) ([9b236f3](https://github.com/supabase/agent-skills/commit/9b236f3ebd65d76a2c570f19931353da9c858d5a))
* using Supabase agent skills ([#12](https://github.com/supabase/agent-skills/issues/12)) ([7c2e389](https://github.com/supabase/agent-skills/commit/7c2e3894fddfde8eb6c77d2a8921904543b9be7a))


### Bug Fixes

* correct broken reference link in postgres best practices skill ([#58](https://github.com/supabase/agent-skills/issues/58)) ([f4e2277](https://github.com/supabase/agent-skills/commit/f4e22777fd8573537297b568c16e5a45a25927da))
* cover SECURITY DEFINER, auth.role() deprecation, and BOLA in security checklist ([#85](https://github.com/supabase/agent-skills/issues/85)) ([133f43e](https://github.com/supabase/agent-skills/commit/133f43e8c2ffc48823ff0630c692cabecea3e3a3))

## [1.3.0](https://github.com/supabase/agent-skills/compare/v1.2.0...v1.3.0) (2026-06-05)


### Features

* add schema-constraints reference for safe migration patterns ([#30](https://github.com/supabase/agent-skills/issues/30)) ([9b236f3](https://github.com/supabase/agent-skills/commit/9b236f3ebd65d76a2c570f19931353da9c858d5a))
* using Supabase agent skills ([#12](https://github.com/supabase/agent-skills/issues/12)) ([7c2e389](https://github.com/supabase/agent-skills/commit/7c2e3894fddfde8eb6c77d2a8921904543b9be7a))


### Bug Fixes

* correct broken reference link in postgres best practices skill ([#58](https://github.com/supabase/agent-skills/issues/58)) ([f4e2277](https://github.com/supabase/agent-skills/commit/f4e22777fd8573537297b568c16e5a45a25927da))
* cover SECURITY DEFINER, auth.role() deprecation, and BOLA in security checklist ([#85](https://github.com/supabase/agent-skills/issues/85)) ([133f43e](https://github.com/supabase/agent-skills/commit/133f43e8c2ffc48823ff0630c692cabecea3e3a3))

## [1.2.0](https://github.com/supabase/agent-skills/compare/v1.1.1...v1.2.0) (2026-06-02)


### Features

* add schema-constraints reference for safe migration patterns ([#30](https://github.com/supabase/agent-skills/issues/30)) ([9b236f3](https://github.com/supabase/agent-skills/commit/9b236f3ebd65d76a2c570f19931353da9c858d5a))
* using Supabase agent skills ([#12](https://github.com/supabase/agent-skills/issues/12)) ([7c2e389](https://github.com/supabase/agent-skills/commit/7c2e3894fddfde8eb6c77d2a8921904543b9be7a))


### Bug Fixes

* correct broken reference link in postgres best practices skill ([#58](https://github.com/supabase/agent-skills/issues/58)) ([f4e2277](https://github.com/supabase/agent-skills/commit/f4e22777fd8573537297b568c16e5a45a25927da))
* cover SECURITY DEFINER, auth.role() deprecation, and BOLA in security checklist ([#85](https://github.com/supabase/agent-skills/issues/85)) ([133f43e](https://github.com/supabase/agent-skills/commit/133f43e8c2ffc48823ff0630c692cabecea3e3a3))
