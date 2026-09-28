# Changelog

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
