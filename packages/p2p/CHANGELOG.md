# Changelog

## [0.19.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.18.0-alpha...p2p-v0.19.0-alpha) (2026-10-03)


### Features

* **cli:** a decision names the skill or agent file that guided it ([4cb6e7a](https://github.com/JuicyBenjamin/collagen/commit/4cb6e7a9f5348c24fe515d269b22a6bbb8ac2306))
* **cli:** review units read by purpose, each change under a why ([a7c5a04](https://github.com/JuicyBenjamin/collagen/commit/a7c5a0491de06a330668e5b57225d97790f3cf8d))
* **cli:** the review page reads a change in units, each change once ([b48301b](https://github.com/JuicyBenjamin/collagen/commit/b48301ba1d30e4015a633e49f07951213988f524))


### Bug Fixes

* **cli:** the outbox names an epic by its title too ([3135696](https://github.com/JuicyBenjamin/collagen/commit/3135696e0df06cb5db8a799a5211775016e44127))
* **p2p:** a build that evicted our own why puts it back from our history ([bf0cf8c](https://github.com/JuicyBenjamin/collagen/commit/bf0cf8cc47aaa382684ad1f1d80beb2f8b55889b))

## [0.18.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.17.0-alpha...p2p-v0.18.0-alpha) (2026-10-02)


### Features

* **cli:** every ticket has a short title, and its goal is the line beneath ([7dacb6f](https://github.com/JuicyBenjamin/collagen/commit/7dacb6f9b3b8d6dd6e92ae9184ac9ff59c43a166))


### Bug Fixes

* **cli:** 'filed together' goes by when tickets were filed, not last revised ([9186683](https://github.com/JuicyBenjamin/collagen/commit/9186683bf08312b4f6344556a507f94b4ea39086))
* **cli:** titles merge the same however copies are grouped, and stay on one line ([8c5758b](https://github.com/JuicyBenjamin/collagen/commit/8c5758b43e887fa91c103ba4d849c5ad8ab6cef3))

## [0.17.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.16.0-alpha...p2p-v0.17.0-alpha) (2026-10-02)


### Features

* **cli:** epics follow the agreed rules — explicit, counted, ordered, closed when resolved ([e8efaa4](https://github.com/JuicyBenjamin/collagen/commit/e8efaa42c91c8d720a8f7b9a31e82695e2070eb9))
* **cli:** epics, a folder of tickets shaped by anyone in the room ([37e1c64](https://github.com/JuicyBenjamin/collagen/commit/37e1c64f0b796cef51bdd648f39d6cd25bd61e08))


### Bug Fixes

* **cli:** an epic's explanation never names a ticket its reader may not see ([9a956eb](https://github.com/JuicyBenjamin/collagen/commit/9a956eb70a4d8d88cef908b4b7ca4fae6f771327))
* **cli:** epic ops have unique ids, gates and readers see the real state and reason ([051ae3d](https://github.com/JuicyBenjamin/collagen/commit/051ae3dcd03fdb82f3cb22133785ca3d9ae911bc))

## [0.16.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.15.0-alpha...p2p-v0.16.0-alpha) (2026-10-02)


### Chores

* **p2p:** Synchronize collagen versions

## [0.15.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.14.0-alpha...p2p-v0.15.0-alpha) (2026-10-02)


### Features

* **cli:** a review's page opens when its reader starts on it, behind a switch ([1274e0a](https://github.com/JuicyBenjamin/collagen/commit/1274e0a04be7385a21982842f930678c49507acf))
* **cli:** every decision has a short title, and a review leads with its purpose ([c316294](https://github.com/JuicyBenjamin/collagen/commit/c316294df1d81b6127e3d78f94eb907afd5544b1))

## [0.14.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.13.1-alpha...p2p-v0.14.0-alpha) (2026-10-02)


### Features

* **cli:** steering — the person's dial for how much their agent does on its own ([18860a5](https://github.com/JuicyBenjamin/collagen/commit/18860a5b3486203594fff59b9c09b658ebfff6ae))
* **cli:** the app tells the person what the ticket kinds are for ([bb90a50](https://github.com/JuicyBenjamin/collagen/commit/bb90a5028f4c04231bf21f1fc4f4108e59816293))
* **p2p:** tickets in order — a ticket after another opens to readers once that one is answered ([1d0c4ca](https://github.com/JuicyBenjamin/collagen/commit/1d0c4cacf60065506a0a20ee6f9aa2b87cee7add))

## [0.13.1-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.13.0-alpha...p2p-v0.13.1-alpha) (2026-09-17)


### Chores

* **p2p:** Synchronize collagen versions

## [0.13.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.12.0-alpha...p2p-v0.13.0-alpha) (2026-09-16)


### Features

* **p2p:** the bug kind, and a log that leaves a newer build's records alone ([594f0a9](https://github.com/JuicyBenjamin/collagen/commit/594f0a9971657bdea1498249f97eb08830ad2bc1))


### Bug Fixes

* **cli:** a bug report's fields can be withdrawn; search what the reader sees; count unknown rows ([d724603](https://github.com/JuicyBenjamin/collagen/commit/d72460309095e0af59f97740849ab818ffc5b299))
* **p2p:** a kept row is keyed by its entry's content, so a replay retires only its own ([4adbcc5](https://github.com/JuicyBenjamin/collagen/commit/4adbcc5b67d16b56699deb4ca17aa17c8775c6fa))
* **p2p:** a replay can retire only its own row — the marker is recomputed, never trusted ([448880a](https://github.com/JuicyBenjamin/collagen/commit/448880a165f8cd875b15e1c6f2a706255da6c389))
* **p2p:** a replay retires exactly the raw row it came from, after it applied ([738a7c6](https://github.com/JuicyBenjamin/collagen/commit/738a7c6e9580a40f56e4865a117d98133b9b343d))
* **p2p:** keep a newer build's records raw and replay them after the update; show them as unknown ([5f91ec5](https://github.com/JuicyBenjamin/collagen/commit/5f91ec5494f12abe6f5c9b0e8dab1ea6fb794647))
* **p2p:** keep every newer entry in order and replay them all; the bug report answers 'about' ([65fdb5a](https://github.com/JuicyBenjamin/collagen/commit/65fdb5aa34b2e34b3c9ffd4e0411b891080be64c))
* **p2p:** the same body under two protocols is two kept rows ([d633d4f](https://github.com/JuicyBenjamin/collagen/commit/d633d4fc2a8e29cfca60e8fa4e66b6d80978b1e6))

## [0.12.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.11.0-alpha...p2p-v0.12.0-alpha) (2026-09-16)


### Features

* **cli:** a proposal is an idea owed to no one; a plan is how it gets done ([3633def](https://github.com/JuicyBenjamin/collagen/commit/3633def9d37e7d1f1c13366770d843f987c9e22f))


### Bug Fixes

* **cli:** review-context searches a proposal's outline; two stale sentences ([d0eaf86](https://github.com/JuicyBenjamin/collagen/commit/d0eaf861640b75cabbef335a275c43b2494c313c))

## [0.11.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.10.1-alpha...p2p-v0.11.0-alpha) (2026-09-15)


### Features

* **cli:** a run from source is on devnet, a release on mainnet ([b450790](https://github.com/JuicyBenjamin/collagen/commit/b45079007509062c03b8c4a24a466117a935fd79))

## [0.10.1-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.10.0-alpha...p2p-v0.10.1-alpha) (2026-09-15)


### Bug Fixes

* **cli:** pin every [@effect](https://github.com/effect) package exact and move to rc.115 ([1fe6dce](https://github.com/JuicyBenjamin/collagen/commit/1fe6dce963f81e397b400444fe0e1499054fd371))

## [0.10.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.9.1-alpha...p2p-v0.10.0-alpha) (2026-09-14)


### ⚠ BREAKING CHANGES

* **p2p:** plans and proposals — judgment before the code exists

### Features

* **p2p:** plans and proposals — judgment before the code exists ([e59d508](https://github.com/JuicyBenjamin/collagen/commit/e59d5087f11a5b418f1d1f2b0f39b45194277d65))

## [0.9.1-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.9.0-alpha...p2p-v0.9.1-alpha) (2026-09-14)


### Bug Fixes

* **cli:** closing is the author's decision, recorded — and marks say what was said, not who ([e14518f](https://github.com/JuicyBenjamin/collagen/commit/e14518ff713f1e0b532e24435727d96854ae3aa9))

## [0.9.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.8.0-alpha...p2p-v0.9.0-alpha) (2026-09-10)


### ⚠ BREAKING CHANGES

* **p2p:** review tickets carry the why, and one protocol version at a time

### Features

* **p2p:** review tickets carry the why, and one protocol version at a time ([6ccea5b](https://github.com/JuicyBenjamin/collagen/commit/6ccea5bf6a88957b96031088dfa520f73e56333e))

## [0.8.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.7.0-alpha...p2p-v0.8.0-alpha) (2026-09-09)


### Bug Fixes

* **p2p:** announce the log to a peer whose profile arrives after it opened ([41ff1ec](https://github.com/JuicyBenjamin/collagen/commit/41ff1ec2f0cbbfd7529b913643645f20a769a48a))

## [0.7.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.6.0-alpha...p2p-v0.7.0-alpha) (2026-09-09)


### Features

* **cli:** attachments — files on a ticket by reference, fetched from the holder ([781bfe1](https://github.com/JuicyBenjamin/collagen/commit/781bfe1a90110de6e33de56264b7a148bfd851e6))

## [0.6.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.5.0-alpha...p2p-v0.6.0-alpha) (2026-09-09)


### Features

* **p2p:** a message may weigh in on a ticket ([e324583](https://github.com/JuicyBenjamin/collagen/commit/e32458354a311cd39206fdf46ed83bfcabe9f0fc))

## [0.5.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.4.0-alpha...p2p-v0.5.0-alpha) (2026-09-09)


### Features

* **p2p:** transcript frames, adoption time, a transcript outgoing ([c51373f](https://github.com/JuicyBenjamin/collagen/commit/c51373f496d47a576c4984d22e4e88f1402f8a17))

## [0.4.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.3.0-alpha...p2p-v0.4.0-alpha) (2026-09-08)


### Chores

* **p2p:** Synchronize collagen versions

## [0.3.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.2.0-alpha...p2p-v0.3.0-alpha) (2026-09-08)


### Features

* **p2p:** outgoing and proposal schemas, an outbox in LocalState ([d8bdd0d](https://github.com/JuicyBenjamin/collagen/commit/d8bdd0d47185a76352966240838fb51921f07a82))

## [0.2.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.1.1-alpha...p2p-v0.2.0-alpha) (2026-09-08)


### Chores

* **p2p:** Synchronize collagen versions

## [0.1.1-alpha](https://github.com/JuicyBenjamin/collagen/compare/p2p-v0.1.0-alpha...p2p-v0.1.1-alpha) (2026-09-08)


### Bug Fixes

* **p2p:** tagged LogAppendFailed instead of a bare Error on log appends ([60d9479](https://github.com/JuicyBenjamin/collagen/commit/60d9479e95102f9e624cbbc75c4305a60cd2dc27))
