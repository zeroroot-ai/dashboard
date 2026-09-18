# Changelog

## [0.121.1](https://github.com/zeroroot-ai/dashboard/compare/v0.121.0...v0.121.1) (2026-09-18)


### Bug Fixes

* **analytics:** initialise google analytics once per mount ([#82](https://github.com/zeroroot-ai/dashboard/issues/82)) ([3d579b4](https://github.com/zeroroot-ai/dashboard/commit/3d579b4323cef29bc419e3bca430bcccf02a59d7))
* **config:** no workstation address in the build config ([#81](https://github.com/zeroroot-ai/dashboard/issues/81)) ([0198ead](https://github.com/zeroroot-ai/dashboard/commit/0198ead11344a706982dc59e7b1d4bb233d03591))

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
