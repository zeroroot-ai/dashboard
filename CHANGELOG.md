# Changelog

All notable changes to the Gibson Dashboard are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.112.0](https://github.com/zeroroot-ai/dashboard/compare/v0.111.0...v0.112.0) (2026-06-03)


### ⚠ BREAKING CHANGES

* **authz:** consume decomposed tenant.v1 services; drop admin.v1 (ADR-0039) ([#628](https://github.com/zeroroot-ai/dashboard/issues/628))

### Features

* add MissionGraph flow-chart view to the run page ([#678](https://github.com/zeroroot-ai/dashboard/issues/678)) ([819240e](https://github.com/zeroroot-ai/dashboard/commit/819240e5cbf0197106d0b16e43d4217ff502966e))
* **authz:** consume decomposed tenant.v1 services; drop admin.v1 (ADR-0039) ([#628](https://github.com/zeroroot-ai/dashboard/issues/628)) ([2772819](https://github.com/zeroroot-ai/dashboard/commit/2772819b19448331943233ec83f4da5649e83cd4))
* **authz:** gate server CRD actions on active-tenant role + relation (closes [#614](https://github.com/zeroroot-ai/dashboard/issues/614)) ([#621](https://github.com/zeroroot-ai/dashboard/issues/621)) ([4f82366](https://github.com/zeroroot-ai/dashboard/commit/4f82366c6c76a12a3b73fea26667e9ff74915995))
* **design:** collapse to single :root token tree + violet-led palette + WCAG contrast test ([#656](https://github.com/zeroroot-ai/dashboard/issues/656)) ([d347ef6](https://github.com/zeroroot-ai/dashboard/commit/d347ef60c7ede0778dd3f2520cf5eb608b338ef7)), closes [#650](https://github.com/zeroroot-ai/dashboard/issues/650)
* **design:** rip light-mode machinery, next-themes, toggle, customizer; add check-no-light-mode guard ([#659](https://github.com/zeroroot-ai/dashboard/issues/659)) ([24255ab](https://github.com/zeroroot-ai/dashboard/commit/24255ab7bed6fad3f082b71179855ff5360f0dc9)), closes [#651](https://github.com/zeroroot-ai/dashboard/issues/651)
* **grants:** daemon-route catalog-enablement, delete ComponentGrant K8s direct path (closes [#577](https://github.com/zeroroot-ai/dashboard/issues/577)) ([#632](https://github.com/zeroroot-ai/dashboard/issues/632)) ([91bb17b](https://github.com/zeroroot-ai/dashboard/commit/91bb17be236df2d5bc396ace08469ad6028ac576))
* **graph:** attack-path emphasis + path-query highlight integration ([#689](https://github.com/zeroroot-ai/dashboard/issues/689)) ([a6ea99e](https://github.com/zeroroot-ai/dashboard/commit/a6ea99ef28a6eb0249d7bbcdba2935898d4d7b2a)), closes [#673](https://github.com/zeroroot-ai/dashboard/issues/673)
* **graph:** consolidated filters that actually apply to the rendered graph ([#683](https://github.com/zeroroot-ai/dashboard/issues/683)) ([573736e](https://github.com/zeroroot-ai/dashboard/commit/573736e977099d810193d925c7d714285a890d16)), closes [#667](https://github.com/zeroroot-ai/dashboard/issues/667)
* **graph:** cyber background layer, vignette + restrained scanline ([#639](https://github.com/zeroroot-ai/dashboard/issues/639)) ([2613c2c](https://github.com/zeroroot-ai/dashboard/commit/2613c2c7faaf429f304dbf2e8d5398c884dbd0a1)), closes [#634](https://github.com/zeroroot-ai/dashboard/issues/634)
* **graph:** deep-navy palette foundation + contrast-tuned colors ([#638](https://github.com/zeroroot-ai/dashboard/issues/638)) ([377ea43](https://github.com/zeroroot-ai/dashboard/commit/377ea431181204949791c683c3b99233f213e3fe)), closes [#633](https://github.com/zeroroot-ai/dashboard/issues/633)
* **graph:** export current view as PNG and JSON ([#687](https://github.com/zeroroot-ai/dashboard/issues/687)) ([46ec7b4](https://github.com/zeroroot-ai/dashboard/commit/46ec7b4770759dfa912d8c60c0c539e520b3864e)), closes [#671](https://github.com/zeroroot-ai/dashboard/issues/671)
* **graph:** legend + minimap for orientation ([#684](https://github.com/zeroroot-ai/dashboard/issues/684)) ([86de059](https://github.com/zeroroot-ai/dashboard/commit/86de05970069ddc476608e57de31d22826d9e385)), closes [#668](https://github.com/zeroroot-ai/dashboard/issues/668)
* **graph:** legible HUD + legend + overlay panels ([#640](https://github.com/zeroroot-ai/dashboard/issues/640)) ([7997b36](https://github.com/zeroroot-ai/dashboard/commit/7997b3681f2c2e11ab44283012a0587a022fb921)), closes [#635](https://github.com/zeroroot-ai/dashboard/issues/635)
* **graph:** live-run overlay, directional particles + pulsing running nodes ([#690](https://github.com/zeroroot-ai/dashboard/issues/690)) ([7cf12fe](https://github.com/zeroroot-ai/dashboard/commit/7cf12fe38024939e63bee84b477da66a88e852c5)), closes [#674](https://github.com/zeroroot-ai/dashboard/issues/674)
* **graph:** node manipulation, pin/unpin, hide, isolate + neighbor-expand ([#686](https://github.com/zeroroot-ai/dashboard/issues/686)) ([bfea173](https://github.com/zeroroot-ai/dashboard/commit/bfea173bb9e8a6c47c89335cee6ccce75cb16247)), closes [#670](https://github.com/zeroroot-ai/dashboard/issues/670)
* **graph:** node-label readability, halo/outline against bg and nodes ([#641](https://github.com/zeroroot-ai/dashboard/issues/641)) ([06f934d](https://github.com/zeroroot-ai/dashboard/commit/06f934dcaa14fc202b59644627a5dc974300cc52)), closes [#636](https://github.com/zeroroot-ai/dashboard/issues/636)
* **graph:** re-palette knowledge graph to violet brand + flowing-line edge flow ([#660](https://github.com/zeroroot-ai/dashboard/issues/660)) ([b7543af](https://github.com/zeroroot-ai/dashboard/commit/b7543af81a93870a1c1ac8f85b7e88eb8f5be957)), closes [#652](https://github.com/zeroroot-ai/dashboard/issues/652)
* **graph:** real Settings panel with persisted display + physics controls ([#682](https://github.com/zeroroot-ai/dashboard/issues/682)) ([359d7fe](https://github.com/zeroroot-ai/dashboard/commit/359d7fea6c0dde359100cc897cdb917df385d34d)), closes [#666](https://github.com/zeroroot-ai/dashboard/issues/666)
* **graph:** rebuild explorer on react-force-graph-2d with one view-state ([#679](https://github.com/zeroroot-ai/dashboard/issues/679)) ([e7e673b](https://github.com/zeroroot-ai/dashboard/commit/e7e673b10417b17f41eb77d9dcfa48b8d068c567)), closes [#664](https://github.com/zeroroot-ai/dashboard/issues/664)
* **graph:** search-to-focus + fit-to-selection ([#685](https://github.com/zeroroot-ai/dashboard/issues/685)) ([b0d1471](https://github.com/zeroroot-ai/dashboard/commit/b0d1471a83c8b88a068a2cedf7989b0b37717071)), closes [#669](https://github.com/zeroroot-ai/dashboard/issues/669)
* **graph:** severity heatmap for finding nodes ([#688](https://github.com/zeroroot-ai/dashboard/issues/688)) ([6a590e0](https://github.com/zeroroot-ai/dashboard/commit/6a590e0ea2cf55d619b08be005e9a8fe2cdbf5f7)), closes [#672](https://github.com/zeroroot-ai/dashboard/issues/672)
* **graph:** timeline scrubber replaying graph growth ([#691](https://github.com/zeroroot-ai/dashboard/issues/691)) ([9e50cea](https://github.com/zeroroot-ai/dashboard/commit/9e50cea55cf257dac3f639c8226e0cfe7db50245)), closes [#675](https://github.com/zeroroot-ai/dashboard/issues/675)
* **graph:** working layout switcher, force/hierarchy/radial/timeline ([#681](https://github.com/zeroroot-ai/dashboard/issues/681)) ([232d6b3](https://github.com/zeroroot-ai/dashboard/commit/232d6b3c207bac2704dc5558bd385bf883c7818a)), closes [#665](https://github.com/zeroroot-ai/dashboard/issues/665)
* **nav:** consolidate member management into a single Members & Access home (closes [#609](https://github.com/zeroroot-ai/dashboard/issues/609)) ([#629](https://github.com/zeroroot-ai/dashboard/issues/629)) ([422fc66](https://github.com/zeroroot-ai/dashboard/commit/422fc6671435de8af1cb45f5a6f72cf7bebdc3f4))


### Bug Fixes

* **authz:** authorize mission secrets-audit via the AuthRegistry, not a dead permission (closes [#616](https://github.com/zeroroot-ai/dashboard/issues/616)) ([#625](https://github.com/zeroroot-ai/dashboard/issues/625)) ([d228ab7](https://github.com/zeroroot-ai/dashboard/commit/d228ab727a750c25e4844279e6c4d160d77c5f55))
* **authz:** derive crossTenant from role, fixing the always-false gate (closes [#615](https://github.com/zeroroot-ai/dashboard/issues/615)) ([#624](https://github.com/zeroroot-ai/dashboard/issues/624)) ([fad947a](https://github.com/zeroroot-ai/dashboard/commit/fad947a452085b2675156302881318a71436bec4))
* **chat:** frame text-delta with text-start/text-end in LLM adapter ([#631](https://github.com/zeroroot-ai/dashboard/issues/631)) ([072fc1a](https://github.com/zeroroot-ai/dashboard/commit/072fc1a59c5e2aaf58f0fba6799ffcb15de9a7d5)), closes [#630](https://github.com/zeroroot-ai/dashboard/issues/630)
* destructure loading from useAuthorize in MissionFlowTab ([#680](https://github.com/zeroroot-ai/dashboard/issues/680)) ([1efded7](https://github.com/zeroroot-ai/dashboard/commit/1efded7ee48ad83f47b715072ff6aba85c270559))
* **device:** wrap useSearchParams in a Suspense boundary ([#677](https://github.com/zeroroot-ai/dashboard/issues/677)) ([e4741c3](https://github.com/zeroroot-ai/dashboard/commit/e4741c3cd3f1e35e60a0ed90014b892f2d1ce4db))
* **signup:** progress-store uses service client, not tenant-scoped userClient ([#646](https://github.com/zeroroot-ai/dashboard/issues/646)) ([#647](https://github.com/zeroroot-ai/dashboard/issues/647)) ([1f8c633](https://github.com/zeroroot-ai/dashboard/commit/1f8c633ce937cead02afa4b07982eea0e7b81535))

## [0.111.0](https://github.com/zeroroot-ai/dashboard/compare/v0.110.0...v0.111.0) (2026-06-01)


### Features

* **authz:** route UI gates through useAuthorize and delete usePermitted (closes [#604](https://github.com/zeroroot-ai/dashboard/issues/604)) ([#610](https://github.com/zeroroot-ai/dashboard/issues/610)) ([ca81676](https://github.com/zeroroot-ai/dashboard/commit/ca816768e68bc6c056a660db6a13f2ef63dce41b))


### Bug Fixes

* **nav:** dedupe Members entry and remove the GetBrokerConfig mis-gate (closes [#606](https://github.com/zeroroot-ai/dashboard/issues/606)) ([#612](https://github.com/zeroroot-ai/dashboard/issues/612)) ([01f539d](https://github.com/zeroroot-ai/dashboard/commit/01f539da18c4cb3e4cc7686fd9902ea3722617d6))

## [0.110.0](https://github.com/zeroroot-ai/dashboard/compare/v0.109.0...v0.110.0) (2026-06-01)


### Features

* author and prepopulate per-slot LLM bindings on new missions ([#546](https://github.com/zeroroot-ai/dashboard/issues/546)) ([76cf3da](https://github.com/zeroroot-ai/dashboard/commit/76cf3dab0fd3b217225626ebac1818c1587aaaaf))
* **authz:** chat + providers endpoints use the single tenant resolver ([#593](https://github.com/zeroroot-ai/dashboard/issues/593)) ([4a23ddd](https://github.com/zeroroot-ai/dashboard/commit/4a23dddfa7f597766747346cdb7193a432ac6916)), closes [#569](https://github.com/zeroroot-ai/dashboard/issues/569) [#570](https://github.com/zeroroot-ai/dashboard/issues/570) [#571](https://github.com/zeroroot-ai/dashboard/issues/571)
* **authz:** CI guard bans backing-store client deps and imports ([#599](https://github.com/zeroroot-ai/dashboard/issues/599)) ([a1c0f3b](https://github.com/zeroroot-ai/dashboard/commit/a1c0f3b6da8133a455efdeb6a874a714f8171d33))
* **authz:** components, CRD, graph, and misc endpoints use the single tenant resolver ([#595](https://github.com/zeroroot-ai/dashboard/issues/595)) ([1b62417](https://github.com/zeroroot-ai/dashboard/commit/1b62417792fe1f74228982f4f5dd2d552ea38082))
* **authz:** lock in one code path, delete session tenant authority + fallback, guard hard-fails ([#598](https://github.com/zeroroot-ai/dashboard/issues/598)) ([b108862](https://github.com/zeroroot-ai/dashboard/commit/b1088629b3bc6c34e0c0b2d829dc5d77d39e6912))
* **authz:** missions, findings, and analytics endpoints use the single tenant resolver ([#594](https://github.com/zeroroot-ai/dashboard/issues/594)) ([f0f47d9](https://github.com/zeroroot-ai/dashboard/commit/f0f47d950beff03ae4815aed24a1531d2b9a4b5c)), closes [#572](https://github.com/zeroroot-ai/dashboard/issues/572) [#573](https://github.com/zeroroot-ai/dashboard/issues/573) [#574](https://github.com/zeroroot-ai/dashboard/issues/574) [#575](https://github.com/zeroroot-ai/dashboard/issues/575)
* **authz:** route Redis + Postgres access through the daemon; delete both clients ([#597](https://github.com/zeroroot-ai/dashboard/issues/597)) ([c5bbd58](https://github.com/zeroroot-ai/dashboard/commit/c5bbd58fb4ed2a17f127e76586ca47612f107ec0))
* **authz:** single fail-closed active-tenant resolver + error contract + CI guard (warn) ([#592](https://github.com/zeroroot-ai/dashboard/issues/592)) ([3d045ba](https://github.com/zeroroot-ai/dashboard/commit/3d045ba88cfa0b195d2f66bcfca54ff6237d740b)), closes [#568](https://github.com/zeroroot-ai/dashboard/issues/568)
* **chat:** auto-title, generate conversation title from first exchange ([#463](https://github.com/zeroroot-ai/dashboard/issues/463)) ([6d92850](https://github.com/zeroroot-ai/dashboard/commit/6d928509d85e1901edd59bf7a8be45fc9b5e7f17)), closes [#448](https://github.com/zeroroot-ai/dashboard/issues/448)
* **chat:** conversation search, filter thread list by content ([#462](https://github.com/zeroroot-ai/dashboard/issues/462)) ([998da2c](https://github.com/zeroroot-ai/dashboard/commit/998da2cd86a01c20564566411038c6e7ca95bb0c)), closes [#449](https://github.com/zeroroot-ai/dashboard/issues/449)
* **chat:** copy, retry, autoscroll, empty/error states, and provider visibility ([#566](https://github.com/zeroroot-ai/dashboard/issues/566)) ([8350036](https://github.com/zeroroot-ai/dashboard/commit/8350036b7d86c225e4c3b6bd6e979a5cb232a8ed))
* **chat:** daemon-backed conversation persistence ([#460](https://github.com/zeroroot-ai/dashboard/issues/460)) ([c7a4ddf](https://github.com/zeroroot-ai/dashboard/commit/c7a4ddf36d06da38273bfe8ab5870e7ded880b39)), closes [#446](https://github.com/zeroroot-ai/dashboard/issues/446)
* **chat:** edit a prior message and regenerate from that point ([#564](https://github.com/zeroroot-ai/dashboard/issues/564)) ([b61c92c](https://github.com/zeroroot-ai/dashboard/commit/b61c92c7de412e9097f35f86f8f674e3843f335f)), closes [#553](https://github.com/zeroroot-ai/dashboard/issues/553)
* **chat:** export conversation as markdown or plaintext ([#473](https://github.com/zeroroot-ai/dashboard/issues/473)) ([633f888](https://github.com/zeroroot-ai/dashboard/commit/633f888bd815716013e43255b21ac2bb2d1f1650))
* **chat:** file attachment upload, inject file content into chat context ([#458](https://github.com/zeroroot-ai/dashboard/issues/458)) ([e0a2489](https://github.com/zeroroot-ai/dashboard/commit/e0a24891bbb908cd680c3751b938ae77a8703c7b)), closes [#442](https://github.com/zeroroot-ai/dashboard/issues/442)
* **chat:** finalize interrupted streams and handle mid-stream conversation switches ([#565](https://github.com/zeroroot-ai/dashboard/issues/565)) ([ccb2d2c](https://github.com/zeroroot-ai/dashboard/commit/ccb2d2cfef986bcf6fcfb0952e72614de8654f8b)), closes [#555](https://github.com/zeroroot-ai/dashboard/issues/555)
* **chat:** inject Redis, Langfuse, and platform context into system prompt ([#451](https://github.com/zeroroot-ai/dashboard/issues/451)) ([481c831](https://github.com/zeroroot-ai/dashboard/commit/481c831994152be078f9cf581a6a2e32b320913b)), closes [#437](https://github.com/zeroroot-ai/dashboard/issues/437) [#438](https://github.com/zeroroot-ai/dashboard/issues/438) [#439](https://github.com/zeroroot-ai/dashboard/issues/439)
* **chat:** knowledge-graph citations surface source nodes in assistant messages ([#454](https://github.com/zeroroot-ai/dashboard/issues/454)) ([a57675e](https://github.com/zeroroot-ai/dashboard/commit/a57675e25cc36b78976afc0f2a5b04cd3b612826))
* **chat:** lossless parts-based message normalizer ([#561](https://github.com/zeroroot-ai/dashboard/issues/561)) ([4b8ac4e](https://github.com/zeroroot-ai/dashboard/commit/4b8ac4e20ca22f2ce45b0b765c674a34113ab99e))
* **chat:** Mermaid diagram rendering in assistant messages ([#457](https://github.com/zeroroot-ai/dashboard/issues/457)) ([402c09c](https://github.com/zeroroot-ai/dashboard/commit/402c09c7a57d51492027b06fa80e0e599d6fbc6f))
* **chat:** migrate chat UI shell to @assistant-ui/react ([#452](https://github.com/zeroroot-ai/dashboard/issues/452)) ([3a78972](https://github.com/zeroroot-ai/dashboard/commit/3a789720fd599fd1f74c5e02693ef4831aceae99)), closes [#436](https://github.com/zeroroot-ai/dashboard/issues/436)
* **chat:** persist conversations via daemon SaveConversation RPC ([#556](https://github.com/zeroroot-ai/dashboard/issues/556)) ([9479683](https://github.com/zeroroot-ai/dashboard/commit/947968324bc09b3d5570ae4137cdfe6607ed5cb6))
* **chat:** persona system, audience-aware dropdown replaces agent selector ([#453](https://github.com/zeroroot-ai/dashboard/issues/453)) ([1f5dbf4](https://github.com/zeroroot-ai/dashboard/commit/1f5dbf41e12e0a7b41093cd1900c4596f2aa2e59))
* **chat:** pin, rename, and delete conversation threads ([#472](https://github.com/zeroroot-ai/dashboard/issues/472)) ([d718796](https://github.com/zeroroot-ai/dashboard/commit/d7187963bf28347c752d72efa827ee7f05747383))
* **chat:** rename and delete conversations via daemon RPCs ([#562](https://github.com/zeroroot-ai/dashboard/issues/562)) ([0f1c070](https://github.com/zeroroot-ai/dashboard/commit/0f1c070d55b7bc26e209c77bc9e3f6676e559206)), closes [#551](https://github.com/zeroroot-ai/dashboard/issues/551)
* **chat:** stop streaming and persist the partial response ([#563](https://github.com/zeroroot-ai/dashboard/issues/563)) ([9295f3c](https://github.com/zeroroot-ai/dashboard/commit/9295f3c3dcfa886b08310e35a1b2329552529f35)), closes [#552](https://github.com/zeroroot-ai/dashboard/issues/552)
* **chat:** system prompt viewer, debug panel showing injected context layers ([#455](https://github.com/zeroroot-ai/dashboard/issues/455)) ([af2aaf8](https://github.com/zeroroot-ai/dashboard/commit/af2aaf893db13ca1b8ecb359e82a90f011bbe332)), closes [#444](https://github.com/zeroroot-ai/dashboard/issues/444)
* **chat:** thumbs-up/down feedback with trace-id round-trip ([#456](https://github.com/zeroroot-ai/dashboard/issues/456)) ([39d7457](https://github.com/zeroroot-ai/dashboard/commit/39d74573a89ac3a7ffe55d5ce70ce75ccebae987))
* deep-link Usage by-user rows into the Traces list ([#483](https://github.com/zeroroot-ai/dashboard/issues/483)) ([f81be2c](https://github.com/zeroroot-ai/dashboard/commit/f81be2c3f3fff2745893d2df36b2d45b1102ad88)), closes [#471](https://github.com/zeroroot-ai/dashboard/issues/471)
* **missions/events:** emit log frames from Loki tail; wire into terminal hook ([#394](https://github.com/zeroroot-ai/dashboard/issues/394)) ([89e39fa](https://github.com/zeroroot-ai/dashboard/commit/89e39fabd32f5575a440e8869b92a94adf9cbf3e))
* **missions:** fleshed-out New Mission default template (Run enabled on fresh) ([#499](https://github.com/zeroroot-ai/dashboard/issues/499)) ([35bd34d](https://github.com/zeroroot-ai/dashboard/commit/35bd34db8f9094e0758479b7d57261a3500d8285)), closes [#492](https://github.com/zeroroot-ai/dashboard/issues/492)
* **missions:** iteration-safe run (create-or-update, no AlreadyExists) ([#502](https://github.com/zeroroot-ai/dashboard/issues/502)) ([dde71fe](https://github.com/zeroroot-ai/dashboard/commit/dde71fe5219d81a4db6010f0aadb934876d68ec4)), closes [#494](https://github.com/zeroroot-ai/dashboard/issues/494)
* **missions:** open existing mission loads real CUE (delete stub path) ([#501](https://github.com/zeroroot-ai/dashboard/issues/501)) ([77d4ee5](https://github.com/zeroroot-ai/dashboard/commit/77d4ee5b485ef0c9b3add077b74c6471382c3351)), closes [#495](https://github.com/zeroroot-ai/dashboard/issues/495)
* **missions:** prepopulate New Mission slot from tenant default provider ([#531](https://github.com/zeroroot-ai/dashboard/issues/531)) ([dbe21d8](https://github.com/zeroroot-ai/dashboard/commit/dbe21d834fd9c337a530f1523f43f094cf0a7148))
* **missions:** rebrand source store + rip out drafts UI/vocabulary ([#503](https://github.com/zeroroot-ai/dashboard/issues/503)) ([52ab17a](https://github.com/zeroroot-ai/dashboard/commit/52ab17a211a3eb50bde7e758d1e882fbd2dc0176)), closes [#496](https://github.com/zeroroot-ai/dashboard/issues/496)
* **missions:** split Mission Results from the authoring library ([#504](https://github.com/zeroroot-ai/dashboard/issues/504)) ([70cf13a](https://github.com/zeroroot-ai/dashboard/commit/70cf13a4ecef51cd0314b8658fb23d118c39d706)), closes [#497](https://github.com/zeroroot-ai/dashboard/issues/497)
* **missions:** useMissionEditor state machine + autosave/Save/dirty UX ([#500](https://github.com/zeroroot-ai/dashboard/issues/500)) ([f55efb7](https://github.com/zeroroot-ai/dashboard/commit/f55efb78f2fc9546acc9860d6161d97e0477bf77)), closes [#493](https://github.com/zeroroot-ai/dashboard/issues/493)
* prompt/response drill-down on the mission Traces tab ([#478](https://github.com/zeroroot-ai/dashboard/issues/478)) ([307cad0](https://github.com/zeroroot-ai/dashboard/commit/307cad02fb294951887d5ef86b6adaf579d00eae)), closes [#466](https://github.com/zeroroot-ai/dashboard/issues/466)
* standalone trace detail page + GET /api/traces/[traceId] ([#481](https://github.com/zeroroot-ai/dashboard/issues/481)) ([20cad42](https://github.com/zeroroot-ai/dashboard/commit/20cad42b240b8c5be1cab5d4be8713faa69bbc7a)), closes [#470](https://github.com/zeroroot-ai/dashboard/issues/470)
* tags filter on Traces + by-agent/by-mission Usage deep-links ([#488](https://github.com/zeroroot-ai/dashboard/issues/488)) ([77ff85e](https://github.com/zeroroot-ai/dashboard/commit/77ff85e5d830e7b58a05f9dbd7c2e13acd6e1d20))
* **targets:** expose all tweakable fields in the create/edit form ([#513](https://github.com/zeroroot-ai/dashboard/issues/513)) ([9c806f6](https://github.com/zeroroot-ai/dashboard/commit/9c806f643b3de690381472883cc74b5d91225ed7))
* **targets:** first-class Targets management page (list/create/edit/delete) ([#512](https://github.com/zeroroot-ai/dashboard/issues/512)) ([76a681c](https://github.com/zeroroot-ai/dashboard/commit/76a681c5cd46fc703784fc0232c4c128d73af509))
* **targets:** UUID-canonical mission pre-step + target CRUD server actions ([#511](https://github.com/zeroroot-ai/dashboard/issues/511)) ([27bf15a](https://github.com/zeroroot-ai/dashboard/commit/27bf15acdfc4454ffc9cadb35c1fe6b4abc0d8c0))
* tenant-wide /dashboard/traces list + GET /api/traces + nav entry ([#480](https://github.com/zeroroot-ai/dashboard/issues/480)) ([d4c9ec7](https://github.com/zeroroot-ai/dashboard/commit/d4c9ec7341f5aeafadc80de52f739c9d8439aef6)), closes [#469](https://github.com/zeroroot-ai/dashboard/issues/469)
* token & cost summary panel on the mission Traces tab ([#479](https://github.com/zeroroot-ai/dashboard/issues/479)) ([ec3f58c](https://github.com/zeroroot-ai/dashboard/commit/ec3f58ccd97e48b9fb6ecad32bb669ec10efb23f)), closes [#467](https://github.com/zeroroot-ai/dashboard/issues/467)
* **traces:** first-class Spend view (by-agent / by-model) on the run ([#538](https://github.com/zeroroot-ai/dashboard/issues/538)) ([52685c9](https://github.com/zeroroot-ai/dashboard/commit/52685c990c50953cfdc5f08cb5a80e0a24f2b13c)), closes [#534](https://github.com/zeroroot-ai/dashboard/issues/534)
* **traces:** per-mission runs list with drill-down to traces ([#541](https://github.com/zeroroot-ai/dashboard/issues/541)) ([1595e2a](https://github.com/zeroroot-ai/dashboard/commit/1595e2ae219c50726c014fa58daab1d83a53ff8f)), closes [#535](https://github.com/zeroroot-ai/dashboard/issues/535)
* **traces:** route trace reads + feedback through the daemon; delete the Langfuse client ([#596](https://github.com/zeroroot-ai/dashboard/issues/596)) ([7bff59b](https://github.com/zeroroot-ai/dashboard/commit/7bff59bf86ab89849e93f503503b36ba7b6830c4)), closes [#588](https://github.com/zeroroot-ai/dashboard/issues/588)
* **traces:** surface the error correlationId in the Traces banner ([#520](https://github.com/zeroroot-ai/dashboard/issues/520)) ([09866e8](https://github.com/zeroroot-ai/dashboard/commit/09866e8af2e9c5d0aae2b942b4d55fa1d5638a02)), closes [#516](https://github.com/zeroroot-ai/dashboard/issues/516)
* **traces:** train-of-thought timeline as the default run view ([#537](https://github.com/zeroroot-ai/dashboard/issues/537)) ([1ba3ace](https://github.com/zeroroot-ai/dashboard/commit/1ba3ace9ed656fabf81c1cea6fa464de522c8f3c)), closes [#533](https://github.com/zeroroot-ai/dashboard/issues/533)
* use Gibson logo as the dashboard favicon ([#477](https://github.com/zeroroot-ai/dashboard/issues/477)) ([748cc8a](https://github.com/zeroroot-ai/dashboard/commit/748cc8a92f4462895b3c80dccc30be6c0bcc95c9))


### Bug Fixes

* **ai:** update stale langchaingo comments to Eino ([#427](https://github.com/zeroroot-ai/dashboard/issues/427)) ([7a0910a](https://github.com/zeroroot-ai/dashboard/commit/7a0910a91152204abc735f44dad166c53c9b9ffa))
* **auth:** re-encode base64 '+' in OIDC callback URL before Auth.js parses it ([#426](https://github.com/zeroroot-ai/dashboard/issues/426)) ([0d26948](https://github.com/zeroroot-ai/dashboard/commit/0d26948593db81157e6a35c34f0b353861812361))
* **authz:** restore daemon-RPC onboarding/status route clobbered by [#598](https://github.com/zeroroot-ai/dashboard/issues/598) merge ([#600](https://github.com/zeroroot-ai/dashboard/issues/600)) ([6078a5c](https://github.com/zeroroot-ai/dashboard/commit/6078a5cbbe56a6622f169f87fb6ca2bed7af8c82))
* **billing:** show quota cards even when plan ID is unrecognised ([#433](https://github.com/zeroroot-ai/dashboard/issues/433)) ([1de4f6c](https://github.com/zeroroot-ai/dashboard/commit/1de4f6cf1c14e6a4960e34ee96baaab5215835cf))
* **billing:** show real plan name from GetTenantQuotaResponse ([#431](https://github.com/zeroroot-ai/dashboard/issues/431)) ([45eeb88](https://github.com/zeroroot-ai/dashboard/commit/45eeb885f1b08f9be023e0b9323b955ccb61c7bb)), closes [#430](https://github.com/zeroroot-ai/dashboard/issues/430)
* **build:** sync package-lock.json, drop dead pg code, fix nodeenv allowlist ([#601](https://github.com/zeroroot-ai/dashboard/issues/601)) ([4584ca5](https://github.com/zeroroot-ai/dashboard/commit/4584ca5ae85ba0295485723f406d98f9af913f6e))
* **chat:** accept AI SDK v6 UIMessage format in /api/chat ([#486](https://github.com/zeroroot-ai/dashboard/issues/486)) ([6013f2a](https://github.com/zeroroot-ai/dashboard/commit/6013f2a99cb5e501c55fd0654a1b80b8e7d92a1a))
* **chat:** drop console.* from useChat persistence catch block ([#485](https://github.com/zeroroot-ai/dashboard/issues/485)) ([68d7ea2](https://github.com/zeroroot-ai/dashboard/commit/68d7ea24d94562f687d66b86750eb59363387991))
* **chat:** replace console.warn with console.error in useChat hook ([#484](https://github.com/zeroroot-ai/dashboard/issues/484)) ([4c5cbef](https://github.com/zeroroot-ai/dashboard/commit/4c5cbef57116e2dff88524ad0d29c6e27e026a1b))
* **chat:** surface real stream errors instead of masking them ([#517](https://github.com/zeroroot-ai/dashboard/issues/517)) ([b8eaf47](https://github.com/zeroroot-ai/dashboard/commit/b8eaf4799495b159559c2371d0a505371d6e6689))
* **chat:** switch to toUIMessageStreamResponse() for AI SDK v6 compatibility ([#506](https://github.com/zeroroot-ai/dashboard/issues/506)) ([1326f9a](https://github.com/zeroroot-ai/dashboard/commit/1326f9a4626e8b7d623e6455ddeed5fd3401550c))
* **deps:** sync package-lock.json with pnpm-added packages ([#476](https://github.com/zeroroot-ai/dashboard/issues/476)) ([319b781](https://github.com/zeroroot-ai/dashboard/commit/319b781d6b3153b0435aaa1795e5d5425b6bf4b1))
* **landing:** replace internal vendor names with customer-facing language in architecture diagram ([#397](https://github.com/zeroroot-ai/dashboard/issues/397)) ([0c4142e](https://github.com/zeroroot-ai/dashboard/commit/0c4142edb6f71e65748742670c1840abd2bf58a8))
* **missions/create:** reset terminal state between runs for rapid iteration ([#405](https://github.com/zeroroot-ai/dashboard/issues/405)) ([edbde70](https://github.com/zeroroot-ai/dashboard/commit/edbde70a119f7ab1788622b2df392b20c8962470))
* **missions/create:** shrink editor to 35vh so terminal is co-visible ([#403](https://github.com/zeroroot-ai/dashboard/issues/403)) ([b60ca9a](https://github.com/zeroroot-ai/dashboard/commit/b60ca9a47d7cac54a313400ec23bf133ac22d4e1))
* **missions/create:** surface actionable error when definition name already exists ([#415](https://github.com/zeroroot-ai/dashboard/issues/415)) ([d76f089](https://github.com/zeroroot-ai/dashboard/commit/d76f0899005bb27c7395c497afb2f42b6731f976))
* **missions:** destructure useAuthorize in results detail; drain allowlist ([#505](https://github.com/zeroroot-ai/dashboard/issues/505)) ([41bff11](https://github.com/zeroroot-ai/dashboard/commit/41bff1144b25d79904b7bb8dae79df22312f9ccf))
* **missions:** editor Run dispatches execution (RunMission), not just create ([#514](https://github.com/zeroroot-ai/dashboard/issues/514)) ([efc0b2d](https://github.com/zeroroot-ai/dashboard/commit/efc0b2dabcd32bf47d1569c517dec9c588cef40c))
* **missions:** improve terminal readability, font size, foreground, line-height ([#404](https://github.com/zeroroot-ai/dashboard/issues/404)) ([882885f](https://github.com/zeroroot-ai/dashboard/commit/882885f64790221b139434288ba37f7e11f7b6e4))
* **missions:** parseCueName matches indented name: field inside mission: {} ([#413](https://github.com/zeroroot-ai/dashboard/issues/413)) ([dd37a0b](https://github.com/zeroroot-ai/dashboard/commit/dd37a0b7ec48a2647fa9f2b4d570d8ccacdbdb1c))
* **proto:** populate gibson.platform.v1 and gibson.admin.v1 in AuthRegistry ([#417](https://github.com/zeroroot-ai/dashboard/issues/417)) ([45b6b5c](https://github.com/zeroroot-ai/dashboard/commit/45b6b5c8e2201a63b94b79bde19375ac2b8effda)), closes [#406](https://github.com/zeroroot-ai/dashboard/issues/406)
* **providers:** add PUT alias + unwrap {config} body wrapper in update route ([#490](https://github.com/zeroroot-ai/dashboard/issues/490)) ([a600e4c](https://github.com/zeroroot-ai/dashboard/commit/a600e4c686a2202fc932b81fd2a2f5a652d43fbf))
* **providers:** catch getServerSession errors in POST handler ([#429](https://github.com/zeroroot-ai/dashboard/issues/429)) ([66b4441](https://github.com/zeroroot-ai/dashboard/commit/66b444141764706fb1b5e63be539e0c6ce4db27c))
* **providers:** correct createProvider body shape + suppress hydration warning ([#428](https://github.com/zeroroot-ai/dashboard/issues/428)) ([a609788](https://github.com/zeroroot-ai/dashboard/commit/a609788547b2fe374ef878886ffec91608cf62f4))
* **providers:** log daemon 5xx ConnectErrors that translateError was swallowing ([#432](https://github.com/zeroroot-ai/dashboard/issues/432)) ([bf1d530](https://github.com/zeroroot-ai/dashboard/commit/bf1d5300e091fe2bd549507e16125616cff27709))
* **providers:** map DaemonProviderRecord to ProviderConfig in route handlers ([#434](https://github.com/zeroroot-ai/dashboard/issues/434)) ([0a440c7](https://github.com/zeroroot-ai/dashboard/commit/0a440c71714306ccc0f38a94ee21ac505207abc2))
* **providers:** merge existing provider record before UpdateProvider RPC ([#498](https://github.com/zeroroot-ai/dashboard/issues/498)) ([bd9cefa](https://github.com/zeroroot-ai/dashboard/commit/bd9cefa8ab881f9ffccb2a4a5375e4529beb5131))
* **providers:** test-connection health endpoint + isConfigured + React [#31](https://github.com/zeroroot-ai/dashboard/issues/31) ([#487](https://github.com/zeroroot-ai/dashboard/issues/487)) ([3662f19](https://github.com/zeroroot-ai/dashboard/commit/3662f19a98ed86eeb97d0777ff0660c5035f664b))
* **providers:** wire test connection in edit-credentials modal ([#491](https://github.com/zeroroot-ai/dashboard/issues/491)) ([f646c2f](https://github.com/zeroroot-ai/dashboard/commit/f646c2fa9d572646714aa67f368373b28488310e))
* repair /dashboard/chat part-scope crash and traces formatUsd build break ([#539](https://github.com/zeroroot-ai/dashboard/issues/539)) ([372391e](https://github.com/zeroroot-ai/dashboard/commit/372391e11c554c96d8fe0ccc56817841cd11b5d3))
* **security:** lock test/debug escape-hatch routes against prod config (closes [#557](https://github.com/zeroroot-ai/dashboard/issues/557)) ([#560](https://github.com/zeroroot-ai/dashboard/issues/560)) ([fe716dd](https://github.com/zeroroot-ai/dashboard/commit/fe716dd5da2f62c4bbac88d098e0fbeead9bdbb8))
* **stores:** replace Zustand getter properties with plain selectors in onboarding-store ([#410](https://github.com/zeroroot-ai/dashboard/issues/410)) ([77f4df1](https://github.com/zeroroot-ai/dashboard/commit/77f4df1e6186c32fc9720b555c999159a1ae4870))
* **teams:** stop double-prefixing tenant id in TenantAdminService calls ([#603](https://github.com/zeroroot-ai/dashboard/issues/603)) ([d2ad556](https://github.com/zeroroot-ai/dashboard/commit/d2ad556a0f097f56b9dac625953cdbd8b6adb63c))
* **tests:** repair assertion drift and SSE timer leak from [#396](https://github.com/zeroroot-ai/dashboard/issues/396) ([#422](https://github.com/zeroroot-ai/dashboard/issues/422)) ([aa5fedc](https://github.com/zeroroot-ai/dashboard/commit/aa5fedcfb329d62dfa0d1a92613699e470654d09))
* **tests:** update CRD test stubs and add telemetryInterceptor null guard ([#416](https://github.com/zeroroot-ai/dashboard/issues/416)) ([e3826fc](https://github.com/zeroroot-ai/dashboard/commit/e3826fc0764da845af460d56e90a0dd26840acb2)), closes [#408](https://github.com/zeroroot-ai/dashboard/issues/408)
* **tests:** update UI snapshot assertions to match current component output ([#414](https://github.com/zeroroot-ai/dashboard/issues/414)) ([53df402](https://github.com/zeroroot-ai/dashboard/commit/53df40231c27b47fcf4eb6d1cc6400fea723afa1)), closes [#409](https://github.com/zeroroot-ai/dashboard/issues/409)
* **traces:** export formatUsd from trace-utils (main was broken) ([#540](https://github.com/zeroroot-ai/dashboard/issues/540)) ([0b14849](https://github.com/zeroroot-ai/dashboard/commit/0b148497d296083c3da686cf95d69edfeda0cd03))
* **traces:** map unparseable Langfuse responses to a typed 503 ([#518](https://github.com/zeroroot-ai/dashboard/issues/518)) ([cb8815a](https://github.com/zeroroot-ai/dashboard/commit/cb8815ac94a44e77dbf9a1f190a18cc1fe8e6ed2)), closes [#515](https://github.com/zeroroot-ai/dashboard/issues/515)
* **traces:** repair main build + land [#536](https://github.com/zeroroot-ai/dashboard/issues/536) cohesion header ([#544](https://github.com/zeroroot-ai/dashboard/issues/544)) ([8a42af7](https://github.com/zeroroot-ai/dashboard/commit/8a42af7f1a2ddb902e8ea4916cda5cecee74b33b))
* **traces:** send Langfuse v3 JSON orderBy (fixes Traces 400) ([#529](https://github.com/zeroroot-ai/dashboard/issues/529)) ([ee5a8ec](https://github.com/zeroroot-ai/dashboard/commit/ee5a8ecc92eb14e0512663a7a41f881acb7803e6))
* **traces:** use Langfuse v3 column.DIRECTION orderBy (corrects [#529](https://github.com/zeroroot-ai/dashboard/issues/529)) ([#530](https://github.com/zeroroot-ai/dashboard/issues/530)) ([aa55bce](https://github.com/zeroroot-ai/dashboard/commit/aa55bcecd20937da7c5049971ffd9b358661208e))


### Reverts

* **landing:** remove architecture diagram ([#399](https://github.com/zeroroot-ai/dashboard/issues/399)) ([1fba2fe](https://github.com/zeroroot-ai/dashboard/commit/1fba2fe1ac3a666ad629937c6b9649a09ce59b2e))

## [0.109.0](https://github.com/zeroroot-ai/dashboard/compare/v0.108.0...v0.109.0) (2026-05-26)


### Features

* **crd:** migrate access/role/ownership/install actions to userClient(TenantAdminService) ([#362](https://github.com/zeroroot-ai/dashboard/issues/362)) ([05a0488](https://github.com/zeroroot-ai/dashboard/commit/05a0488031239cd16cb69a78657676ba424765b3))
* **landing:** update H1 to "Zero Trust agent factory in under an hour" ([#388](https://github.com/zeroroot-ai/dashboard/issues/388)) ([77c4d85](https://github.com/zeroroot-ai/dashboard/commit/77c4d85c742f03c4c3b0ff9272d4fbfdb06d4c71))
* **missions/create:** stay on page after Run Mission; show result in terminal ([#390](https://github.com/zeroroot-ai/dashboard/issues/390)) ([c99a043](https://github.com/zeroroot-ai/dashboard/commit/c99a04365eff35b28dd4332bbc2e3768e71613e9))
* **missions/create:** useMissionTerminal hook, live SSE status and tool events ([#391](https://github.com/zeroroot-ai/dashboard/issues/391)) ([3350306](https://github.com/zeroroot-ai/dashboard/commit/3350306cb8c2b4a0f1ea41a8b95f2076da6a93a0)), closes [#384](https://github.com/zeroroot-ai/dashboard/issues/384)
* **missions:** MissionTerminal component, xterm.js shell with resize and collapse ([#387](https://github.com/zeroroot-ai/dashboard/issues/387)) ([a8b5aa5](https://github.com/zeroroot-ai/dashboard/commit/a8b5aa55d8090aa513678a566eebad2f3230b8e4))
* **missions:** replace Logs tab placeholder with MissionTerminal snapshot view ([#389](https://github.com/zeroroot-ai/dashboard/issues/389)) ([825b348](https://github.com/zeroroot-ai/dashboard/commit/825b3484cb9d61c1a9c81b03dd319ac4fb38e604))
* **missions:** restore mission clone via CUE source path ([#354](https://github.com/zeroroot-ai/dashboard/issues/354)) ([46a9100](https://github.com/zeroroot-ai/dashboard/commit/46a91006e1ed577160cc4650c2a3dd24615fc478))
* **missions:** wire CUE submit path, ValidateMissionCUE now returns compiled definition ([#351](https://github.com/zeroroot-ai/dashboard/issues/351)) ([397c2ad](https://github.com/zeroroot-ai/dashboard/commit/397c2adefd886665b9388dbc54d201a27234c78b))
* **onboarding:** use RevealableInput for LLM API key field ([#374](https://github.com/zeroroot-ai/dashboard/issues/374)) ([1803aab](https://github.com/zeroroot-ai/dashboard/commit/1803aab398cdef75cdc53d7f24725f964d475a3c))
* **providers:** use RevealableInput for PASSWORD-type credential fields ([#373](https://github.com/zeroroot-ai/dashboard/issues/373)) ([3564df1](https://github.com/zeroroot-ai/dashboard/commit/3564df122674640735840dd61485e455c533fa47))
* **secrets-backend:** use RevealableInput for sensitive credential fields ([#375](https://github.com/zeroroot-ai/dashboard/issues/375)) ([1c769e8](https://github.com/zeroroot-ai/dashboard/commit/1c769e870c0352bea18b7b0055eafa2932aecc8e))
* **secrets:** use RevealableInput for secret value and rotation fields ([#371](https://github.com/zeroroot-ai/dashboard/issues/371)) ([01e5412](https://github.com/zeroroot-ai/dashboard/commit/01e5412c36caf257e37ac2c19d22738b1fa10033))
* **teams:** migrate team CRD actions to userClient(TenantAdminService) ([#361](https://github.com/zeroroot-ai/dashboard/issues/361)) ([0e594f8](https://github.com/zeroroot-ai/dashboard/commit/0e594f8a33c0a0ea31c882ea2f94da02c10fce89))
* **ui:** add RevealableInput component with eye-toggle for password fields ([#370](https://github.com/zeroroot-ai/dashboard/issues/370)) ([cd01b39](https://github.com/zeroroot-ai/dashboard/commit/cd01b397a279a79097020863206b11c908c5fdd7))


### Bug Fixes

* **missions/create:** two-row toolbar so Run Mission button is always visible ([#386](https://github.com/zeroroot-ai/dashboard/issues/386)) ([c895748](https://github.com/zeroroot-ai/dashboard/commit/c895748fe47449a56c235e461766c35d03764027))
* **missions:** wrap DEFAULT_CUE and scaffoldCUE under mission: {} field ([#377](https://github.com/zeroroot-ai/dashboard/issues/377)) ([e7aa080](https://github.com/zeroroot-ai/dashboard/commit/e7aa080ab4fb01dacc7fd8fbf8524b556c2a1bd1))
* **providers:** correct fallback-chain API client URL ([#393](https://github.com/zeroroot-ai/dashboard/issues/393)) ([6241c2e](https://github.com/zeroroot-ai/dashboard/commit/6241c2e00dbb521f141eae827d01482d7c5a516d)), closes [#392](https://github.com/zeroroot-ai/dashboard/issues/392)
* redirect to sign-in when session carries opaque (non-JWT) access token ([#360](https://github.com/zeroroot-ai/dashboard/issues/360)) ([79e1795](https://github.com/zeroroot-ai/dashboard/commit/79e179569c01d0d37b764c57f484293c599efb32))
* remove export type re-exports from use server files (Turbopack crash) ([#356](https://github.com/zeroroot-ai/dashboard/issues/356)) ([1f17441](https://github.com/zeroroot-ai/dashboard/commit/1f17441c561270dd2ede239296e2b159daa6e072))

## [0.108.0](https://github.com/zeroroot-ai/dashboard/compare/v0.107.0...v0.108.0) (2026-05-24)


### Features

* **settings:** member picker and Members settings page ([#348](https://github.com/zeroroot-ai/dashboard/issues/348)) ([69b9951](https://github.com/zeroroot-ai/dashboard/commit/69b99513b07e0433f5697899c9984b0aef5fdda5))


### Bug Fixes

* **ci:** add path filter to PR image builds ([#345](https://github.com/zeroroot-ai/dashboard/issues/345)) ([bc99821](https://github.com/zeroroot-ai/dashboard/commit/bc998214a67a7206c20c90e8d355ff24cb8c7a24))
* **ci:** remove PR trigger and use security-extended for CodeQL ([#346](https://github.com/zeroroot-ai/dashboard/issues/346)) ([69dcb1a](https://github.com/zeroroot-ai/dashboard/commit/69dcb1aa55086194c8d43a0203a2303b3c43adb3))
* **docs:** move docs pages from src/app/ to app/, Next.js ignores src/app when app/ exists ([#338](https://github.com/zeroroot-ai/dashboard/issues/338)) ([acffd04](https://github.com/zeroroot-ai/dashboard/commit/acffd046d40b4c5bbb1b6a26ac9b5b3fcb208e56))
* **prebuild:** skip check-auth-rbac-inventory-fresh when enterprise/docs absent ([#349](https://github.com/zeroroot-ai/dashboard/issues/349)) ([3d021de](https://github.com/zeroroot-ai/dashboard/commit/3d021de4e4991364a477926a3f79c74b4a0c9f6f))
* **settings:** profile name/email, billing errors, and nav overhaul ([#344](https://github.com/zeroroot-ai/dashboard/issues/344)) ([c395364](https://github.com/zeroroot-ai/dashboard/commit/c3953643ef870e8034ac3a5fd991bb0441cb160f))
* **tests:** update stale ProvidersContent tests for ProviderWizard refactor ([#341](https://github.com/zeroroot-ai/dashboard/issues/341)) ([c77c10d](https://github.com/zeroroot-ai/dashboard/commit/c77c10dc450cd883264a52ba66210279a05b9b41))

## [0.107.0](https://github.com/zeroroot-ai/dashboard/compare/v0.106.0...v0.107.0) (2026-05-24)


### Features

* **dashboard:** migrate PlatformOperatorService → DaemonOperatorService; drop daemon/admin + tenant_admin gen ([#337](https://github.com/zeroroot-ai/dashboard/issues/337)) ([045ab8f](https://github.com/zeroroot-ai/dashboard/commit/045ab8fca00456c524be8057fca04ac76d5358c3))
* **missions/create:** DefinitionPickerDropdown + ?definition= hydration ([#323](https://github.com/zeroroot-ai/dashboard/issues/323)) ([#331](https://github.com/zeroroot-ai/dashboard/issues/331)) ([7765af7](https://github.com/zeroroot-ai/dashboard/commit/7765af742fb627042b6ef4110ff46a60708f7037))
* **missions/create:** DefinitionPickerDropdown component ([#322](https://github.com/zeroroot-ai/dashboard/issues/322)) ([#330](https://github.com/zeroroot-ai/dashboard/issues/330)) ([cf1cfa2](https://github.com/zeroroot-ai/dashboard/commit/cf1cfa22f04028d0d3f41b72362bff58910515aa))
* **missions/create:** replace localStorage autosave with useServerAutosave, upsert draft on run ([#325](https://github.com/zeroroot-ai/dashboard/issues/325)) ([#329](https://github.com/zeroroot-ai/dashboard/issues/329)) ([c309898](https://github.com/zeroroot-ai/dashboard/commit/c3098986225a37ad8da51c371c5a4056d1856bea))
* **missions:** definition list API route and useListMissionDefinitions hook ([#327](https://github.com/zeroroot-ai/dashboard/issues/327)) ([0bb5ada](https://github.com/zeroroot-ai/dashboard/commit/0bb5adad299938bb3178354a27fcac991894d260))
* **missions:** edit definition button on missions list ([#324](https://github.com/zeroroot-ai/dashboard/issues/324)) ([#332](https://github.com/zeroroot-ai/dashboard/issues/332)) ([6527277](https://github.com/zeroroot-ai/dashboard/commit/6527277b2101428e13d7b8d843d0fe28cc58261a))
* **missions:** expose missionDefinitionId on missions API and Mission type ([#326](https://github.com/zeroroot-ai/dashboard/issues/326)) ([c380f13](https://github.com/zeroroot-ai/dashboard/commit/c380f13e869b1c3b380987010a04014aa0e81d5e))
* **missions:** useServerAutosave hook, daemon-backed draft autosave ([#328](https://github.com/zeroroot-ai/dashboard/issues/328)) ([2a1951d](https://github.com/zeroroot-ai/dashboard/commit/2a1951db51ed70c416d908d8416701137ed90fdd))


### Bug Fixes

* **missions/editor:** set explicit height so Monaco renders above 0px ([#316](https://github.com/zeroroot-ai/dashboard/issues/316)) ([ca48c89](https://github.com/zeroroot-ai/dashboard/commit/ca48c89f837fd9c6d480d2b5e4d70d872acdbc23))
* **missions:** correct FGA path for createMissionFromCUEAction authz check ([#334](https://github.com/zeroroot-ai/dashboard/issues/334)) ([b57f6c0](https://github.com/zeroroot-ai/dashboard/commit/b57f6c0e7cd441ef7a9c40c57d55a471cf1688dd))
* remove dead ActionResult re-export from use server file ([#333](https://github.com/zeroroot-ai/dashboard/issues/333)) ([54bf61d](https://github.com/zeroroot-ai/dashboard/commit/54bf61d7ea8cfeebc33998771d27f52490981be2))

## [0.106.0](https://github.com/zeroroot-ai/dashboard/compare/v0.105.0...v0.106.0) (2026-05-24)


### Features

* add pnpm audit security workflow ([#256](https://github.com/zeroroot-ai/dashboard/issues/256)) ([5736227](https://github.com/zeroroot-ai/dashboard/commit/57362274a9258f1f358dbb86c7fbe53ca39c43dc))
* **missions/templates:** vendor .cue sources; delete JSON; drift gate; CUE preview ([#311](https://github.com/zeroroot-ai/dashboard/issues/311)) ([657a3c3](https://github.com/zeroroot-ai/dashboard/commit/657a3c37008722585fc477148277dbcc31549a4b))
* **missions:** move create page to src/app; delete API route; add ?template= support ([#308](https://github.com/zeroroot-ai/dashboard/issues/308)) ([99ac65c](https://github.com/zeroroot-ai/dashboard/commit/99ac65c21c453702b0320d590af36c83c57c29d3))
* **missions:** replace Monaco YAML editor with CUE editor; delete YAML layer ([#307](https://github.com/zeroroot-ai/dashboard/issues/307)) ([b9621f3](https://github.com/zeroroot-ai/dashboard/commit/b9621f3f3f60e22e3473f543f0cab05e80f1f497))
* **providers:** credentialsMasked multi-field display + delete validateApiKeyFormat ([#303](https://github.com/zeroroot-ai/dashboard/issues/303)) ([1948f14](https://github.com/zeroroot-ai/dashboard/commit/1948f147022d26ae85e41a137e5193302a822eb4)), closes [#284](https://github.com/zeroroot-ai/dashboard/issues/284)
* **providers:** edit credential flow, PATCH without delete-and-recreate ([#300](https://github.com/zeroroot-ai/dashboard/issues/300)) ([de3f3ab](https://github.com/zeroroot-ai/dashboard/commit/de3f3ab810025d4eed255d41fd002f8dd9578877))
* **providers:** FallbackChainEditor drag-to-reorder ([#296](https://github.com/zeroroot-ai/dashboard/issues/296)) ([d1f3316](https://github.com/zeroroot-ai/dashboard/commit/d1f33169798841c900ca294b4c9c23faabda90de))
* **providers:** health badge auto-polling on provider card ([#297](https://github.com/zeroroot-ai/dashboard/issues/297)) ([e244f62](https://github.com/zeroroot-ai/dashboard/commit/e244f624b58c84f451f947ab8789b38838da4a5a))
* **users:** pending invite controls, expiry display, resend, cancel ([#269](https://github.com/zeroroot-ai/dashboard/issues/269)) ([4097999](https://github.com/zeroroot-ai/dashboard/commit/409799915175d380a8440d9689e2f3e12daf4eca)), closes [#265](https://github.com/zeroroot-ai/dashboard/issues/265)
* **users:** rebuild user detail page, remove IdP link, surface all user actions ([#274](https://github.com/zeroroot-ai/dashboard/issues/274)) ([bd78d5e](https://github.com/zeroroot-ai/dashboard/commit/bd78d5e14d88518e35515b90782d196b539d8e6f)), closes [#268](https://github.com/zeroroot-ai/dashboard/issues/268)
* **users:** transferOwnershipAction + UI entry point on user detail page ([#273](https://github.com/zeroroot-ai/dashboard/issues/273)) ([6f866a8](https://github.com/zeroroot-ai/dashboard/commit/6f866a8f9eb2d3846e41d0921cf1be942fd2eba7)), closes [#266](https://github.com/zeroroot-ai/dashboard/issues/266)
* **wizard:** add Bedrock IRSA toggle to provider credential UI ([#298](https://github.com/zeroroot-ai/dashboard/issues/298)) ([5ba4e3c](https://github.com/zeroroot-ai/dashboard/commit/5ba4e3c284873a47bfa3d0abc10bfc15db1ba801))
* **wizard:** decouple step-3 from probe success, test becomes advisory ([#304](https://github.com/zeroroot-ai/dashboard/issues/304)) ([3d0c6e3](https://github.com/zeroroot-ai/dashboard/commit/3d0c6e34a2da80664922c1d697409d38c32dd644)), closes [#288](https://github.com/zeroroot-ai/dashboard/issues/288)
* **wizard:** deprecated model display in catalogue picker ([#305](https://github.com/zeroroot-ai/dashboard/issues/305)) ([5bcc0f7](https://github.com/zeroroot-ai/dashboard/commit/5bcc0f7a9554b7cc5dc229d11ec9cc5b27688331))
* **wizard:** URL-typed credential fields + OpenAI-compatible guidance + SSRF hint ([#299](https://github.com/zeroroot-ai/dashboard/issues/299)) ([4d27655](https://github.com/zeroroot-ai/dashboard/commit/4d2765580ee495a19640248a6779fc7b5961cac5)), closes [#286](https://github.com/zeroroot-ai/dashboard/issues/286)


### Bug Fixes

* **authz:** add owner tier to relation-hierarchy satisfiesRelation ([#276](https://github.com/zeroroot-ai/dashboard/issues/276)) ([263173d](https://github.com/zeroroot-ai/dashboard/commit/263173d01ba1c90bf350e64a7cb2e3601365102a)), closes [#275](https://github.com/zeroroot-ai/dashboard/issues/275)
* **authz:** derive permissions from FGA role when schema is empty ([#277](https://github.com/zeroroot-ai/dashboard/issues/277)) ([8a4326c](https://github.com/zeroroot-ai/dashboard/commit/8a4326cf23999ac42372bb449ec3173dfd754da6))
* **ci:** add actions:read to dashboard.yml permissions, fixes startup_failure ([#279](https://github.com/zeroroot-ai/dashboard/issues/279)) ([ef4f3b5](https://github.com/zeroroot-ai/dashboard/commit/ef4f3b517e8160df7e300c9a9e47a9e2d3c38238))
* **deps:** remove unused swiper dep (critical CVE GHSA-hmx5-qpq5-p643) ([#261](https://github.com/zeroroot-ai/dashboard/issues/261)) ([c83cfdc](https://github.com/zeroroot-ai/dashboard/commit/c83cfdc27b850fab57f7bec7f6cdb8823a536811))
* **invite:** remove viewer from invite role options ([#270](https://github.com/zeroroot-ai/dashboard/issues/270)) ([2310646](https://github.com/zeroroot-ai/dashboard/commit/231064649cb8f4cf1efd8ab86e54e05f264df396)), closes [#264](https://github.com/zeroroot-ai/dashboard/issues/264)
* **missions/drafts:** hard-cutover localStorage + JSDoc from yaml to cueSource ([#312](https://github.com/zeroroot-ai/dashboard/issues/312)) ([d44ce97](https://github.com/zeroroot-ai/dashboard/commit/d44ce97f6bfb62b787fcd0d462117667d62ef8de))
* **missions/editor:** configure MonacoEnvironment.getWorker to unfreeze CUE editor ([#315](https://github.com/zeroroot-ai/dashboard/issues/315)) ([9c24036](https://github.com/zeroroot-ai/dashboard/commit/9c24036a8e9ecdbf8a71a30e901fe18d69d131cd))
* **missions:** move create+templates pages from src/app to app directory ([#313](https://github.com/zeroroot-ai/dashboard/issues/313)) ([7720c88](https://github.com/zeroroot-ai/dashboard/commit/7720c881e61ce5e5145d2997d0690230de6d11e8))
* **providers:** switch GetSupportedProviders route to member-accessible client ([#295](https://github.com/zeroroot-ai/dashboard/issues/295)) ([5a97595](https://github.com/zeroroot-ai/dashboard/commit/5a97595e76aa4e02994a28350f7b939be1c7a496)), closes [#285](https://github.com/zeroroot-ai/dashboard/issues/285)
* **ui:** swap sidebar icons, single person for users, group for teams ([#290](https://github.com/zeroroot-ai/dashboard/issues/290)) ([027a8b2](https://github.com/zeroroot-ai/dashboard/commit/027a8b260a97ad3992054d106794676fab17a5c2))
* **users:** owner removal safeguard, UI gate + server-layer last-owner check ([#272](https://github.com/zeroroot-ai/dashboard/issues/272)) ([43742ca](https://github.com/zeroroot-ai/dashboard/commit/43742ca11bd941528cb8438bceebbe1bdd13ddfc)), closes [#267](https://github.com/zeroroot-ai/dashboard/issues/267)
* **users:** owner role badge and row protection in user list ([#271](https://github.com/zeroroot-ai/dashboard/issues/271)) ([7bbb29d](https://github.com/zeroroot-ai/dashboard/commit/7bbb29d77980d5455b164543b41147d40b906a4f)), closes [#263](https://github.com/zeroroot-ai/dashboard/issues/263)
* **ux:** surface provisioning state instead of opaque 412 ([#306](https://github.com/zeroroot-ai/dashboard/issues/306)) ([f601616](https://github.com/zeroroot-ai/dashboard/commit/f601616eb7bd59c582c95d606d6883b582c0c546)), closes [#260](https://github.com/zeroroot-ai/dashboard/issues/260)

## [0.105.0](https://github.com/zeroroot-ai/dashboard/compare/v0.104.0...v0.105.0) (2026-05-20)


### ⚠ BREAKING CHANGES

* drop MissionConstraints bridge mapping; emit SDK type directly (M2-dashboard) ([#196](https://github.com/zeroroot-ai/dashboard/issues/196))

### Features

* add 2 ts ast walkers for server-action + hook-shape contracts (slice 3.8) ([#236](https://github.com/zeroroot-ai/dashboard/issues/236)) ([7f53505](https://github.com/zeroroot-ai/dashboard/commit/7f5350576cc81527c09414c858ff29cac85b5264))
* add 4 custom eslint rules + strict typescript additions (slice 2.3) ([#234](https://github.com/zeroroot-ai/dashboard/issues/234)) ([51a3ace](https://github.com/zeroroot-ai/dashboard/commit/51a3ace9e956168843440485ab2941faad7cd2f4))
* add mission start route wrapping RunMission/ResumeMission ([#243](https://github.com/zeroroot-ai/dashboard/issues/243)) ([4bb551f](https://github.com/zeroroot-ai/dashboard/commit/4bb551f66cb489d29d7bb18d085e5f3e157a42f6))
* add Traces tab to mission-detail page ([#245](https://github.com/zeroroot-ai/dashboard/issues/245)) ([21c4db4](https://github.com/zeroroot-ai/dashboard/commit/21c4db491b96f0777c3847f84c4a32419cc99e10))
* consume daemonadminservice from platform-sdk ([#249](https://github.com/zeroroot-ai/dashboard/issues/249)) ([7d5419a](https://github.com/zeroroot-ai/dashboard/commit/7d5419a38688f7225c48f94c6ccaf2d1c63d8468))
* **dashboard:** EmptyState sweep across 7 list pages, PRD [#143](https://github.com/zeroroot-ai/dashboard/issues/143) trailing child ([#191](https://github.com/zeroroot-ai/dashboard/issues/191)) ([8e8b540](https://github.com/zeroroot-ai/dashboard/commit/8e8b540eb621c216c816d592199538aa11bca841))
* drop MissionConstraints bridge mapping; emit SDK type directly (M2-dashboard) ([#196](https://github.com/zeroroot-ai/dashboard/issues/196)) ([d9d53ab](https://github.com/zeroroot-ai/dashboard/commit/d9d53ab4353cd998e4d4c580dc57e149b8c95cf8)), closes [#186](https://github.com/zeroroot-ai/dashboard/issues/186)
* mission detail surfaces all author-facing fields (M6) ([#200](https://github.com/zeroroot-ai/dashboard/issues/200)) ([0fb7828](https://github.com/zeroroot-ai/dashboard/commit/0fb78282d5512d87f60840f30368c38a6f214166)), closes [#187](https://github.com/zeroroot-ai/dashboard/issues/187)
* one-click demo mission targeting scanme.nmap.org ([#246](https://github.com/zeroroot-ai/dashboard/issues/246)) ([d89217d](https://github.com/zeroroot-ai/dashboard/commit/d89217d6851fa05645428e45ee2dc08b3fd2fa41))
* subsume brand-guide design system across dashboard ([#248](https://github.com/zeroroot-ai/dashboard/issues/248)) ([487bee3](https://github.com/zeroroot-ai/dashboard/commit/487bee3011ccb0cad4f367e8a67c54f9a894294d))
* wire mission-detail Findings tab to real data ([#244](https://github.com/zeroroot-ai/dashboard/issues/244)) ([947b085](https://github.com/zeroroot-ai/dashboard/commit/947b085c06ec30e7672774e8a31b6c93a7c470e5))


### Bug Fixes

* **auth:** set authjs.callback-url cookie in signup auto-login handoff ([#208](https://github.com/zeroroot-ai/dashboard/issues/208)) ([b0fae0c](https://github.com/zeroroot-ai/dashboard/commit/b0fae0c9c121526835f64dc5f2580951a0ba3adb))
* **ci:** disable anchore/sbom-action release-asset upload ([#185](https://github.com/zeroroot-ai/dashboard/issues/185)) ([0c4f983](https://github.com/zeroroot-ai/dashboard/commit/0c4f983336e521ceeb42270506b8b74edaa3e076))
* dashboard worktree green, gen-plans.mjs worktree-aware + pnpm patchedDependencies ([#195](https://github.com/zeroroot-ai/dashboard/issues/195)) ([5d43e28](https://github.com/zeroroot-ai/dashboard/commit/5d43e28e55297c1cc1f4c79338f3d0955d72736c))
* **eslint:** extend next/typescript so [@typescript-eslint](https://github.com/typescript-eslint) plugin rules load ([#198](https://github.com/zeroroot-ai/dashboard/issues/198)) ([#203](https://github.com/zeroroot-ai/dashboard/issues/203)) ([8d2aa03](https://github.com/zeroroot-ai/dashboard/commit/8d2aa032c71c9c071d12dc3c4ee3e1f988576dad))
* **landing:** replace 'langfuse' vendor name in HeroSection ASCII terminal mock ([#192](https://github.com/zeroroot-ai/dashboard/issues/192)) ([7b80487](https://github.com/zeroroot-ai/dashboard/commit/7b8048782d705808c161167fb34fcb96b43e31cb))
* **lint:** resolve all 58 ESLint errors exposed by [#203](https://github.com/zeroroot-ai/dashboard/issues/203) plugin fix ([#206](https://github.com/zeroroot-ai/dashboard/issues/206)) ([5c94561](https://github.com/zeroroot-ai/dashboard/commit/5c945616eee370c6f2d8fdbada6045c3df3548bb))
* **parser:** empty YAML succeeds with null; serialize trims trailing newline ([#194](https://github.com/zeroroot-ai/dashboard/issues/194)) ([#204](https://github.com/zeroroot-ai/dashboard/issues/204)) ([7a6ebdf](https://github.com/zeroroot-ai/dashboard/commit/7a6ebdf7b13fd8650e744f5d953169e14e564b12))
* post-signup redirect lands on / instead of /dashboard ([#230](https://github.com/zeroroot-ai/dashboard/issues/230)) ([156dad4](https://github.com/zeroroot-ai/dashboard/commit/156dad48d119b7c5a0385b935daf3f43dd99168f))
* **routing:** drop tenant slug from /api/findings + /api/missions URL params ([#210](https://github.com/zeroroot-ai/dashboard/issues/210)) ([62c3417](https://github.com/zeroroot-ai/dashboard/commit/62c3417d8edeaa8fa30548c1df3b0b2b20d4cb9c))
* **routing:** drop tenant slug from client URLs (Phase 1 of [#209](https://github.com/zeroroot-ai/dashboard/issues/209)) ([#211](https://github.com/zeroroot-ai/dashboard/issues/211)) ([9115492](https://github.com/zeroroot-ai/dashboard/commit/9115492859ccc90f9d94db6ef9589fd14a35e9df))
* **scripts:** correct stale path + worktree-aware vendor-mission-authoring-bundle ([#193](https://github.com/zeroroot-ai/dashboard/issues/193)) ([#202](https://github.com/zeroroot-ai/dashboard/issues/202)) ([4055175](https://github.com/zeroroot-ai/dashboard/commit/40551759f6b5bc64a9089aae078fbbd9c18aa57e))
* **scripts:** make 5 prebuild scripts worktree-aware ([#197](https://github.com/zeroroot-ai/dashboard/issues/197)) ([#201](https://github.com/zeroroot-ai/dashboard/issues/201)) ([3f05910](https://github.com/zeroroot-ai/dashboard/commit/3f05910461f7aa2a66398d07b39687681dfc513b))
* signup consent checkboxes invisible against card background ([#231](https://github.com/zeroroot-ai/dashboard/issues/231)) ([dd01d7a](https://github.com/zeroroot-ai/dashboard/commit/dd01d7a1fbfd95936ef17aacdab9993c215d5f3d))

## [0.104.0](https:\/\/github.com\/zeroroot-ai\/dashboard\/compare\/v0.X.Y...v0.104.0) (2026-05-17)

Polyrepo zero-dot-x reset (PRD zeroroot-ai\/.github#25, board #14). The v1.x line was cut prematurely; nothing in the platform is at 1.0 maturity yet. The v1.0.0 tag + release has been deleted; this repo lands at the polyrepo-wide v0.104.0 marker. Going forward, `bump-minor-pre-major: true` ensures `feat!:` commits bump minor not major.
## [1.12.0](https://github.com/zeroroot-ai/dashboard/compare/v1.11.1...v1.12.0) (2026-05-15)


### Features

* **auth:** wire Zitadel V2 session+CreateCallback into signup auto-login ([#42](https://github.com/zeroroot-ai/dashboard/issues/42)) ([48e98bd](https://github.com/zeroroot-ai/dashboard/commit/48e98bd5d447d958e6285707c1937cfa859d7ecc)), closes [#41](https://github.com/zeroroot-ai/dashboard/issues/41)


### Bug Fixes

* **auth:** correct Zitadel V2 OIDC CreateCallback HTTP path ([#43](https://github.com/zeroroot-ai/dashboard/issues/43)) ([6119714](https://github.com/zeroroot-ai/dashboard/commit/61197146b42a5f50cd020f52ea9ac224bd6431d1))
* **landing:** explicit text color on Typewriter so hero text is readable ([#37](https://github.com/zeroroot-ai/dashboard/issues/37)) ([366f383](https://github.com/zeroroot-ai/dashboard/commit/366f3838d56496825772282829278d24e6591b8c))

## [1.11.1](https://github.com/zeroroot-ai/dashboard/compare/v1.11.0...v1.11.1) (2026-05-13)


### Bug Fixes

* **ci:** actually rename dashboard workflow + image (lost in [#34](https://github.com/zeroroot-ai/dashboard/issues/34) rename diff) ([#36](https://github.com/zeroroot-ai/dashboard/issues/36)) ([a8ba906](https://github.com/zeroroot-ai/dashboard/commit/a8ba9065643eae7411e79ebc8956ec3375952a01))
* **ci:** rename dashboard workflow + image to ghcr.io/zeroroot-ai/dashboard ([#34](https://github.com/zeroroot-ai/dashboard/issues/34)) ([e131bdb](https://github.com/zeroroot-ai/dashboard/commit/e131bdbf97d2b1e28f4a930665afa426570c2672))

## [1.11.0](https://github.com/zeroroot-ai/dashboard/compare/v1.10.0...v1.11.0) (2026-05-13)


### Features

* **build:** point Dockerfile FROM at ghcr.io mirror ([#28](https://github.com/zeroroot-ai/dashboard/issues/28)) ([5445955](https://github.com/zeroroot-ai/dashboard/commit/5445955f79ad7efec0ab4a3dcec01e8ace1a319b))
* **build:** pull plans.yaml from tenant-operator at image build ([#22](https://github.com/zeroroot-ai/dashboard/issues/22)) ([99ca903](https://github.com/zeroroot-ai/dashboard/commit/99ca9035b7e33e001596186bf54e78d058cf21b7))


### Bug Fixes

* **api:** drop 'use server' from billing route handlers ([#25](https://github.com/zeroroot-ai/dashboard/issues/25)) ([f4f8dd6](https://github.com/zeroroot-ai/dashboard/commit/f4f8dd6ec0442f41e323a67f832e7803de85dadb))
* **build:** route gen-plans diagnostics to stderr ([c83d707](https://github.com/zeroroot-ai/dashboard/commit/c83d707a9525fac138dd80ff1a2246a5c9e5b667))
* **build:** skip plans-fresh + stripe-tiers gates in Docker ([#24](https://github.com/zeroroot-ai/dashboard/issues/24)) ([29d2c88](https://github.com/zeroroot-ai/dashboard/commit/29d2c887287425eec7744b993d1dcc1ff18a5863))
* **pricing:** route Start-trial CTA to /signup?plan= so signup loads ([#29](https://github.com/zeroroot-ai/dashboard/issues/29)) ([c511aed](https://github.com/zeroroot-ai/dashboard/commit/c511aed7109cb7e7993638cc378bec0fec5e82b2))

## [1.10.0](https://github.com/zeroroot-ai/dashboard/compare/v1.9.0...v1.10.0) (2026-05-11)


### Features

* add org tier and restructure pricing page ([#19](https://github.com/zeroroot-ai/dashboard/issues/19)) ([b30c18d](https://github.com/zeroroot-ai/dashboard/commit/b30c18dddf21e73adc916c0c684a9980030a4046))
* **billing:** live Stripe price overlay on pricing page ([#21](https://github.com/zeroroot-ai/dashboard/issues/21)) ([8504b80](https://github.com/zeroroot-ai/dashboard/commit/8504b807d43f3e697b3a688f348f09ec83b2422f))

## [1.9.0](https://github.com/zeroroot-ai/dashboard/compare/v1.8.0...v1.9.0) (2026-05-10)


### Features

* **billing:** Phase 1 foundations, types, stripe wrapper, idempotency table, guards, metrics ([7629c27](https://github.com/zeroroot-ai/dashboard/commit/7629c279f7226bbed6113309529258e46dec1aea))
* **billing:** Phase 2 email infrastructure, SES provider, 5 billing templates, snapshot tests ([9dc6431](https://github.com/zeroroot-ai/dashboard/commit/9dc643174c9af53737476843b8ea2591b440cf1b))
* **billing:** Phase 3 checkout endpoint, POST /api/billing/checkout with 16 unit tests ([1b32072](https://github.com/zeroroot-ai/dashboard/commit/1b3207211dc7df30822853755fac16c1f9c491cf))
* **billing:** Phase 6 webhook subdomain, 410 tombstone, cutover runbook ([523edc5](https://github.com/zeroroot-ai/dashboard/commit/523edc5a6d7ed435d885e4cf69971c538b37bc6b))
* **billing:** Phase 7 webhook lifecycle handlers, 7 event types, console migration, 38 tests ([84bdd01](https://github.com/zeroroot-ai/dashboard/commit/84bdd01bf7b82f5552ddce921b4491ac23b6f41c))
* **billing:** Phases 14+15, Grafana dashboard, Prometheus alerts, bootstrap script, cleanup guards ([544d95d](https://github.com/zeroroot-ai/dashboard/commit/544d95dee1f43196cb0b04b04653c548568abe5e))
* **billing:** Phases 4+5, CheckoutButton, pricing page CTAs, portal route, billing settings page ([8ccad87](https://github.com/zeroroot-ai/dashboard/commit/8ccad878441fd7eb462550dbb6853d8b6e596ee4))
* **billing:** Phases 9+11, admin tools, boot guard, Stripe test suite ([ea5f933](https://github.com/zeroroot-ai/dashboard/commit/ea5f933fa568c6bae28361aa6586c6920790f3aa))
* dashboard W1+W2 hardening + Pino logger + R7/R9/R17/R18/R11 ([3d0d1f6](https://github.com/zeroroot-ai/dashboard/commit/3d0d1f6c30eec9e8b90a25da606d684a040234be))
* **dashboard:** generate BillingTier + PRICE_ENV_MAP from plans.yaml ([e008898](https://github.com/zeroroot-ai/dashboard/commit/e0088986cd7311eecae508e91172b85c4cb1e06b))
* **dashboard:** in-app quota UX + Phase 7.B sweep of legacy fields ([f0161ef](https://github.com/zeroroot-ai/dashboard/commit/f0161ef30893b253d6c82d95fd4f6d40a7a442c5))
* **dashboard:** mission checkpoint browser + tool-stream SSE bridge ([383125e](https://github.com/zeroroot-ai/dashboard/commit/383125e274e18783fb7e3248d9efdd7a350cc8bf))
* **dashboard:** mission events SSE bridge + per-tool streaming progress on detail page ([5889b28](https://github.com/zeroroot-ai/dashboard/commit/5889b28976f454b3fec57142ee6b8680df01bf90))
* **dashboard:** mission-draft server actions for the create page ([7a852f7](https://github.com/zeroroot-ai/dashboard/commit/7a852f7ef2911c5cbf1e13cc71a4d1d518b1e9ca))
* **dashboard:** mission-draft UI on the create page ([e01099b](https://github.com/zeroroot-ai/dashboard/commit/e01099bdbe29f83ea85272e401ca2ef1646f8db9))
* **dashboard:** regen plans.ts for 3-plan schema + drift gate ([3cde94a](https://github.com/zeroroot-ai/dashboard/commit/3cde94a5a424d294a8ab0d15aeb4f41cdd159c5f))
* **dashboard:** seed in-app quota UX hook + Server Action ([f8266a6](https://github.com/zeroroot-ai/dashboard/commit/f8266a6c67b0fe0e0e99aa02fb8782ff15287421))
* **dashboard:** three-card pricing page driven by plans.yaml ([4b812c3](https://github.com/zeroroot-ai/dashboard/commit/4b812c30c9d37ad3cebbcb0f0c7dda2c5b617b48))
* **dashboard:** v1.8.0, eliminate permissive-dev paths, no localhost defaults, no console.* in hooks, no skipped tests ([7760e05](https://github.com/zeroroot-ai/dashboard/commit/7760e0544d0b74f3eb897cc0b70a9bdbfe064d9e))
* install release-please and pr-title-lint ([#16](https://github.com/zeroroot-ai/dashboard/issues/16)) ([77709e6](https://github.com/zeroroot-ai/dashboard/commit/77709e6c5e05749d8c0aaab1316352eb894a2921))
* **signup:** client-side reserved-names check via daemon GetReservedNames ([f918da4](https://github.com/zeroroot-ai/dashboard/commit/f918da4ade7d806480c7437cd1019e61b0f0788a))


### Bug Fixes

* **billing:** fix 3 TypeScript errors in billing tests and bootstrap script ([0ad4c08](https://github.com/zeroroot-ai/dashboard/commit/0ad4c084c83d6190c355daff5fd1f1bf65f3642f))

## [1.6.0] - 2026-05-04

Completes the dashboard side of the
**`tenant-secrets-broker-completion`** spec. Pairs with gibson v0.29.0
and SDK v0.99.0.

The `/settings/secrets-backend` page now does what its UI has been
claiming since `secrets-tenant-lifecycle` shipped, switching providers
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
treats `-1` as "conservative path, assume there might be secrets"
and renders the warning + checkbox. A muted-text caveat "Could not
load current secret count; assuming there may be existing secrets."
is shown so operators understand why the warning is firing on what
may be a brand-new tenant. Spec: `tenant-secrets-broker-completion`
R3.6 + design D4.

### Tests

- New `src/components/secrets-backend/__tests__/SecretsBackendForm.test.tsx`
 , four RTL tests covering all four R3 acceptance criteria. Required
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
- **`TenantRole` doc comment refreshed** in `src/lib/auth/roles.ts` -
  removed the now-stale claim that the daemon only emits `admin` /
  `member`; documents the full three-tier hierarchy with a spec
  cross-reference. The exported type and `ROLE_RANK` table are
  unchanged (both already encoded the `owner > admin > member`
  hierarchy with ranks 3 / 2 / 1, the previously-unreachable
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
- **`src/gen/authz/registry.ts`** regenerated against the latest SDK -
  agent / tool service RPCs now declare
  `allowedIdentities: COMPONENT` rather than `USER | SERVICE` (the SDK's
  cross-spec correction landed in zero-trust-hardening Req 2.5).

### Notes

- Admin / provisioning routes (`app/api/admin/provisioning/**`) are
  service-acting (Zitadel `client_credentials` Bearer JWT) and are
  intentionally **not** wired for CSRF, browser CSRF cookies do not
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
