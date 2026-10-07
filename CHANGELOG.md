# Changelog

## [0.130.1](https://github.com/zeroroot-ai/dashboard/compare/v0.130.0...v0.130.1) (2026-10-07)


### Bug Fixes

* **deps:** pin sharp to 0.35.5 ([#275](https://github.com/zeroroot-ai/dashboard/issues/275)) ([47da6e9](https://github.com/zeroroot-ai/dashboard/commit/47da6e9b2938e0833415d37645ae6d6993a44d8f))

## [0.130.0](https://github.com/zeroroot-ai/dashboard/compare/v0.129.0...v0.130.0) (2026-10-07)


### Features

* **metrics:** serve metrics on a separate metrics-only port ([#270](https://github.com/zeroroot-ai/dashboard/issues/270)) ([8161a00](https://github.com/zeroroot-ai/dashboard/commit/8161a00419d0ecc753161a16a8c6c7a2a67a4edd))
* **results:** the mission results view shows the track record of each technique ([#265](https://github.com/zeroroot-ai/dashboard/issues/265)) ([e77df9d](https://github.com/zeroroot-ai/dashboard/commit/e77df9d1a836d71eac632447c29941055bb1ff67)), closes [#192](https://github.com/zeroroot-ai/dashboard/issues/192)

## [0.129.0](https://github.com/zeroroot-ai/dashboard/compare/v0.128.0...v0.129.0) (2026-10-07)


### Features

* **billing:** the dashboard holds no billing code and offers two neutral connection points ([#256](https://github.com/zeroroot-ai/dashboard/issues/256)) ([fc652c7](https://github.com/zeroroot-ai/dashboard/commit/fc652c71988975e8b66978d0325d3d154e7634be))
* **compliance:** one page shows the audit evidence for each control ([#259](https://github.com/zeroroot-ai/dashboard/issues/259)) ([0c2cc94](https://github.com/zeroroot-ai/dashboard/commit/0c2cc9469009ec349e43e5c3e0786e064eae3ad2)), closes [#224](https://github.com/zeroroot-ai/dashboard/issues/224)
* end-phase integration of the dashboard ([#263](https://github.com/zeroroot-ai/dashboard/issues/263)) ([8685563](https://github.com/zeroroot-ai/dashboard/commit/8685563c9b9934ab3659d40137c55ae4afa56596))
* **missions:** the runs of a mission show as a chain, and a checkpoint offers a rewind ([#258](https://github.com/zeroroot-ai/dashboard/issues/258)) ([89aaa38](https://github.com/zeroroot-ai/dashboard/commit/89aaa38a1c256491bda73babff4775ec69fbc65b)), closes [#227](https://github.com/zeroroot-ai/dashboard/issues/227)
* **proto:** the list calls use page_size and page_token of sdk v0.196.0 ([#257](https://github.com/zeroroot-ai/dashboard/issues/257)) ([32c418f](https://github.com/zeroroot-ai/dashboard/commit/32c418f991264922d969b2676b0c31c0fcbd883e))


### Bug Fixes

* **auth:** the sign-in error text makes no promise about on-call ([#232](https://github.com/zeroroot-ai/dashboard/issues/232)) ([b39381a](https://github.com/zeroroot-ai/dashboard/commit/b39381a65494172ae2339fb1cb847c4627975fe9)), closes [#211](https://github.com/zeroroot-ai/dashboard/issues/211)
* **auth:** the sign-out route accepts POST only ([#231](https://github.com/zeroroot-ai/dashboard/issues/231)) ([6594b36](https://github.com/zeroroot-ai/dashboard/commit/6594b36dcbedec2292ec9b75b03afb7d5d1b4c8d)), closes [#210](https://github.com/zeroroot-ai/dashboard/issues/210)
* **build:** pnpm-lock.yaml is the one lockfile ([#247](https://github.com/zeroroot-ai/dashboard/issues/247)) ([03c846f](https://github.com/zeroroot-ai/dashboard/commit/03c846fae58d16a8972fe89aa8a5d50926bfe4d5))
* **deploy:** the plugin guide names no integrations repository ([#260](https://github.com/zeroroot-ai/dashboard/issues/260)) ([71c3e21](https://github.com/zeroroot-ai/dashboard/commit/71c3e2129556a29ab874c8e93c77c937b9161a13))
* **enroll:** the credential panel shows how enrollment works ([#223](https://github.com/zeroroot-ai/dashboard/issues/223)) ([cdd172a](https://github.com/zeroroot-ai/dashboard/commit/cdd172adf1c7d6b94698d64ff13898acbaaec363))
* **guards:** the admin binding guard has one list and a failing fixture ([#236](https://github.com/zeroroot-ai/dashboard/issues/236)) ([3095ca6](https://github.com/zeroroot-ai/dashboard/commit/3095ca688f0ce26b95fdc67df151548c2679cc69)), closes [#214](https://github.com/zeroroot-ai/dashboard/issues/214)
* **guards:** the RBAC checks of the dashboard read a chart file that exists ([#230](https://github.com/zeroroot-ai/dashboard/issues/230)) ([3ecbf7f](https://github.com/zeroroot-ai/dashboard/commit/3ecbf7f073325a31e49dafe1ed5a29fbc9c23fe9)), closes [#209](https://github.com/zeroroot-ai/dashboard/issues/209)
* **model-access:** the page states the real default ([#220](https://github.com/zeroroot-ai/dashboard/issues/220)) ([088f187](https://github.com/zeroroot-ai/dashboard/commit/088f187ffd0aebf08855ba7f4f8a1033621ec55d))
* **proto:** gen-authz-registry reads the sdk protos from the Buf registry ([#244](https://github.com/zeroroot-ai/dashboard/issues/244)) ([a674f4b](https://github.com/zeroroot-ai/dashboard/commit/a674f4b301aa728206d89960868b05e53e1425ca)), closes [#240](https://github.com/zeroroot-ai/dashboard/issues/240)
* **proto:** proto-generate reads the sdk protos from the Buf registry ([#241](https://github.com/zeroroot-ai/dashboard/issues/241)) ([b886d62](https://github.com/zeroroot-ai/dashboard/commit/b886d6248a7fbd6ab89075c704b1360d71b4174a))
* **providers:** one client function updates a provider credential ([#235](https://github.com/zeroroot-ai/dashboard/issues/235)) ([badae48](https://github.com/zeroroot-ai/dashboard/commit/badae48870d883f85834d96543b1f01a26d8ef69)), closes [#213](https://github.com/zeroroot-ai/dashboard/issues/213)
* **providers:** the provider code names the real service and no missing doc ([#233](https://github.com/zeroroot-ai/dashboard/issues/233)) ([344661b](https://github.com/zeroroot-ai/dashboard/commit/344661bdd26e634c835c52c0ce1c54d7308c5715)), closes [#212](https://github.com/zeroroot-ai/dashboard/issues/212)
* **secrets:** the dashboard calls gibson.secrets.v1.SecretsService ([#248](https://github.com/zeroroot-ai/dashboard/issues/248)) ([0a4a303](https://github.com/zeroroot-ai/dashboard/commit/0a4a30329eb7d78b4cd362b63f42df40f26697f7))

## [0.128.0](https://github.com/zeroroot-ai/dashboard/compare/v0.127.2...v0.128.0) (2026-10-05)


### Features

* **auth:** server-side identity calls reach Zitadel by Service name ([#205](https://github.com/zeroroot-ai/dashboard/issues/205)) ([1b5ec60](https://github.com/zeroroot-ai/dashboard/commit/1b5ec60fdd80f6f1fffe6a1509bb46a76fbd1b87))
* **env:** the env reader set is a committed artifact with a drift gate ([#204](https://github.com/zeroroot-ai/dashboard/issues/204)) ([a8fd4ac](https://github.com/zeroroot-ai/dashboard/commit/a8fd4ac64e20003cb96bcfbcd0f293c9a6c19f95))

## [0.127.2](https://github.com/zeroroot-ai/dashboard/compare/v0.127.1...v0.127.2) (2026-10-02)


### Bug Fixes

* **adr-0027:** one provider shape, one tier shape, no back-compat re-export ([#177](https://github.com/zeroroot-ai/dashboard/issues/177)) ([4de9361](https://github.com/zeroroot-ai/dashboard/commit/4de93612245266268fe9c74e748d94633bf57750)), closes [#160](https://github.com/zeroroot-ai/dashboard/issues/160)
* **ast-checks:** the walker header claims friendliness to a deleted CLI ([#171](https://github.com/zeroroot-ai/dashboard/issues/171)) ([82ebac3](https://github.com/zeroroot-ai/dashboard/commit/82ebac3b28a89a02e2683c04dcde83e178eee9ca))
* **deps:** move off the dependency advisories behind the Scorecard alert ([#184](https://github.com/zeroroot-ai/dashboard/issues/184)) ([1a5c992](https://github.com/zeroroot-ai/dashboard/commit/1a5c992935436a6ab115228d9528e465fc329dd8))
* **docker:** Node sizes its heap from the cgroup limit, so an OOM is an event ([c338a47](https://github.com/zeroroot-ai/dashboard/commit/c338a47cb35d09bd0800de9dbd22692ac000992a))
* **docker:** the heap is sized from the cgroup limit, so an OOM is an event ([#183](https://github.com/zeroroot-ai/dashboard/issues/183)) ([c338a47](https://github.com/zeroroot-ai/dashboard/commit/c338a47cb35d09bd0800de9dbd22692ac000992a))
* **email:** the dashboard sends no mail, so it declares no mail ([#181](https://github.com/zeroroot-ai/dashboard/issues/181)) ([1d7e073](https://github.com/zeroroot-ai/dashboard/commit/1d7e07386963636dd6c36544eee39019eac85474))
* **env:** every declared env name has a reader, and a gate keeps it so ([#185](https://github.com/zeroroot-ai/dashboard/issues/185)) ([a9e32aa](https://github.com/zeroroot-ai/dashboard/commit/a9e32aa8ce7f77e0173a26ce35dc3c14d7343e72)), closes [#182](https://github.com/zeroroot-ai/dashboard/issues/182)
* **metrics:** every auth metric has a producer, and a gate keeps it so ([#179](https://github.com/zeroroot-ai/dashboard/issues/179)) ([c819040](https://github.com/zeroroot-ai/dashboard/commit/c819040e991861b4b227456a0cb9d3587d5b330c)), closes [#173](https://github.com/zeroroot-ai/dashboard/issues/173)
* **ui:** components/ui is inside the knip gate, and types is back at error ([#176](https://github.com/zeroroot-ai/dashboard/issues/176)) ([dde2996](https://github.com/zeroroot-ai/dashboard/commit/dde299601a1f046e2945c2abc52d2112ec30e745)), closes [#159](https://github.com/zeroroot-ai/dashboard/issues/159) [#161](https://github.com/zeroroot-ai/dashboard/issues/161)

## [0.127.1](https://github.com/zeroroot-ai/dashboard/compare/v0.127.0...v0.127.1) (2026-10-02)


### Bug Fixes

* **deps:** move undici off two fixable HIGH CVEs so the image can be pushed ([#169](https://github.com/zeroroot-ai/dashboard/issues/169)) ([2109b95](https://github.com/zeroroot-ai/dashboard/commit/2109b95867b485d7bcb831d30c34575899342913))

## [0.127.0](https://github.com/zeroroot-ai/dashboard/compare/v0.126.0...v0.127.0) (2026-10-01)


### ⚠ BREAKING CHANGES

* **targets:** a target carries no authentication shape ([#167](https://github.com/zeroroot-ai/dashboard/issues/167))
* **auth:** TEST_AUTH_BYPASS no longer does anything, and the specs that required it are gone. An authenticated browser test has to sign in. That lane does not exist yet — dashboard#163 tracks building it, and the kind-gated suites it would also unblock.

### Features

* **destructive-actions:** wire authorization queue to DestructiveAuthorizationService (dashboard[#99](https://github.com/zeroroot-ai/dashboard/issues/99)) ([#153](https://github.com/zeroroot-ai/dashboard/issues/153)) ([0a59ff3](https://github.com/zeroroot-ai/dashboard/commit/0a59ff3f9e720ae7674aaf117b2ff1cc2ea6b1ca))
* **hitl-settle:** wire bet-verdict queue to WorldService (dashboard[#97](https://github.com/zeroroot-ai/dashboard/issues/97)) ([#152](https://github.com/zeroroot-ai/dashboard/issues/152)) ([65bbb68](https://github.com/zeroroot-ai/dashboard/commit/65bbb680303a8be6d15c277a8fb3d5c2a3541009))
* **reliability:** add calibration reliability diagram (dashboard[#98](https://github.com/zeroroot-ai/dashboard/issues/98)) ([759ec34](https://github.com/zeroroot-ai/dashboard/commit/759ec3410fb5e39ba4675560fbeda8f76a50986d))
* **reliability:** calibration reliability diagram (dashboard[#98](https://github.com/zeroroot-ai/dashboard/issues/98)) ([#151](https://github.com/zeroroot-ai/dashboard/issues/151)) ([759ec34](https://github.com/zeroroot-ai/dashboard/commit/759ec3410fb5e39ba4675560fbeda8f76a50986d))
* **targets:** a target carries no authentication shape ([#167](https://github.com/zeroroot-ai/dashboard/issues/167)) ([1e96f1c](https://github.com/zeroroot-ai/dashboard/commit/1e96f1c32599f6d48830be289ce602e53822cf8b))


### Bug Fixes

* **auth:** delete the session-forging test fixture and TEST_AUTH_BYPASS ([#164](https://github.com/zeroroot-ai/dashboard/issues/164)) ([60b4252](https://github.com/zeroroot-ai/dashboard/commit/60b4252c2b9f9b089446968385f39e54c77b352b))
* **deps:** bump next to 16.3.8 to clear next/og RCE (GHSA-vcvr-r3jv-pc5j) ([#154](https://github.com/zeroroot-ai/dashboard/issues/154)) ([8ff5a3a](https://github.com/zeroroot-ai/dashboard/commit/8ff5a3ad4d9535f84a0710a8b2c63905ddfa2076))
* **deps:** stripe 22, the AI SDK family at v7, and knip 6 ([#162](https://github.com/zeroroot-ai/dashboard/issues/162)) ([8cde343](https://github.com/zeroroot-ai/dashboard/commit/8cde343348487c7ec869fdcf4b3884e1b5d6d99f))
* **invite:** hand over the setup link instead of pointing at mail nobody sends ([#166](https://github.com/zeroroot-ai/dashboard/issues/166)) ([23eeb88](https://github.com/zeroroot-ai/dashboard/commit/23eeb88237b75bd452f2297465e57316315d6368))

## [0.126.0](https://github.com/zeroroot-ai/dashboard/compare/v0.125.0...v0.126.0) (2026-09-30)


### Features

* **domain-packs:** dashboard catalog + enable/disable toggle UI (gibson[#383](https://github.com/zeroroot-ai/dashboard/issues/383)) ([#143](https://github.com/zeroroot-ai/dashboard/issues/143)) ([745a423](https://github.com/zeroroot-ai/dashboard/commit/745a423d88add16451c14e8abbab5bab9f8442ab))
* **people:** show who created a mission and who reported a finding ([#147](https://github.com/zeroroot-ai/dashboard/issues/147)) ([7882d4c](https://github.com/zeroroot-ai/dashboard/commit/7882d4c677e528caebefc76e2a8b82a8cba0659f))


### Bug Fixes

* **ci:** link-check checks only the Markdown a PR touched (.github v0.7.2) ([#145](https://github.com/zeroroot-ai/dashboard/issues/145)) ([fd4fd0e](https://github.com/zeroroot-ai/dashboard/commit/fd4fd0e240f8d9b98d6563d1169807537263478d))

## [0.125.0](https://github.com/zeroroot-ai/dashboard/compare/v0.124.2...v0.125.0) (2026-09-29)


### Features

* **authz:** mission actions, the demo run and target controls follow the Editor gate, registry from sdk v0.183.1 ([#141](https://github.com/zeroroot-ai/dashboard/issues/141)) ([0b0af30](https://github.com/zeroroot-ai/dashboard/commit/0b0af3028136f5e27d2e03f5f81bc5cf65129c43))

## [0.124.2](https://github.com/zeroroot-ai/dashboard/compare/v0.124.1...v0.124.2) (2026-09-29)


### Bug Fixes

* **auth:** one tenant resolver, no picker, no active-tenant cookie residue ([#140](https://github.com/zeroroot-ai/dashboard/issues/140)) ([56113b5](https://github.com/zeroroot-ai/dashboard/commit/56113b5601ffc1aa2f025594e5bb695b6351717c))
* **rework:** test mocks of assert-authorized carry the real module, so authzDenial exists ([#137](https://github.com/zeroroot-ai/dashboard/issues/137)) ([ab8f6f4](https://github.com/zeroroot-ai/dashboard/commit/ab8f6f4b8b66a00fe9a736fcc3e471a7827c710b))

## [0.124.1](https://github.com/zeroroot-ai/dashboard/compare/v0.124.0...v0.124.1) (2026-09-29)


### Bug Fixes

* **auth:** a denial from inside an RPC is read as permission denied, not as an internal error ([#135](https://github.com/zeroroot-ai/dashboard/issues/135)) ([1682758](https://github.com/zeroroot-ai/dashboard/commit/1682758466d278e0c04a924c3c98a745d982b179))

## [0.124.0](https://github.com/zeroroot-ai/dashboard/compare/v0.123.1...v0.124.0) (2026-09-29)


### Features

* **users:** Editor role on invite and role change, four-role labels, and a Viewer gate on the mission editor ([6218e0e](https://github.com/zeroroot-ai/dashboard/commit/6218e0e5796ef8b3fbc6f6b9f77b67479ff69523))
* **users:** offer the Editor role on invite and role change, four-role labels, and a Viewer gate on the mission editor ([#133](https://github.com/zeroroot-ai/dashboard/issues/133)) ([6218e0e](https://github.com/zeroroot-ai/dashboard/commit/6218e0e5796ef8b3fbc6f6b9f77b67479ff69523))

## [0.123.1](https://github.com/zeroroot-ai/dashboard/compare/v0.123.0...v0.123.1) (2026-09-29)


### Bug Fixes

* **auth:** keep one membership verdict per person for 30 seconds instead of one daemon call per browser request ([#130](https://github.com/zeroroot-ai/dashboard/issues/130)) ([2ee3b3a](https://github.com/zeroroot-ai/dashboard/commit/2ee3b3aac593ccced0dad1b8dea99daf54bddeb5))

## [0.123.0](https://github.com/zeroroot-ai/dashboard/compare/v0.122.4...v0.123.0) (2026-09-28)


### Features

* **gibson:** intelligence-layer dashboard queues — destructive-action authorization and bet-verdict review ([#128](https://github.com/zeroroot-ai/dashboard/issues/128)) ([df2d889](https://github.com/zeroroot-ai/dashboard/commit/df2d8893064296bdd2474057ded433acc9613a75))

## [0.122.4](https://github.com/zeroroot-ai/dashboard/compare/v0.122.3...v0.122.4) (2026-09-28)


### Bug Fixes

* **authz:** stop at self-mode RPCs before reading memberships ([#116](https://github.com/zeroroot-ai/dashboard/issues/116)) ([542cae0](https://github.com/zeroroot-ai/dashboard/commit/542cae0a75a64cf2f316db3dd3ef53cdd3335492))

## [0.122.3](https://github.com/zeroroot-ai/dashboard/compare/v0.122.2...v0.122.3) (2026-09-28)


### Bug Fixes

* **auth:** stop the membership bootstrap from gating on membership ([#115](https://github.com/zeroroot-ai/dashboard/issues/115)) ([7b241e9](https://github.com/zeroroot-ai/dashboard/commit/7b241e91a0b2f589acd9435998737fa2145ca66d)), closes [#107](https://github.com/zeroroot-ai/dashboard/issues/107)
* **pagination:** stop unbounded page-token loops from accumulating forever ([#112](https://github.com/zeroroot-ai/dashboard/issues/112)) ([92224c4](https://github.com/zeroroot-ai/dashboard/commit/92224c4b1d8face244f031a76177c0baab53a183))
* **transport:** give every unary daemon call a bounded deadline ([#114](https://github.com/zeroroot-ai/dashboard/issues/114)) ([201a545](https://github.com/zeroroot-ai/dashboard/commit/201a545e7509f56745c404671b22a48ecb7ec084))

## [0.122.2](https://github.com/zeroroot-ai/dashboard/compare/v0.122.1...v0.122.2) (2026-09-28)


### Bug Fixes

* **events:** abort the daemon subscribe call when the SSE client disconnects ([#111](https://github.com/zeroroot-ai/dashboard/issues/111)) ([521d52f](https://github.com/zeroroot-ai/dashboard/commit/521d52f3ce632511471d9bc0cd8ac3c5cae4838d))
* **transport:** hold the shared HTTP/2 session on globalThis, not a module-scope let ([#109](https://github.com/zeroroot-ai/dashboard/issues/109)) ([b121dd5](https://github.com/zeroroot-ai/dashboard/commit/b121dd58e810fef8f9d688c9bc43dc6e1ad6d402))

## [0.122.1](https://github.com/zeroroot-ai/dashboard/compare/v0.122.0...v0.122.1) (2026-09-27)


### Bug Fixes

* delete the shell-user GC script and the dead claim-account spec ([#106](https://github.com/zeroroot-ai/dashboard/issues/106)) ([e51807d](https://github.com/zeroroot-ai/dashboard/commit/e51807d62c280e83c32aafd86695c1a70cbc4214))
* **signup:** associate the Password label with its input ([#95](https://github.com/zeroroot-ai/dashboard/issues/95)) ([5268f0f](https://github.com/zeroroot-ai/dashboard/commit/5268f0f036df83bc2f4411a00b48c9a364ea9aad)), closes [#77](https://github.com/zeroroot-ai/dashboard/issues/77)
* **transport:** every RPC client shares one HTTP/2 session, so the heap stops climbing ([#108](https://github.com/zeroroot-ai/dashboard/issues/108)) ([3e4a030](https://github.com/zeroroot-ai/dashboard/commit/3e4a030670ab8713bfdbf8a5b41e858423b1f74e)), closes [#107](https://github.com/zeroroot-ai/dashboard/issues/107)

## [0.122.0](https://github.com/zeroroot-ai/dashboard/compare/v0.121.1...v0.122.0) (2026-09-27)


### Features

* **members:** add a Reset MFA action to the member detail page ([#92](https://github.com/zeroroot-ai/dashboard/issues/92)) ([ed65e43](https://github.com/zeroroot-ai/dashboard/commit/ed65e438b134a3039818b5cda3b524fb9671d092))


### Bug Fixes

* **authz:** resync src/gen and the authz registry with gibson main ([#94](https://github.com/zeroroot-ai/dashboard/issues/94)) ([69d7194](https://github.com/zeroroot-ai/dashboard/commit/69d7194708f701be0855c288fb62f0ed2fe6ef94))
* **members:** removing a member deletes their account, not just their role ([#91](https://github.com/zeroroot-ai/dashboard/issues/91)) ([4511e66](https://github.com/zeroroot-ai/dashboard/commit/4511e6699854065680b4a82a48bb966a50508a18))

## [0.121.1](https://github.com/zeroroot-ai/dashboard/compare/v0.121.0...v0.121.1) (2026-09-25)


### Bug Fixes

* **analytics:** initialise google analytics once per mount ([#82](https://github.com/zeroroot-ai/dashboard/issues/82)) ([3d579b4](https://github.com/zeroroot-ai/dashboard/commit/3d579b4323cef29bc419e3bca430bcccf02a59d7))
* **auth:** the tenant comes from the signed-in identity ([#90](https://github.com/zeroroot-ai/dashboard/issues/90)) ([1f65b27](https://github.com/zeroroot-ai/dashboard/commit/1f65b273306093dc864bdf5e26a52247b4d12a31))
* **config:** no workstation address in the build config ([#81](https://github.com/zeroroot-ai/dashboard/issues/81)) ([0198ead](https://github.com/zeroroot-ai/dashboard/commit/0198ead11344a706982dc59e7b1d4bb233d03591))
* **members:** only the Owner can transfer ownership ([#89](https://github.com/zeroroot-ai/dashboard/issues/89)) ([acb45f5](https://github.com/zeroroot-ai/dashboard/commit/acb45f54ebb72a5c094a870b43994a5272124ffb))
* **review:** stop claiming that labels teach the tenant's model ([#85](https://github.com/zeroroot-ai/dashboard/issues/85)) ([456cc55](https://github.com/zeroroot-ai/dashboard/commit/456cc5560342e4b4007d09fa58e3a5637f12559d))
* **scripts:** check-ses-dns runs dnsx through an argv array ([#87](https://github.com/zeroroot-ai/dashboard/issues/87)) ([0d3a6a3](https://github.com/zeroroot-ai/dashboard/commit/0d3a6a326fbc06c180424e134cc8f1219d766c20)), closes [#11](https://github.com/zeroroot-ai/dashboard/issues/11)

## [0.121.0](https://github.com/zeroroot-ai/dashboard/compare/v0.120.12...v0.121.0) (2026-09-18)


### Features

* **graph:** the mission node carries its pinned belief-model version ([#78](https://github.com/zeroroot-ai/dashboard/issues/78)) ([6ef9530](https://github.com/zeroroot-ai/dashboard/commit/6ef95309f68519820e437932609a8254875e3362))


### Bug Fixes

* **ci:** pin every zeroroot-ai/.github reference to v0.5.1 ([#75](https://github.com/zeroroot-ai/dashboard/issues/75)) ([b7589ce](https://github.com/zeroroot-ai/dashboard/commit/b7589ce30ebb5416c2a93591820cfc56d3939516))
* **ci:** pin the last five first-party reusable refs ([#64](https://github.com/zeroroot-ai/dashboard/issues/64)) ([33a5b5c](https://github.com/zeroroot-ai/dashboard/commit/33a5b5c1a4eab46fb253e1c19e022c00a39fa929))
* **ci:** pin the org tree guards to a commit SHA ([#61](https://github.com/zeroroot-ai/dashboard/issues/61)) ([eb2dc7b](https://github.com/zeroroot-ai/dashboard/commit/eb2dc7bc49332c930a343c57877a571be820cebc))
* **ci:** unbreak the image build ([#69](https://github.com/zeroroot-ai/dashboard/issues/69)) ([380e61e](https://github.com/zeroroot-ai/dashboard/commit/380e61e4ea7e1cebcb9b3b6758eb9262dfb210e1))
* **deps:** clear the three transitive advisories Scorecard reports ([#63](https://github.com/zeroroot-ai/dashboard/issues/63)) ([ad965c0](https://github.com/zeroroot-ai/dashboard/commit/ad965c0dfd0f382b38c0675ca081298529917cee))
* **image:** ship the license text inside the published image ([#67](https://github.com/zeroroot-ai/dashboard/issues/67)) ([355ce2d](https://github.com/zeroroot-ai/dashboard/commit/355ce2d000caba8355ed80e16efdf270baac4002))
* **security:** one client-IP reader, and it trusts only the proxy-written entry ([#76](https://github.com/zeroroot-ai/dashboard/issues/76)) ([affe39d](https://github.com/zeroroot-ai/dashboard/commit/affe39daec97fac8b0fd7494ce0530dbc3700f91))
* **signup:** a completed signup lands on /login, not on the invalid-link page ([#80](https://github.com/zeroroot-ai/dashboard/issues/80)) ([e12b2d1](https://github.com/zeroroot-ai/dashboard/commit/e12b2d168ae2d861dfb70672fed115aae450c635)), closes [#79](https://github.com/zeroroot-ai/dashboard/issues/79)

## [0.120.12](https://github.com/zeroroot-ai/dashboard/compare/v0.120.11...v0.120.12) (2026-09-14)


### Bug Fixes

* **chrome:** the docs link points at the docs host, not a 404 under the marketing host ([#59](https://github.com/zeroroot-ai/dashboard/issues/59)) ([ca3a431](https://github.com/zeroroot-ai/dashboard/commit/ca3a431cc7ea0a641c93b6c7b3acfc8ce6460e03))

## [0.120.11](https://github.com/zeroroot-ai/dashboard/compare/v0.120.10...v0.120.11) (2026-09-09)


### Bug Fixes

* **ci:** grant pull-requests: read to the doc-coverage caller ([#48](https://github.com/zeroroot-ai/dashboard/issues/48)) ([9eed625](https://github.com/zeroroot-ai/dashboard/commit/9eed625d126941aa2c5527edb0ab2fb8bad69daa))
* **deps:** bump Next.js to 16.3.4 to clear the critical RCE advisories ([#45](https://github.com/zeroroot-ai/dashboard/issues/45)) ([3120975](https://github.com/zeroroot-ai/dashboard/commit/3120975bef983727269f738bb9a17b081b655c5e))

## Changelog

This repository restarted from a fresh baseline on 2026-09-06. Release notes before that date are archived offline and do not resolve on GitHub. release-please adds each release below this line.
