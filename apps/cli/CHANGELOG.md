# Changelog

## [0.17.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.16.0-alpha...cli-v0.17.0-alpha) (2026-10-02)


### Features

* **cli:** epics follow the agreed rules — explicit, counted, ordered, closed when resolved ([e8efaa4](https://github.com/JuicyBenjamin/collagen/commit/e8efaa42c91c8d720a8f7b9a31e82695e2070eb9))
* **cli:** epics, a folder of tickets shaped by anyone in the room ([37e1c64](https://github.com/JuicyBenjamin/collagen/commit/37e1c64f0b796cef51bdd648f39d6cd25bd61e08))


### Bug Fixes

* **cli:** an epic's explanation never names a ticket its reader may not see ([9a956eb](https://github.com/JuicyBenjamin/collagen/commit/9a956eb70a4d8d88cef908b4b7ca4fae6f771327))
* **cli:** epic ops have unique ids, gates and readers see the real state and reason ([051ae3d](https://github.com/JuicyBenjamin/collagen/commit/051ae3dcd03fdb82f3cb22133785ca3d9ae911bc))

## [0.16.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.15.0-alpha...cli-v0.16.0-alpha) (2026-10-02)


### Features

* **cli:** the review page reads PHP, coloured, with types on hover and a peek ([f192c12](https://github.com/JuicyBenjamin/collagen/commit/f192c12c6cd8aa81b007273d97093b703f5e492f))


### Bug Fixes

* **cli:** hints ask again while indexing, keep inline-doc declarations, honour vendor-dir ([feec206](https://github.com/JuicyBenjamin/collagen/commit/feec206538485291a49f8662f1c4a24ff74bb175))

## [0.15.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.14.0-alpha...cli-v0.15.0-alpha) (2026-10-02)


### Features

* **cli:** a review's page opens when its reader starts on it, behind a switch ([1274e0a](https://github.com/JuicyBenjamin/collagen/commit/1274e0a04be7385a21982842f930678c49507acf))
* **cli:** a review's summary is its headline, 200 characters at most ([98cc618](https://github.com/JuicyBenjamin/collagen/commit/98cc618cf07b070c378eead9cddd12965aa39c81))
* **cli:** every decision has a short title, and a review leads with its purpose ([c316294](https://github.com/JuicyBenjamin/collagen/commit/c316294df1d81b6127e3d78f94eb907afd5544b1))
* **cli:** o anywhere takes over an open review tab, which hands over its place ([460dee0](https://github.com/JuicyBenjamin/collagen/commit/460dee0e3db19c6a6a54a5256410bdb68bee9d05))
* **cli:** the review page keeps itself current, and o brings an open one forward ([2b23f30](https://github.com/JuicyBenjamin/collagen/commit/2b23f3093c1cddf0968903ec9e5948c92847ae6a))
* **cli:** type hints install their TypeScript on the person's click, not shipped with collagen ([a80dd4a](https://github.com/JuicyBenjamin/collagen/commit/a80dd4ad53ed1daa36fb0de320a901d2e5c7b5f9))
* **cli:** types on hover and a peek at the definition, on the review page ([bb41db7](https://github.com/JuicyBenjamin/collagen/commit/bb41db7f8b915f6230cf9d4bc27c94570f91b014))


### Bug Fixes

* **cli:** hover and peek read cleanly — the word marked, the doc as text, overloads folded ([08d5d60](https://github.com/JuicyBenjamin/collagen/commit/08d5d60d27bd6cd6ad349e224ae59a03ee90cb14))

## [0.14.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.13.1-alpha...cli-v0.14.0-alpha) (2026-10-02)


### Features

* **cli:** a project a peer already shares is located, not added again ([1fd6066](https://github.com/JuicyBenjamin/collagen/commit/1fd6066e8e5f005227eae42c80dcd240b8b79499))
* **cli:** a review read by intent — the diff grouped under its why, in a local page ([a0d5e05](https://github.com/JuicyBenjamin/collagen/commit/a0d5e05ca2fc8dae5c4b62072e920b1298d312a6))
* **cli:** steering — the person's dial for how much their agent does on its own ([18860a5](https://github.com/JuicyBenjamin/collagen/commit/18860a5b3486203594fff59b9c09b658ebfff6ae))
* **cli:** the app tells the person what the ticket kinds are for ([bb90a50](https://github.com/JuicyBenjamin/collagen/commit/bb90a5028f4c04231bf21f1fc4f4108e59816293))
* **cli:** the overview groups tickets by project, then by kind in lifecycle order ([9f1d45c](https://github.com/JuicyBenjamin/collagen/commit/9f1d45c6db7f9847b37cc7627ed6cb7c6165fd50))
* **cli:** the review page is a Solid 2 app coloured by TanStack Highlight; o opens it from the list ([63f68cb](https://github.com/JuicyBenjamin/collagen/commit/63f68cb33426fd13d6a92baec1bae3a2a990e8b7))
* **p2p:** tickets in order — a ticket after another opens to readers once that one is answered ([1d0c4ca](https://github.com/JuicyBenjamin/collagen/commit/1d0c4cacf60065506a0a20ee6f9aa2b87cee7add))


### Bug Fixes

* **cli:** a chain of stacked tickets is a staircase, not a flat list under its first ([802e9cb](https://github.com/JuicyBenjamin/collagen/commit/802e9cbb1d516a2fff7981e544e3b8bdcc6b59d8))
* **cli:** a name is a name however it is cased; a miss says who is here ([67d80c0](https://github.com/JuicyBenjamin/collagen/commit/67d80c047bbb756942f11cd03aebdd3d7e01239a))
* **cli:** the activity log says where a delivery went ([47697c4](https://github.com/JuicyBenjamin/collagen/commit/47697c495176ce7b5e446db2c59acf59bc4d0755))
* **cli:** the MCP server listens on loopback only ([d34ae4c](https://github.com/JuicyBenjamin/collagen/commit/d34ae4c864228a82fa2bd51bef6e24a90aa3744b))
* **cli:** the rail's dot means you must act ([e4449f7](https://github.com/JuicyBenjamin/collagen/commit/e4449f7f27cebc1015511d3831fa04f1931d2562))
* **cli:** the review page's server imports effect/http ([c751dbc](https://github.com/JuicyBenjamin/collagen/commit/c751dbc4d9388a22fdb6e65c92ebc1b328c5e1e3))

## [0.13.1-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.13.0-alpha...cli-v0.13.1-alpha) (2026-09-17)


### Bug Fixes

* **cli:** pin callscript exact; CI installs the tarball like a user ([75bc629](https://github.com/JuicyBenjamin/collagen/commit/75bc6290448ef8c72a41bd6212505bdc508ae671))

## [0.13.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.12.0-alpha...cli-v0.13.0-alpha) (2026-09-16)


### Features

* **p2p:** the bug kind, and a log that leaves a newer build's records alone ([594f0a9](https://github.com/JuicyBenjamin/collagen/commit/594f0a9971657bdea1498249f97eb08830ad2bc1))


### Bug Fixes

* **cli:** a bug report's fields can be withdrawn; search what the reader sees; count unknown rows ([d724603](https://github.com/JuicyBenjamin/collagen/commit/d72460309095e0af59f97740849ab818ffc5b299))
* **p2p:** keep a newer build's records raw and replay them after the update; show them as unknown ([5f91ec5](https://github.com/JuicyBenjamin/collagen/commit/5f91ec5494f12abe6f5c9b0e8dab1ea6fb794647))
* **p2p:** keep every newer entry in order and replay them all; the bug report answers 'about' ([65fdb5a](https://github.com/JuicyBenjamin/collagen/commit/65fdb5aa34b2e34b3c9ffd4e0411b891080be64c))

## [0.12.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.11.0-alpha...cli-v0.12.0-alpha) (2026-09-16)


### Features

* **cli:** a proposal is an idea owed to no one; a plan is how it gets done ([3633def](https://github.com/JuicyBenjamin/collagen/commit/3633def9d37e7d1f1c13366770d843f987c9e22f))


### Bug Fixes

* **cli:** a proposal's work is an outline and never a step ([59d6601](https://github.com/JuicyBenjamin/collagen/commit/59d6601f20e97d4655840869e7a41704be571de3))
* **cli:** review-context searches a proposal's outline; two stale sentences ([d0eaf86](https://github.com/JuicyBenjamin/collagen/commit/d0eaf861640b75cabbef335a275c43b2494c313c))

## [0.11.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.10.1-alpha...cli-v0.11.0-alpha) (2026-09-15)


### Features

* **cli:** a run from source is on devnet, a release on mainnet ([b450790](https://github.com/JuicyBenjamin/collagen/commit/b45079007509062c03b8c4a24a466117a935fd79))


### Bug Fixes

* **cli:** disjoint port ranges per net, one invite on both clipboards, net-aware tool paths ([bddff27](https://github.com/JuicyBenjamin/collagen/commit/bddff27221cdd513941d0c7b01ea61ed434f56a8))

## [0.10.1-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.10.0-alpha...cli-v0.10.1-alpha) (2026-09-15)


### Bug Fixes

* **cli:** pin every [@effect](https://github.com/effect) package exact and move to rc.115 ([1fe6dce](https://github.com/JuicyBenjamin/collagen/commit/1fe6dce963f81e397b400444fe0e1499054fd371))

## [0.10.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.9.1-alpha...cli-v0.10.0-alpha) (2026-09-14)


### ⚠ BREAKING CHANGES

* **p2p:** plans and proposals — judgment before the code exists

### Features

* **p2p:** plans and proposals — judgment before the code exists ([e59d508](https://github.com/JuicyBenjamin/collagen/commit/e59d5087f11a5b418f1d1f2b0f39b45194277d65))

## [0.9.1-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.9.0-alpha...cli-v0.9.1-alpha) (2026-09-14)


### Bug Fixes

* **cli:** closing is the author's decision, recorded — and marks say what was said, not who ([e14518f](https://github.com/JuicyBenjamin/collagen/commit/e14518ff713f1e0b532e24435727d96854ae3aa9))

## [0.9.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.8.0-alpha...cli-v0.9.0-alpha) (2026-09-10)


### ⚠ BREAKING CHANGES

* **p2p:** review tickets carry the why, and one protocol version at a time

### Features

* **p2p:** review tickets carry the why, and one protocol version at a time ([6ccea5b](https://github.com/JuicyBenjamin/collagen/commit/6ccea5bf6a88957b96031088dfa520f73e56333e))

## [0.8.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.7.0-alpha...cli-v0.8.0-alpha) (2026-09-09)


### Features

* **cli:** the opening — the logo boots centred, then glides into the header ([3ffe095](https://github.com/JuicyBenjamin/collagen/commit/3ffe095aac03a2d015b541f3045004beae53ff1c))

## [0.7.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.6.0-alpha...cli-v0.7.0-alpha) (2026-09-09)


### Features

* **cli:** attachments — files on a ticket by reference, fetched from the holder ([781bfe1](https://github.com/JuicyBenjamin/collagen/commit/781bfe1a90110de6e33de56264b7a148bfd851e6))

## [0.6.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.5.0-alpha...cli-v0.6.0-alpha) (2026-09-09)


### Features

* **cli:** the ticket page reshaped; transcripts as list and reader; ← is back on pages ([60e6a58](https://github.com/JuicyBenjamin/collagen/commit/60e6a58dd650d4a64a421f15d67aaf656d8b8793))
* **cli:** tickets by what they want from you; people; participants hear updates ([c26b154](https://github.com/JuicyBenjamin/collagen/commit/c26b15421c4ad3c5d6fd128952ee222aaa93da16))

## [0.5.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.4.0-alpha...cli-v0.5.0-alpha) (2026-09-09)


### Features

* **cli:** transcripts on request, a ticket page, and a diagnostics registry ([8d79916](https://github.com/JuicyBenjamin/collagen/commit/8d799160da3516d4fe788db511aeed92737c3541))


### Bug Fixes

* **cli:** a mock machine never runs a real CLI, whatever a thread was adopted into ([c7088f2](https://github.com/JuicyBenjamin/collagen/commit/c7088f21c2f5dccac4821d87d1cc375787bba9c4))

## [0.4.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.3.0-alpha...cli-v0.4.0-alpha) (2026-09-08)


### Features

* **cli:** the receiving agent relays a headline, reads on request, never invents ([3abe56a](https://github.com/JuicyBenjamin/collagen/commit/3abe56a07bad86f66187a55330cb38442f373f33))

## [0.3.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.2.0-alpha...cli-v0.3.0-alpha) (2026-09-08)


### Features

* **cli:** human in the loop — the outbox gate and relay-only prompts ([9c708ed](https://github.com/JuicyBenjamin/collagen/commit/9c708edca09f9a1d88a36516fd2aed6aa34141c8))
* **p2p:** outgoing and proposal schemas, an outbox in LocalState ([d8bdd0d](https://github.com/JuicyBenjamin/collagen/commit/d8bdd0d47185a76352966240838fb51921f07a82))

## [0.2.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.1.1-alpha...cli-v0.2.0-alpha) (2026-09-08)


### Features

* **cli:** in-app updater — notice, `u` installs, the shim relaunches ([3507336](https://github.com/JuicyBenjamin/collagen/commit/35073368502c491ac264726f315397ce6d6e4ecd))


### Bug Fixes

* **cli:** quitting actually exits the process ([2c4940b](https://github.com/JuicyBenjamin/collagen/commit/2c4940b47f3a7e6e4238df840cdd2ea1d2d59e82))

## [0.1.1-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.1.0-alpha...cli-v0.1.1-alpha) (2026-09-08)


### Bug Fixes

* **cli:** one bin — collagen --headless — so npx @collagen/cli can run it ([d821353](https://github.com/JuicyBenjamin/collagen/commit/d8213531070d156e732b7af935d20a23a2e32361))
