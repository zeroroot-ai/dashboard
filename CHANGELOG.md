# Changelog

All notable changes to the Gibson Dashboard are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.109.0](https://github.com/zero-day-ai/dashboard/compare/v0.108.0...v0.109.0) (2026-05-26)


### Features

* **crd:** migrate access/role/ownership/install actions to userClient(TenantAdminService) ([#362](https://github.com/zero-day-ai/dashboard/issues/362)) ([05a0488](https://github.com/zero-day-ai/dashboard/commit/05a0488031239cd16cb69a78657676ba424765b3))
* **landing:** update H1 to "Zero Trust agent factory in under an hour" ([#388](https://github.com/zero-day-ai/dashboard/issues/388)) ([77c4d85](https://github.com/zero-day-ai/dashboard/commit/77c4d85c742f03c4c3b0ff9272d4fbfdb06d4c71))
* **missions/create:** stay on page after Run Mission; show result in terminal ([#390](https://github.com/zero-day-ai/dashboard/issues/390)) ([c99a043](https://github.com/zero-day-ai/dashboard/commit/c99a04365eff35b28dd4332bbc2e3768e71613e9))
* **missions/create:** useMissionTerminal hook — live SSE status and tool events ([#391](https://github.com/zero-day-ai/dashboard/issues/391)) ([3350306](https://github.com/zero-day-ai/dashboard/commit/3350306cb8c2b4a0f1ea41a8b95f2076da6a93a0)), closes [#384](https://github.com/zero-day-ai/dashboard/issues/384)
* **missions:** MissionTerminal component — xterm.js shell with resize and collapse ([#387](https://github.com/zero-day-ai/dashboard/issues/387)) ([a8b5aa5](https://github.com/zero-day-ai/dashboard/commit/a8b5aa55d8090aa513678a566eebad2f3230b8e4))
* **missions:** replace Logs tab placeholder with MissionTerminal snapshot view ([#389](https://github.com/zero-day-ai/dashboard/issues/389)) ([825b348](https://github.com/zero-day-ai/dashboard/commit/825b3484cb9d61c1a9c81b03dd319ac4fb38e604))
* **missions:** restore mission clone via CUE source path ([#354](https://github.com/zero-day-ai/dashboard/issues/354)) ([46a9100](https://github.com/zero-day-ai/dashboard/commit/46a91006e1ed577160cc4650c2a3dd24615fc478))
* **missions:** wire CUE submit path — ValidateMissionCUE now returns compiled definition ([#351](https://github.com/zero-day-ai/dashboard/issues/351)) ([397c2ad](https://github.com/zero-day-ai/dashboard/commit/397c2adefd886665b9388dbc54d201a27234c78b))
* **onboarding:** use RevealableInput for LLM API key field ([#374](https://github.com/zero-day-ai/dashboard/issues/374)) ([1803aab](https://github.com/zero-day-ai/dashboard/commit/1803aab398cdef75cdc53d7f24725f964d475a3c))
* **providers:** use RevealableInput for PASSWORD-type credential fields ([#373](https://github.com/zero-day-ai/dashboard/issues/373)) ([3564df1](https://github.com/zero-day-ai/dashboard/commit/3564df122674640735840dd61485e455c533fa47))
* **secrets-backend:** use RevealableInput for sensitive credential fields ([#375](https://github.com/zero-day-ai/dashboard/issues/375)) ([1c769e8](https://github.com/zero-day-ai/dashboard/commit/1c769e870c0352bea18b7b0055eafa2932aecc8e))
* **secrets:** use RevealableInput for secret value and rotation fields ([#371](https://github.com/zero-day-ai/dashboard/issues/371)) ([01e5412](https://github.com/zero-day-ai/dashboard/commit/01e5412c36caf257e37ac2c19d22738b1fa10033))
* **teams:** migrate team CRD actions to userClient(TenantAdminService) ([#361](https://github.com/zero-day-ai/dashboard/issues/361)) ([0e594f8](https://github.com/zero-day-ai/dashboard/commit/0e594f8a33c0a0ea31c882ea2f94da02c10fce89))
* **ui:** add RevealableInput component with eye-toggle for password fields ([#370](https://github.com/zero-day-ai/dashboard/issues/370)) ([cd01b39](https://github.com/zero-day-ai/dashboard/commit/cd01b397a279a79097020863206b11c908c5fdd7))


### Bug Fixes

* **missions/create:** two-row toolbar so Run Mission button is always visible ([#386](https://github.com/zero-day-ai/dashboard/issues/386)) ([c895748](https://github.com/zero-day-ai/dashboard/commit/c895748fe47449a56c235e461766c35d03764027))
* **missions:** wrap DEFAULT_CUE and scaffoldCUE under mission: {} field ([#377](https://github.com/zero-day-ai/dashboard/issues/377)) ([e7aa080](https://github.com/zero-day-ai/dashboard/commit/e7aa080ab4fb01dacc7fd8fbf8524b556c2a1bd1))
* **providers:** correct fallback-chain API client URL ([#393](https://github.com/zero-day-ai/dashboard/issues/393)) ([6241c2e](https://github.com/zero-day-ai/dashboard/commit/6241c2e00dbb521f141eae827d01482d7c5a516d)), closes [#392](https://github.com/zero-day-ai/dashboard/issues/392)
* redirect to sign-in when session carries opaque (non-JWT) access token ([#360](https://github.com/zero-day-ai/dashboard/issues/360)) ([79e1795](https://github.com/zero-day-ai/dashboard/commit/79e179569c01d0d37b764c57f484293c599efb32))
* remove export type re-exports from use server files (Turbopack crash) ([#356](https://github.com/zero-day-ai/dashboard/issues/356)) ([1f17441](https://github.com/zero-day-ai/dashboard/commit/1f17441c561270dd2ede239296e2b159daa6e072))

## [0.108.0](https://github.com/zero-day-ai/dashboard/compare/v0.107.0...v0.108.0) (2026-05-24)


### Features

* **settings:** member picker and Members settings page ([#348](https://github.com/zero-day-ai/dashboard/issues/348)) ([69b9951](https://github.com/zero-day-ai/dashboard/commit/69b99513b07e0433f5697899c9984b0aef5fdda5))


### Bug Fixes

* **ci:** add path filter to PR image builds ([#345](https://github.com/zero-day-ai/dashboard/issues/345)) ([bc99821](https://github.com/zero-day-ai/dashboard/commit/bc998214a67a7206c20c90e8d355ff24cb8c7a24))
* **ci:** remove PR trigger and use security-extended for CodeQL ([#346](https://github.com/zero-day-ai/dashboard/issues/346)) ([69dcb1a](https://github.com/zero-day-ai/dashboard/commit/69dcb1aa55086194c8d43a0203a2303b3c43adb3))
* **docs:** move docs pages from src/app/ to app/ — Next.js ignores src/app when app/ exists ([#338](https://github.com/zero-day-ai/dashboard/issues/338)) ([acffd04](https://github.com/zero-day-ai/dashboard/commit/acffd046d40b4c5bbb1b6a26ac9b5b3fcb208e56))
* **prebuild:** skip check-auth-rbac-inventory-fresh when enterprise/docs absent ([#349](https://github.com/zero-day-ai/dashboard/issues/349)) ([3d021de](https://github.com/zero-day-ai/dashboard/commit/3d021de4e4991364a477926a3f79c74b4a0c9f6f))
* **settings:** profile name/email, billing errors, and nav overhaul ([#344](https://github.com/zero-day-ai/dashboard/issues/344)) ([c395364](https://github.com/zero-day-ai/dashboard/commit/c3953643ef870e8034ac3a5fd991bb0441cb160f))
* **tests:** update stale ProvidersContent tests for ProviderWizard refactor ([#341](https://github.com/zero-day-ai/dashboard/issues/341)) ([c77c10d](https://github.com/zero-day-ai/dashboard/commit/c77c10dc450cd883264a52ba66210279a05b9b41))

## [0.107.0](https://github.com/zero-day-ai/dashboard/compare/v0.106.0...v0.107.0) (2026-05-24)


### Features

* **dashboard:** migrate PlatformOperatorService → DaemonOperatorService; drop daemon/admin + tenant_admin gen ([#337](https://github.com/zero-day-ai/dashboard/issues/337)) ([045ab8f](https://github.com/zero-day-ai/dashboard/commit/045ab8fca00456c524be8057fca04ac76d5358c3))
* **missions/create:** DefinitionPickerDropdown + ?definition= hydration ([#323](https://github.com/zero-day-ai/dashboard/issues/323)) ([#331](https://github.com/zero-day-ai/dashboard/issues/331)) ([7765af7](https://github.com/zero-day-ai/dashboard/commit/7765af742fb627042b6ef4110ff46a60708f7037))
* **missions/create:** DefinitionPickerDropdown component ([#322](https://github.com/zero-day-ai/dashboard/issues/322)) ([#330](https://github.com/zero-day-ai/dashboard/issues/330)) ([cf1cfa2](https://github.com/zero-day-ai/dashboard/commit/cf1cfa22f04028d0d3f41b72362bff58910515aa))
* **missions/create:** replace localStorage autosave with useServerAutosave, upsert draft on run ([#325](https://github.com/zero-day-ai/dashboard/issues/325)) ([#329](https://github.com/zero-day-ai/dashboard/issues/329)) ([c309898](https://github.com/zero-day-ai/dashboard/commit/c3098986225a37ad8da51c371c5a4056d1856bea))
* **missions:** definition list API route and useListMissionDefinitions hook ([#327](https://github.com/zero-day-ai/dashboard/issues/327)) ([0bb5ada](https://github.com/zero-day-ai/dashboard/commit/0bb5adad299938bb3178354a27fcac991894d260))
* **missions:** edit definition button on missions list ([#324](https://github.com/zero-day-ai/dashboard/issues/324)) ([#332](https://github.com/zero-day-ai/dashboard/issues/332)) ([6527277](https://github.com/zero-day-ai/dashboard/commit/6527277b2101428e13d7b8d843d0fe28cc58261a))
* **missions:** expose missionDefinitionId on missions API and Mission type ([#326](https://github.com/zero-day-ai/dashboard/issues/326)) ([c380f13](https://github.com/zero-day-ai/dashboard/commit/c380f13e869b1c3b380987010a04014aa0e81d5e))
* **missions:** useServerAutosave hook — daemon-backed draft autosave ([#328](https://github.com/zero-day-ai/dashboard/issues/328)) ([2a1951d](https://github.com/zero-day-ai/dashboard/commit/2a1951db51ed70c416d908d8416701137ed90fdd))


### Bug Fixes

* **missions/editor:** set explicit height so Monaco renders above 0px ([#316](https://github.com/zero-day-ai/dashboard/issues/316)) ([ca48c89](https://github.com/zero-day-ai/dashboard/commit/ca48c89f837fd9c6d480d2b5e4d70d872acdbc23))
* **missions:** correct FGA path for createMissionFromCUEAction authz check ([#334](https://github.com/zero-day-ai/dashboard/issues/334)) ([b57f6c0](https://github.com/zero-day-ai/dashboard/commit/b57f6c0e7cd441ef7a9c40c57d55a471cf1688dd))
* remove dead ActionResult re-export from use server file ([#333](https://github.com/zero-day-ai/dashboard/issues/333)) ([54bf61d](https://github.com/zero-day-ai/dashboard/commit/54bf61d7ea8cfeebc33998771d27f52490981be2))

## [0.106.0](https://github.com/zero-day-ai/dashboard/compare/v0.105.0...v0.106.0) (2026-05-24)


### Features

* add pnpm audit security workflow ([#256](https://github.com/zero-day-ai/dashboard/issues/256)) ([5736227](https://github.com/zero-day-ai/dashboard/commit/57362274a9258f1f358dbb86c7fbe53ca39c43dc))
* **missions/templates:** vendor .cue sources; delete JSON; drift gate; CUE preview ([#311](https://github.com/zero-day-ai/dashboard/issues/311)) ([657a3c3](https://github.com/zero-day-ai/dashboard/commit/657a3c37008722585fc477148277dbcc31549a4b))
* **missions:** move create page to src/app; delete API route; add ?template= support ([#308](https://github.com/zero-day-ai/dashboard/issues/308)) ([99ac65c](https://github.com/zero-day-ai/dashboard/commit/99ac65c21c453702b0320d590af36c83c57c29d3))
* **missions:** replace Monaco YAML editor with CUE editor; delete YAML layer ([#307](https://github.com/zero-day-ai/dashboard/issues/307)) ([b9621f3](https://github.com/zero-day-ai/dashboard/commit/b9621f3f3f60e22e3473f543f0cab05e80f1f497))
* **providers:** credentialsMasked multi-field display + delete validateApiKeyFormat ([#303](https://github.com/zero-day-ai/dashboard/issues/303)) ([1948f14](https://github.com/zero-day-ai/dashboard/commit/1948f147022d26ae85e41a137e5193302a822eb4)), closes [#284](https://github.com/zero-day-ai/dashboard/issues/284)
* **providers:** edit credential flow — PATCH without delete-and-recreate ([#300](https://github.com/zero-day-ai/dashboard/issues/300)) ([de3f3ab](https://github.com/zero-day-ai/dashboard/commit/de3f3ab810025d4eed255d41fd002f8dd9578877))
* **providers:** FallbackChainEditor drag-to-reorder ([#296](https://github.com/zero-day-ai/dashboard/issues/296)) ([d1f3316](https://github.com/zero-day-ai/dashboard/commit/d1f33169798841c900ca294b4c9c23faabda90de))
* **providers:** health badge auto-polling on provider card ([#297](https://github.com/zero-day-ai/dashboard/issues/297)) ([e244f62](https://github.com/zero-day-ai/dashboard/commit/e244f624b58c84f451f947ab8789b38838da4a5a))
* **users:** pending invite controls — expiry display, resend, cancel ([#269](https://github.com/zero-day-ai/dashboard/issues/269)) ([4097999](https://github.com/zero-day-ai/dashboard/commit/409799915175d380a8440d9689e2f3e12daf4eca)), closes [#265](https://github.com/zero-day-ai/dashboard/issues/265)
* **users:** rebuild user detail page — remove IdP link, surface all user actions ([#274](https://github.com/zero-day-ai/dashboard/issues/274)) ([bd78d5e](https://github.com/zero-day-ai/dashboard/commit/bd78d5e14d88518e35515b90782d196b539d8e6f)), closes [#268](https://github.com/zero-day-ai/dashboard/issues/268)
* **users:** transferOwnershipAction + UI entry point on user detail page ([#273](https://github.com/zero-day-ai/dashboard/issues/273)) ([6f866a8](https://github.com/zero-day-ai/dashboard/commit/6f866a8f9eb2d3846e41d0921cf1be942fd2eba7)), closes [#266](https://github.com/zero-day-ai/dashboard/issues/266)
* **wizard:** add Bedrock IRSA toggle to provider credential UI ([#298](https://github.com/zero-day-ai/dashboard/issues/298)) ([5ba4e3c](https://github.com/zero-day-ai/dashboard/commit/5ba4e3c284873a47bfa3d0abc10bfc15db1ba801))
* **wizard:** decouple step-3 from probe success — test becomes advisory ([#304](https://github.com/zero-day-ai/dashboard/issues/304)) ([3d0c6e3](https://github.com/zero-day-ai/dashboard/commit/3d0c6e34a2da80664922c1d697409d38c32dd644)), closes [#288](https://github.com/zero-day-ai/dashboard/issues/288)
* **wizard:** deprecated model display in catalogue picker ([#305](https://github.com/zero-day-ai/dashboard/issues/305)) ([5bcc0f7](https://github.com/zero-day-ai/dashboard/commit/5bcc0f7a9554b7cc5dc229d11ec9cc5b27688331))
* **wizard:** URL-typed credential fields + OpenAI-compatible guidance + SSRF hint ([#299](https://github.com/zero-day-ai/dashboard/issues/299)) ([4d27655](https://github.com/zero-day-ai/dashboard/commit/4d2765580ee495a19640248a6779fc7b5961cac5)), closes [#286](https://github.com/zero-day-ai/dashboard/issues/286)


### Bug Fixes

* **authz:** add owner tier to relation-hierarchy satisfiesRelation ([#276](https://github.com/zero-day-ai/dashboard/issues/276)) ([263173d](https://github.com/zero-day-ai/dashboard/commit/263173d01ba1c90bf350e64a7cb2e3601365102a)), closes [#275](https://github.com/zero-day-ai/dashboard/issues/275)
* **authz:** derive permissions from FGA role when schema is empty ([#277](https://github.com/zero-day-ai/dashboard/issues/277)) ([8a4326c](https://github.com/zero-day-ai/dashboard/commit/8a4326cf23999ac42372bb449ec3173dfd754da6))
* **ci:** add actions:read to dashboard.yml permissions — fixes startup_failure ([#279](https://github.com/zero-day-ai/dashboard/issues/279)) ([ef4f3b5](https://github.com/zero-day-ai/dashboard/commit/ef4f3b517e8160df7e300c9a9e47a9e2d3c38238))
* **deps:** remove unused swiper dep (critical CVE GHSA-hmx5-qpq5-p643) ([#261](https://github.com/zero-day-ai/dashboard/issues/261)) ([c83cfdc](https://github.com/zero-day-ai/dashboard/commit/c83cfdc27b850fab57f7bec7f6cdb8823a536811))
* **invite:** remove viewer from invite role options ([#270](https://github.com/zero-day-ai/dashboard/issues/270)) ([2310646](https://github.com/zero-day-ai/dashboard/commit/231064649cb8f4cf1efd8ab86e54e05f264df396)), closes [#264](https://github.com/zero-day-ai/dashboard/issues/264)
* **missions/drafts:** hard-cutover localStorage + JSDoc from yaml to cueSource ([#312](https://github.com/zero-day-ai/dashboard/issues/312)) ([d44ce97](https://github.com/zero-day-ai/dashboard/commit/d44ce97f6bfb62b787fcd0d462117667d62ef8de))
* **missions/editor:** configure MonacoEnvironment.getWorker to unfreeze CUE editor ([#315](https://github.com/zero-day-ai/dashboard/issues/315)) ([9c24036](https://github.com/zero-day-ai/dashboard/commit/9c24036a8e9ecdbf8a71a30e901fe18d69d131cd))
* **missions:** move create+templates pages from src/app to app directory ([#313](https://github.com/zero-day-ai/dashboard/issues/313)) ([7720c88](https://github.com/zero-day-ai/dashboard/commit/7720c881e61ce5e5145d2997d0690230de6d11e8))
* **providers:** switch GetSupportedProviders route to member-accessible client ([#295](https://github.com/zero-day-ai/dashboard/issues/295)) ([5a97595](https://github.com/zero-day-ai/dashboard/commit/5a97595e76aa4e02994a28350f7b939be1c7a496)), closes [#285](https://github.com/zero-day-ai/dashboard/issues/285)
* **ui:** swap sidebar icons — single person for users, group for teams ([#290](https://github.com/zero-day-ai/dashboard/issues/290)) ([027a8b2](https://github.com/zero-day-ai/dashboard/commit/027a8b260a97ad3992054d106794676fab17a5c2))
* **users:** owner removal safeguard — UI gate + server-layer last-owner check ([#272](https://github.com/zero-day-ai/dashboard/issues/272)) ([43742ca](https://github.com/zero-day-ai/dashboard/commit/43742ca11bd941528cb8438bceebbe1bdd13ddfc)), closes [#267](https://github.com/zero-day-ai/dashboard/issues/267)
* **users:** owner role badge and row protection in user list ([#271](https://github.com/zero-day-ai/dashboard/issues/271)) ([7bbb29d](https://github.com/zero-day-ai/dashboard/commit/7bbb29d77980d5455b164543b41147d40b906a4f)), closes [#263](https://github.com/zero-day-ai/dashboard/issues/263)
* **ux:** surface provisioning state instead of opaque 412 ([#306](https://github.com/zero-day-ai/dashboard/issues/306)) ([f601616](https://github.com/zero-day-ai/dashboard/commit/f601616eb7bd59c582c95d606d6883b582c0c546)), closes [#260](https://github.com/zero-day-ai/dashboard/issues/260)

## [0.105.0](https://github.com/zero-day-ai/dashboard/compare/v0.104.0...v0.105.0) (2026-05-20)


### ⚠ BREAKING CHANGES

* drop MissionConstraints bridge mapping; emit SDK type directly (M2-dashboard) ([#196](https://github.com/zero-day-ai/dashboard/issues/196))

### Features

* add 2 ts ast walkers for server-action + hook-shape contracts (slice 3.8) ([#236](https://github.com/zero-day-ai/dashboard/issues/236)) ([7f53505](https://github.com/zero-day-ai/dashboard/commit/7f5350576cc81527c09414c858ff29cac85b5264))
* add 4 custom eslint rules + strict typescript additions (slice 2.3) ([#234](https://github.com/zero-day-ai/dashboard/issues/234)) ([51a3ace](https://github.com/zero-day-ai/dashboard/commit/51a3ace9e956168843440485ab2941faad7cd2f4))
* add mission start route wrapping RunMission/ResumeMission ([#243](https://github.com/zero-day-ai/dashboard/issues/243)) ([4bb551f](https://github.com/zero-day-ai/dashboard/commit/4bb551f66cb489d29d7bb18d085e5f3e157a42f6))
* add Traces tab to mission-detail page ([#245](https://github.com/zero-day-ai/dashboard/issues/245)) ([21c4db4](https://github.com/zero-day-ai/dashboard/commit/21c4db491b96f0777c3847f84c4a32419cc99e10))
* consume daemonadminservice from platform-sdk ([#249](https://github.com/zero-day-ai/dashboard/issues/249)) ([7d5419a](https://github.com/zero-day-ai/dashboard/commit/7d5419a38688f7225c48f94c6ccaf2d1c63d8468))
* **dashboard:** EmptyState sweep across 7 list pages — PRD [#143](https://github.com/zero-day-ai/dashboard/issues/143) trailing child ([#191](https://github.com/zero-day-ai/dashboard/issues/191)) ([8e8b540](https://github.com/zero-day-ai/dashboard/commit/8e8b540eb621c216c816d592199538aa11bca841))
* drop MissionConstraints bridge mapping; emit SDK type directly (M2-dashboard) ([#196](https://github.com/zero-day-ai/dashboard/issues/196)) ([d9d53ab](https://github.com/zero-day-ai/dashboard/commit/d9d53ab4353cd998e4d4c580dc57e149b8c95cf8)), closes [#186](https://github.com/zero-day-ai/dashboard/issues/186)
* mission detail surfaces all author-facing fields (M6) ([#200](https://github.com/zero-day-ai/dashboard/issues/200)) ([0fb7828](https://github.com/zero-day-ai/dashboard/commit/0fb78282d5512d87f60840f30368c38a6f214166)), closes [#187](https://github.com/zero-day-ai/dashboard/issues/187)
* one-click demo mission targeting scanme.nmap.org ([#246](https://github.com/zero-day-ai/dashboard/issues/246)) ([d89217d](https://github.com/zero-day-ai/dashboard/commit/d89217d6851fa05645428e45ee2dc08b3fd2fa41))
* subsume brand-guide design system across dashboard ([#248](https://github.com/zero-day-ai/dashboard/issues/248)) ([487bee3](https://github.com/zero-day-ai/dashboard/commit/487bee3011ccb0cad4f367e8a67c54f9a894294d))
* wire mission-detail Findings tab to real data ([#244](https://github.com/zero-day-ai/dashboard/issues/244)) ([947b085](https://github.com/zero-day-ai/dashboard/commit/947b085c06ec30e7672774e8a31b6c93a7c470e5))


### Bug Fixes

* **auth:** set authjs.callback-url cookie in signup auto-login handoff ([#208](https://github.com/zero-day-ai/dashboard/issues/208)) ([b0fae0c](https://github.com/zero-day-ai/dashboard/commit/b0fae0c9c121526835f64dc5f2580951a0ba3adb))
* **ci:** disable anchore/sbom-action release-asset upload ([#185](https://github.com/zero-day-ai/dashboard/issues/185)) ([0c4f983](https://github.com/zero-day-ai/dashboard/commit/0c4f983336e521ceeb42270506b8b74edaa3e076))
* dashboard worktree green — gen-plans.mjs worktree-aware + pnpm patchedDependencies ([#195](https://github.com/zero-day-ai/dashboard/issues/195)) ([5d43e28](https://github.com/zero-day-ai/dashboard/commit/5d43e28e55297c1cc1f4c79338f3d0955d72736c))
* **eslint:** extend next/typescript so [@typescript-eslint](https://github.com/typescript-eslint) plugin rules load ([#198](https://github.com/zero-day-ai/dashboard/issues/198)) ([#203](https://github.com/zero-day-ai/dashboard/issues/203)) ([8d2aa03](https://github.com/zero-day-ai/dashboard/commit/8d2aa032c71c9c071d12dc3c4ee3e1f988576dad))
* **landing:** replace 'langfuse' vendor name in HeroSection ASCII terminal mock ([#192](https://github.com/zero-day-ai/dashboard/issues/192)) ([7b80487](https://github.com/zero-day-ai/dashboard/commit/7b8048782d705808c161167fb34fcb96b43e31cb))
* **lint:** resolve all 58 ESLint errors exposed by [#203](https://github.com/zero-day-ai/dashboard/issues/203) plugin fix ([#206](https://github.com/zero-day-ai/dashboard/issues/206)) ([5c94561](https://github.com/zero-day-ai/dashboard/commit/5c945616eee370c6f2d8fdbada6045c3df3548bb))
* **parser:** empty YAML succeeds with null; serialize trims trailing newline ([#194](https://github.com/zero-day-ai/dashboard/issues/194)) ([#204](https://github.com/zero-day-ai/dashboard/issues/204)) ([7a6ebdf](https://github.com/zero-day-ai/dashboard/commit/7a6ebdf7b13fd8650e744f5d953169e14e564b12))
* post-signup redirect lands on / instead of /dashboard ([#230](https://github.com/zero-day-ai/dashboard/issues/230)) ([156dad4](https://github.com/zero-day-ai/dashboard/commit/156dad48d119b7c5a0385b935daf3f43dd99168f))
* **routing:** drop tenant slug from /api/findings + /api/missions URL params ([#210](https://github.com/zero-day-ai/dashboard/issues/210)) ([62c3417](https://github.com/zero-day-ai/dashboard/commit/62c3417d8edeaa8fa30548c1df3b0b2b20d4cb9c))
* **routing:** drop tenant slug from client URLs (Phase 1 of [#209](https://github.com/zero-day-ai/dashboard/issues/209)) ([#211](https://github.com/zero-day-ai/dashboard/issues/211)) ([9115492](https://github.com/zero-day-ai/dashboard/commit/9115492859ccc90f9d94db6ef9589fd14a35e9df))
* **scripts:** correct stale path + worktree-aware vendor-mission-authoring-bundle ([#193](https://github.com/zero-day-ai/dashboard/issues/193)) ([#202](https://github.com/zero-day-ai/dashboard/issues/202)) ([4055175](https://github.com/zero-day-ai/dashboard/commit/40551759f6b5bc64a9089aae078fbbd9c18aa57e))
* **scripts:** make 5 prebuild scripts worktree-aware ([#197](https://github.com/zero-day-ai/dashboard/issues/197)) ([#201](https://github.com/zero-day-ai/dashboard/issues/201)) ([3f05910](https://github.com/zero-day-ai/dashboard/commit/3f05910461f7aa2a66398d07b39687681dfc513b))
* signup consent checkboxes invisible against card background ([#231](https://github.com/zero-day-ai/dashboard/issues/231)) ([dd01d7a](https://github.com/zero-day-ai/dashboard/commit/dd01d7a1fbfd95936ef17aacdab9993c215d5f3d))

## [0.104.0](https:\/\/github.com\/zero-day-ai\/dashboard\/compare\/v0.X.Y...v0.104.0) (2026-05-17)

Polyrepo zero-dot-x reset (PRD zero-day-ai\/.github#25, board #14). The v1.x line was cut prematurely; nothing in the platform is at 1.0 maturity yet. The v1.0.0 tag + release has been deleted; this repo lands at the polyrepo-wide v0.104.0 marker. Going forward, `bump-minor-pre-major: true` ensures `feat!:` commits bump minor not major.
## [1.12.0](https://github.com/zero-day-ai/dashboard/compare/v1.11.1...v1.12.0) (2026-05-15)


### Features

* **auth:** wire Zitadel V2 session+CreateCallback into signup auto-login ([#42](https://github.com/zero-day-ai/dashboard/issues/42)) ([48e98bd](https://github.com/zero-day-ai/dashboard/commit/48e98bd5d447d958e6285707c1937cfa859d7ecc)), closes [#41](https://github.com/zero-day-ai/dashboard/issues/41)


### Bug Fixes

* **auth:** correct Zitadel V2 OIDC CreateCallback HTTP path ([#43](https://github.com/zero-day-ai/dashboard/issues/43)) ([6119714](https://github.com/zero-day-ai/dashboard/commit/61197146b42a5f50cd020f52ea9ac224bd6431d1))
* **landing:** explicit text color on Typewriter so hero text is readable ([#37](https://github.com/zero-day-ai/dashboard/issues/37)) ([366f383](https://github.com/zero-day-ai/dashboard/commit/366f3838d56496825772282829278d24e6591b8c))

## [1.11.1](https://github.com/zero-day-ai/dashboard/compare/v1.11.0...v1.11.1) (2026-05-13)


### Bug Fixes

* **ci:** actually rename dashboard workflow + image (lost in [#34](https://github.com/zero-day-ai/dashboard/issues/34) rename diff) ([#36](https://github.com/zero-day-ai/dashboard/issues/36)) ([a8ba906](https://github.com/zero-day-ai/dashboard/commit/a8ba9065643eae7411e79ebc8956ec3375952a01))
* **ci:** rename dashboard workflow + image to ghcr.io/zero-day-ai/dashboard ([#34](https://github.com/zero-day-ai/dashboard/issues/34)) ([e131bdb](https://github.com/zero-day-ai/dashboard/commit/e131bdbf97d2b1e28f4a930665afa426570c2672))

## [1.11.0](https://github.com/zero-day-ai/dashboard/compare/v1.10.0...v1.11.0) (2026-05-13)


### Features

* **build:** point Dockerfile FROM at ghcr.io mirror ([#28](https://github.com/zero-day-ai/dashboard/issues/28)) ([5445955](https://github.com/zero-day-ai/dashboard/commit/5445955f79ad7efec0ab4a3dcec01e8ace1a319b))
* **build:** pull plans.yaml from tenant-operator at image build ([#22](https://github.com/zero-day-ai/dashboard/issues/22)) ([99ca903](https://github.com/zero-day-ai/dashboard/commit/99ca9035b7e33e001596186bf54e78d058cf21b7))


### Bug Fixes

* **api:** drop 'use server' from billing route handlers ([#25](https://github.com/zero-day-ai/dashboard/issues/25)) ([f4f8dd6](https://github.com/zero-day-ai/dashboard/commit/f4f8dd6ec0442f41e323a67f832e7803de85dadb))
* **build:** route gen-plans diagnostics to stderr ([c83d707](https://github.com/zero-day-ai/dashboard/commit/c83d707a9525fac138dd80ff1a2246a5c9e5b667))
* **build:** skip plans-fresh + stripe-tiers gates in Docker ([#24](https://github.com/zero-day-ai/dashboard/issues/24)) ([29d2c88](https://github.com/zero-day-ai/dashboard/commit/29d2c887287425eec7744b993d1dcc1ff18a5863))
* **pricing:** route Start-trial CTA to /signup?plan= so signup loads ([#29](https://github.com/zero-day-ai/dashboard/issues/29)) ([c511aed](https://github.com/zero-day-ai/dashboard/commit/c511aed7109cb7e7993638cc378bec0fec5e82b2))

## [1.10.0](https://github.com/zero-day-ai/dashboard/compare/v1.9.0...v1.10.0) (2026-05-11)


### Features

* add org tier and restructure pricing page ([#19](https://github.com/zero-day-ai/dashboard/issues/19)) ([b30c18d](https://github.com/zero-day-ai/dashboard/commit/b30c18dddf21e73adc916c0c684a9980030a4046))
* **billing:** live Stripe price overlay on pricing page ([#21](https://github.com/zero-day-ai/dashboard/issues/21)) ([8504b80](https://github.com/zero-day-ai/dashboard/commit/8504b807d43f3e697b3a688f348f09ec83b2422f))

## [1.9.0](https://github.com/zero-day-ai/dashboard/compare/v1.8.0...v1.9.0) (2026-05-10)


### Features

* **billing:** Phase 1 foundations — types, stripe wrapper, idempotency table, guards, metrics ([7629c27](https://github.com/zero-day-ai/dashboard/commit/7629c279f7226bbed6113309529258e46dec1aea))
* **billing:** Phase 2 email infrastructure — SES provider, 5 billing templates, snapshot tests ([9dc6431](https://github.com/zero-day-ai/dashboard/commit/9dc643174c9af53737476843b8ea2591b440cf1b))
* **billing:** Phase 3 checkout endpoint — POST /api/billing/checkout with 16 unit tests ([1b32072](https://github.com/zero-day-ai/dashboard/commit/1b3207211dc7df30822853755fac16c1f9c491cf))
* **billing:** Phase 6 webhook subdomain — 410 tombstone, cutover runbook ([523edc5](https://github.com/zero-day-ai/dashboard/commit/523edc5a6d7ed435d885e4cf69971c538b37bc6b))
* **billing:** Phase 7 webhook lifecycle handlers — 7 event types, console migration, 38 tests ([84bdd01](https://github.com/zero-day-ai/dashboard/commit/84bdd01bf7b82f5552ddce921b4491ac23b6f41c))
* **billing:** Phases 14+15 — Grafana dashboard, Prometheus alerts, bootstrap script, cleanup guards ([544d95d](https://github.com/zero-day-ai/dashboard/commit/544d95dee1f43196cb0b04b04653c548568abe5e))
* **billing:** Phases 4+5 — CheckoutButton, pricing page CTAs, portal route, billing settings page ([8ccad87](https://github.com/zero-day-ai/dashboard/commit/8ccad878441fd7eb462550dbb6853d8b6e596ee4))
* **billing:** Phases 9+11 — admin tools, boot guard, Stripe test suite ([ea5f933](https://github.com/zero-day-ai/dashboard/commit/ea5f933fa568c6bae28361aa6586c6920790f3aa))
* dashboard W1+W2 hardening + Pino logger + R7/R9/R17/R18/R11 ([3d0d1f6](https://github.com/zero-day-ai/dashboard/commit/3d0d1f6c30eec9e8b90a25da606d684a040234be))
* **dashboard:** generate BillingTier + PRICE_ENV_MAP from plans.yaml ([e008898](https://github.com/zero-day-ai/dashboard/commit/e0088986cd7311eecae508e91172b85c4cb1e06b))
* **dashboard:** in-app quota UX + Phase 7.B sweep of legacy fields ([f0161ef](https://github.com/zero-day-ai/dashboard/commit/f0161ef30893b253d6c82d95fd4f6d40a7a442c5))
* **dashboard:** mission checkpoint browser + tool-stream SSE bridge ([383125e](https://github.com/zero-day-ai/dashboard/commit/383125e274e18783fb7e3248d9efdd7a350cc8bf))
* **dashboard:** mission events SSE bridge + per-tool streaming progress on detail page ([5889b28](https://github.com/zero-day-ai/dashboard/commit/5889b28976f454b3fec57142ee6b8680df01bf90))
* **dashboard:** mission-draft server actions for the create page ([7a852f7](https://github.com/zero-day-ai/dashboard/commit/7a852f7ef2911c5cbf1e13cc71a4d1d518b1e9ca))
* **dashboard:** mission-draft UI on the create page ([e01099b](https://github.com/zero-day-ai/dashboard/commit/e01099bdbe29f83ea85272e401ca2ef1646f8db9))
* **dashboard:** regen plans.ts for 3-plan schema + drift gate ([3cde94a](https://github.com/zero-day-ai/dashboard/commit/3cde94a5a424d294a8ab0d15aeb4f41cdd159c5f))
* **dashboard:** seed in-app quota UX hook + Server Action ([f8266a6](https://github.com/zero-day-ai/dashboard/commit/f8266a6c67b0fe0e0e99aa02fb8782ff15287421))
* **dashboard:** three-card pricing page driven by plans.yaml ([4b812c3](https://github.com/zero-day-ai/dashboard/commit/4b812c30c9d37ad3cebbcb0f0c7dda2c5b617b48))
* **dashboard:** v1.8.0 — eliminate permissive-dev paths, no localhost defaults, no console.* in hooks, no skipped tests ([7760e05](https://github.com/zero-day-ai/dashboard/commit/7760e0544d0b74f3eb897cc0b70a9bdbfe064d9e))
* install release-please and pr-title-lint ([#16](https://github.com/zero-day-ai/dashboard/issues/16)) ([77709e6](https://github.com/zero-day-ai/dashboard/commit/77709e6c5e05749d8c0aaab1316352eb894a2921))
* **signup:** client-side reserved-names check via daemon GetReservedNames ([f918da4](https://github.com/zero-day-ai/dashboard/commit/f918da4ade7d806480c7437cd1019e61b0f0788a))


### Bug Fixes

* **billing:** fix 3 TypeScript errors in billing tests and bootstrap script ([0ad4c08](https://github.com/zero-day-ai/dashboard/commit/0ad4c084c83d6190c355daff5fd1f1bf65f3642f))

## [1.6.0] - 2026-05-04

Completes the dashboard side of the
**`tenant-secrets-broker-completion`** spec. Pairs with gibson v0.29.0
and SDK v0.99.0.

The `/settings/secrets-backend` page now does what its UI has been
claiming since `secrets-tenant-lifecycle` shipped — switching providers
actually changes the broker that serves the tenant's secrets. Before
this change, calls landed as `Unimplemented` because the SDK admin v1
service was never registered on the daemon side; that's now fixed in
gibson v0.29.0. This release adds the dashboard counterpart: a real
secret-count drives the migration warning, and an explicit "I
understand" checkbox gates Save when switching with secrets present.

### Added

- **`countSecrets()`** typed wrapper in
  `src/lib/gibson-client/tenant-broker-config.ts` for the new
  `gibson.admin.v1.TenantAdminService.CountSecrets` admin RPC.
- **Acknowledgement checkbox** in `SecretsBackendForm`. When the user
  is switching from the currently-configured provider AND the tenant
  has at least one existing secret (or the count RPC is unreachable),
  an inline amber warning appears with a Shadcn Checkbox. Save is
  disabled until the checkbox is ticked. The checkbox resets when the
  selected provider changes again.

### Changed

- **`SecretsBackendContent` now fetches the broker config and the
  secret count in parallel** via `Promise.allSettled` and threads a
  real `secretCount: number` through to the form. The previous
  hard-coded `hasExistingSecrets = true` (which forced the warning to
  fire on every provider switch regardless of state) is gone.
- **The migration warning is now an inline alert with an
  acknowledgement checkbox**, replacing the always-on
  `MigrationWarningDialog` (which has been removed). Provider
  switching is no longer dialog-gated; the checkbox-gates-Save model
  matches the spec design's "fail-loud, opt-in" requirement.
- **TS proto bindings + authz registry regenerated** for SDK v0.99.0
  via `pnpm proto:generate` and `pnpm prebuild`. New entry
  `/gibson.admin.v1.TenantAdminService/CountSecrets` in
  `src/gen/authz/registry.ts`; `useAuthorize` and `assertAuthorized`
  pick it up automatically.

### Sentinel: `secretCount === -1`

When the daemon's `CountSecrets` RPC is unreachable
(`Promise.allSettled` rejection on the count side),
`SecretsBackendContent` substitutes `-1` for `secretCount`. The form
treats `-1` as "conservative path — assume there might be secrets"
and renders the warning + checkbox. A muted-text caveat "Could not
load current secret count; assuming there may be existing secrets."
is shown so operators understand why the warning is firing on what
may be a brand-new tenant. Spec: `tenant-secrets-broker-completion`
R3.6 + design D4.

### Tests

- New `src/components/secrets-backend/__tests__/SecretsBackendForm.test.tsx`
  — four RTL tests covering all four R3 acceptance criteria. Required
  jsdom polyfills for Radix Select internals (`scrollIntoView`,
  pointer-capture methods, class-based `ResizeObserver`).

---

## [1.5.1] - 2026-05-01

Hotfix completing the dashboard side of the
**`tenant-role-taxonomy`** spec.

### Fixed

- **Active-workspace UI now displays `owner` instead of collapsing it to
  `member`.** The `Membership` type in `src/lib/auth/membership.ts` was
  written before `"owner"` became a valid daemon-returned role and was
  pinned to `'admin' | 'member'`. `normalizeRole()` actively flattened
  any non-`"admin"` value (including `"owner"`) to `"member"`, so even
  after gibson v0.27.1 began returning `role: "owner"` for tenant
  founders the settings page and tenant switcher rendered "member".
  Widened the type to `'owner' | 'admin' | 'member'` and taught
  `normalizeRole()` to preserve `"owner"`. Added a distinct amber badge
  for `owner` in `TenantSwitcherClient`.

## [1.5.0] - 2026-05-01

Implements the dashboard portion of the **`tenant-role-taxonomy`** spec
(see `.spec-workflow/specs/tenant-role-taxonomy/` in the workspace root).
Converges the dashboard with the new three-tier
`owner > admin > member` FGA hierarchy that ships in gibson v0.27.0
and tenant-operator v0.1.0.

### Changed

- **Self-signup founding user is now a tenant `owner`.** In
  `app/actions/signup.ts`, the synthesised `TenantMember` CR for the
  signup user now carries `role: "owner"` (was `"admin"`). The
  tenant-operator's reconciler writes this directly to FGA as the new
  first-class `(user:<sub>, owner, tenant:<slug>)` tuple; the daemon's
  `ListMyMemberships` derives `"owner"` as the highest tier and the
  active-workspace UI displays the correct role for tenant founders
  after sign-out / sign-in. (Req 4.1, 4.2, 4.4.)
- **`TenantRole` doc comment refreshed** in `src/lib/auth/roles.ts` —
  removed the now-stale claim that the daemon only emits `admin` /
  `member`; documents the full three-tier hierarchy with a spec
  cross-reference. The exported type and `ROLE_RANK` table are
  unchanged (both already encoded the `owner > admin > member`
  hierarchy with ranks 3 / 2 / 1 — the previously-unreachable
  rank-3 slot is now reachable end-to-end).

### Compatibility

- Backward-compatible at runtime: existing logged-in founders see
  their previous role (`admin`) until next session refresh, then see
  `owner` once the daemon-side change takes effect and the
  `gibson-tenant-owner-backfill` Job (shipped in deploy v0.5.0) has
  written the corresponding owner tuple.
- Forward-compatible: subsequent invitations issued via the dashboard
  admin UI continue to write `role: "admin"` or `role: "member"` per
  the inviter's choice. (Req 4.3.)

## [1.4.0] - 2026-05-01

Implements the dashboard portion of the **`zero-trust-hardening`** spec
(see `.spec-workflow/specs/zero-trust-hardening/` in the workspace root).
Closes the audit-found gaps that allowed the browser bundle to bypass Envoy
and that left machine-to-machine auth silently degraded when the chart's
`resolve-sa-identity-map` init container failed.

### Added

- **`/api/auth/my-permissions`** server route. Requires an Auth.js session
  and calls the daemon's `GetMyPermissions` RPC server-side via Envoy
  using `userClient`. Replaces the browser-side gRPC-Web transport that
  previously bypassed Envoy. Returns `Cache-Control: private, max-age=<ttl>`.
- **`assertAllowedServiceSubjectsConfigured()`** in
  `src/lib/auth/zitadel-bearer-verifier.ts`. Throws if
  `ALLOWED_SERVICE_SUBJECTS` parses to an empty Set. Wired into
  `instrumentation.ts` for production so the dashboard pod fails-fast at
  boot rather than silently 401-ing every inbound machine-to-machine
  call. (Req 11.3.)
- **`requireCsrf(req)` + `csrfErrorResponse(err)`** in
  `src/lib/auth/csrf.ts`. Reads the proxy-seeded `csrf-token` cookie,
  compares against the `x-csrf-token` header (or `csrf` form field on
  `application/x-www-form-urlencoded` posts) using constant-time
  `crypto.timingSafeEqual`, throws `CsrfError` on mismatch. Applied to
  the user-acting mutating mission routes:
  `POST /api/missions/create`, `POST /api/missions/validate`,
  `POST /api/missions/[id]/{stop,pause,resume}`,
  `DELETE /api/missions/[id]`. (Req 11.5.)
- **`scripts/check-no-direct-daemon-grpc-bundle.mjs`** postbuild guard.
  Greps `.next/static/**/*.js` for `createGrpcWebTransport`,
  `getBrowserClient`, `NEXT_PUBLIC_GIBSON_DAEMON_URL`. Catches a
  regression at the canonical artifact level even if a source-level
  guard is bypassed. (Req 6.5.)

### Changed

- **Browser-side direct-daemon transport removed.**
  `src/lib/permissions-cache.ts` no longer holds a
  `createGrpcWebTransport` constructor; the cache calls
  `/api/auth/my-permissions` via `fetch`. `getBrowserClient` and
  `NEXT_PUBLIC_GIBSON_DAEMON_URL` are gone. (Req 6.1, 6.2.)
- **`scripts/check-no-direct-daemon-grpc.mjs`** extended:
  - Generalized port patterns to match any daemon-shaped FQDN at any of
    the known daemon ports (50001/50002/50051/50100), so
    `gibson.<ns>.svc.cluster.local:50051` is now caught.
  - Forbids `NEXT_PUBLIC_GIBSON_DAEMON_URL` as a literal name.
  - Build-time scan of `process.env` for any `NEXT_PUBLIC_*` variable
    whose value matches a daemon-shaped URL pattern.
  - Scan roots extended beyond `app/` and `src/` to include
    repo-root `components/`, `lib/`, `hooks/` and the loose top-level
    files (`auth.ts`, `middleware.ts`, `mdx-components.tsx`,
    `instrumentation.ts`). (Req 6.3.)
- **`package.json`** scripts:
  - `prebuild` now runs `check-no-secrets-in-client.mjs` (was
    postbuild-only). (Req 6.4.)
  - `postbuild` now also runs the new bundle-scan script.
- **`src/gen/authz/registry.ts`** regenerated against the latest SDK —
  agent / tool service RPCs now declare
  `allowedIdentities: COMPONENT` rather than `USER | SERVICE` (the SDK's
  cross-spec correction landed in zero-trust-hardening Req 2.5).

### Notes

- Admin / provisioning routes (`app/api/admin/provisioning/**`) are
  service-acting (Zitadel `client_credentials` Bearer JWT) and are
  intentionally **not** wired for CSRF — browser CSRF cookies do not
  exist on those calls. Their CSRF equivalent is the JWT
  issuer/audience/sub allow-list check in `verifyZitadelBearer`.
  Documented in `src/lib/auth/csrf.ts`.
- Other user-acting mutating routes outside `app/api/missions/**` will be
  wired in a follow-up rollout PR; the helper is in place and the
  pattern is single-line.

### Migration

No env-var or config changes are required for upgrades. In production,
the chart's `resolve-sa-identity-map` init container already populates
`ALLOWED_SERVICE_SUBJECTS`; the new startup self-check exercises that
existing wiring rather than introducing a new dependency.

The retired env var `NEXT_PUBLIC_GIBSON_DAEMON_URL` may safely be removed
from any deployment values; the build now refuses to consume it.
