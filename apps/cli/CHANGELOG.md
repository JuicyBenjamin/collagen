# Changelog

## [0.22.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.21.0-alpha...cli-v0.22.0-alpha) (2026-10-20)


### ⚠ BREAKING CHANGES

* **p2p:** a review, a settle, a filing and a message say which agent made it, model and effort too

### Features

* **cli:** a host says what was merged into a branch, and whether merged, squashed or rebased ([4b19bdc](https://github.com/JuicyBenjamin/collagen/commit/4b19bdc0397271066f3b927eee6b53613c6ca919))
* **cli:** a merge names its epics, and a why opens and closes animated, as everything will ([60ce5da](https://github.com/JuicyBenjamin/collagen/commit/60ce5dada02c63350a3e1c9a016d295affe3e4bf))
* **cli:** a merges tab lists merges newest first, with the tickets each came from ([4c1405c](https://github.com/JuicyBenjamin/collagen/commit/4c1405cfb8e66751d0a6299bab9eac7d1d9fd6bb))
* **cli:** a review can show how its change works, a machine played in a tab of its own ([fea3742](https://github.com/JuicyBenjamin/collagen/commit/fea3742a50b476b69d90e026f87a9f1e9005ae8f))
* **cli:** a review is finished from three round buttons beside the files viewed, not one Review ([2554cb5](https://github.com/JuicyBenjamin/collagen/commit/2554cb597441a000d604c8fbd8476576c6655998))
* **cli:** a review is finished on its page: your verdict as your take, or yours accepted or dropped ([1c4749e](https://github.com/JuicyBenjamin/collagen/commit/1c4749e75fe18bbc54227034bddb7e3d293c2797))
* **cli:** a review shows where its change runs: the pages to open, beside the diff ([b56bf71](https://github.com/JuicyBenjamin/collagen/commit/b56bf71475bf62e059829f77431f0eba1ccf23ab))
* **cli:** a ticket's relatives sit under it, nested when both are in view, dim when not ([2af06aa](https://github.com/JuicyBenjamin/collagen/commit/2af06aa68954657598ee9c37f65edd5c1cd0570b))
* **cli:** an agent can ask why code is as it is, from its last merge to its tickets' decisions ([28b0118](https://github.com/JuicyBenjamin/collagen/commit/28b011829997051b941505838462436892896cb0))
* **cli:** an agent can say what collagen costs it in tokens, read from its own session logs ([7f1f2ce](https://github.com/JuicyBenjamin/collagen/commit/7f1f2cefbaf4d4f81c1e70f4403e539b9940ea49))
* **cli:** collagen merges your reviewed pull request once approved as you say, and work goes on ([a77ec60](https://github.com/JuicyBenjamin/collagen/commit/a77ec60c2ace0cceb8897a206ff237c083527635))
* **cli:** each merge names the review tickets it came from, or none ([9259448](https://github.com/JuicyBenjamin/collagen/commit/9259448224a5ee0a5b7a6d8cf1d0dfa060ec046a))
* **cli:** each merge shows the whole chain it grew from, proposal to plan to task to review ([4b56229](https://github.com/JuicyBenjamin/collagen/commit/4b56229669c5d0c6ae5ecabdbb19648aa759e096))
* **cli:** each review comment says how strongly it asks, from a nit to a must ([5b62386](https://github.com/JuicyBenjamin/collagen/commit/5b62386c518806f8c22539a14590255fc9c2cccc))
* **cli:** merge history loads as you scroll, and o opens it at a merge with its why ([2cd9d33](https://github.com/JuicyBenjamin/collagen/commit/2cd9d336a774d1fb73a5ddc731e5077c76fbef89))
* **cli:** projects get their own tab; the overview shows how many each person shares ([57b98d7](https://github.com/JuicyBenjamin/collagen/commit/57b98d71092d89298d5f9fde69c66ae7ea80b514))
* **cli:** repeated uses of one change are one review item, marked viewed together ([c1bb496](https://github.com/JuicyBenjamin/collagen/commit/c1bb4962ff87cd68d87205dd2d24cafba84cf1ef))
* **cli:** tests are reviewed in a tab of their own, each judged by its title ([3ad45b3](https://github.com/JuicyBenjamin/collagen/commit/3ad45b370013efe3839c38829cfed5005748abe8))
* **cli:** the merge history is a web page too, linked to pull requests and reviews ([1818013](https://github.com/JuicyBenjamin/collagen/commit/1818013682db44bfd1bda6bcb1821c566573e0d0))
* **cli:** the overview shows who is here in two fixed lines; enter opens a people page ([17c8bc4](https://github.com/JuicyBenjamin/collagen/commit/17c8bc4fb96e4adbf6b875daea7e48eb0545125f))
* **cli:** the review page is themed with daisyUI, a theme picked or made by the reader ([e884e8a](https://github.com/JuicyBenjamin/collagen/commit/e884e8a739908141a5542576ff7f05f5b88688b9))
* **cli:** the review page shows its shape while it loads and fills in as the diff is read ([0c6984e](https://github.com/JuicyBenjamin/collagen/commit/0c6984e7d21f0ad7ae1f8895c7f7e9260c1fd81d))
* **p2p:** a review, a settle, a filing and a message say which agent made it, model and effort too ([795abb4](https://github.com/JuicyBenjamin/collagen/commit/795abb4fed936fe15a58f4fdbc4bc0b59845ae13))
* **p2p:** a ticket grown out of a part of an epic joins it, and progress counts pieces of work ([55fc9a1](https://github.com/JuicyBenjamin/collagen/commit/55fc9a15c3caf5cef4e73195035b85430e9e3f68))


### Bug Fixes

* **cli:** a bug's title names the problem, and the why or the fix goes in the goal ([5db3e43](https://github.com/JuicyBenjamin/collagen/commit/5db3e43bea91e272c49d5172664e940e86f1edbb))
* **cli:** a closed ticket shows how it ended as ✓ done or ⊗ dropped, not in words ([7b60066](https://github.com/JuicyBenjamin/collagen/commit/7b6006663de9bb0a606c6a8a492edde1d93e19ef))
* **cli:** a merged pull request can still be reviewed, and code never shows as an empty block ([1e7592e](https://github.com/JuicyBenjamin/collagen/commit/1e7592e87af011c9c225927d46f03caa6b07045f))
* **cli:** a rebased branch's review shows its own changes, not the work it was rebased over ([2122da0](https://github.com/JuicyBenjamin/collagen/commit/2122da03290832847f2a15931a120e83dccd1c4e))
* **cli:** a review page's live updates ride one WebSocket, so pages and reads never wait ([c31923b](https://github.com/JuicyBenjamin/collagen/commit/c31923b661792214c7e4bef51859147f1b3669cf))
* **cli:** a review's decision must point at the code it shaped, or the code it kept ([f34331e](https://github.com/JuicyBenjamin/collagen/commit/f34331e2365be69fd6021ae70816a19ae0f2fa96))
* **cli:** a ticket with changes asked is drawn as changes asked, never as done ([143ee05](https://github.com/JuicyBenjamin/collagen/commit/143ee0580a20030b24925642b12b6bd796a1f081))
* **cli:** every kind's tab is named, an empty one too ([fea0c80](https://github.com/JuicyBenjamin/collagen/commit/fea0c805b6e7fb40ec1eba86ca1f8d429e9cb892))
* **cli:** finishing a review shows it is on its way, sends once, and needs no words beside comments ([2bbb0ab](https://github.com/JuicyBenjamin/collagen/commit/2bbb0ab6129fcd584df2041364f03ccc27be112c))
* **cli:** get-tickets lists the open tickets a row each; get-ticket shows one in full ([903375b](https://github.com/JuicyBenjamin/collagen/commit/903375b5d44afde95cdabb0d3857b2401e0e4d50))
* **cli:** kinds follow the work: epics, proposals, bugs, plans, tasks, reviews ([f8b3524](https://github.com/JuicyBenjamin/collagen/commit/f8b3524dfd66bf1a6d02464401d5f9b28a2aa88c))
* **cli:** php type hints start reading the project when the review opens, and keep what they read ([63d5be0](https://github.com/JuicyBenjamin/collagen/commit/63d5be0df248ca74812aec1cda65a6e79c42c5c0))
* **cli:** room tabs run overview, projects, merges, messages, outbox ([cfc4816](https://github.com/JuicyBenjamin/collagen/commit/cfc48162f1532e33c411fb08bdbc75bc6e9d55ab))
* **cli:** the people above the ticket list keep a line each, however long the list ([9ee15ab](https://github.com/JuicyBenjamin/collagen/commit/9ee15ab2d41f77e0b42d6da720b90b7f3f4ea581))
* **cli:** the ticket kind a user names is the kind that gets filed, and a plan can be decided work ([1a2f099](https://github.com/JuicyBenjamin/collagen/commit/1a2f099facf6fd5600780d89aca97235436656d4))
* **cli:** the ticket list starts below its tabs; status and epic get columns of their own ([c3c478d](https://github.com/JuicyBenjamin/collagen/commit/c3c478da7363f0f9994b546b3a1fdeb3609f0fd1))
* **e2e:** the review scripts give each decision a place, as decisions now need ([ac9309c](https://github.com/JuicyBenjamin/collagen/commit/ac9309ca374cd9012df0a22602194a014593bb7d))

## [0.21.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.20.0-alpha...cli-v0.21.0-alpha) (2026-10-05)


### ⚠ BREAKING CHANGES

* **p2p:** a ticket closed as done counts toward its epic

### Features

* **cli:** a guess can be withdrawn, so an assumed review is amended, never refiled ([c727b61](https://github.com/JuicyBenjamin/collagen/commit/c727b61840173be2a7fdfc37f32aaf3405f070fe))
* **cli:** review someone else's pull request from your AI's assumptions ([8c0bf5c](https://github.com/JuicyBenjamin/collagen/commit/8c0bf5c44581901606a0947f71101c2c7996279a))
* **cli:** the code's author takes an assumed review over and answers each guess ([2308564](https://github.com/JuicyBenjamin/collagen/commit/23085645df11179235296566516feab8baba86cb))
* **cli:** the code's author's agent is told of guesses about their code, and answers them itself ([8f9063d](https://github.com/JuicyBenjamin/collagen/commit/8f9063d56899065ba0371fd5454b9074a092f1f9))
* **cli:** the ticket list has a tab per kind, and lists closed tickets on request ([5ad545d](https://github.com/JuicyBenjamin/collagen/commit/5ad545db42f89ee65d3cd760d999f6e7273c6cb6))


### Bug Fixes

* **cli:** ← goes back from every ticket, and from a ticket in an epic back to the epic ([dbd73ed](https://github.com/JuicyBenjamin/collagen/commit/dbd73ed56eb4348872c6dfd17f862879d55be12b))
* **cli:** a row's relations, and the ticket page, show only what the reader may see ([3f0a02f](https://github.com/JuicyBenjamin/collagen/commit/3f0a02f975f4b61498839103bf653c5debd34b5c))
* **cli:** an assumed review says so in one line, and claims nothing about its author ([90b442c](https://github.com/JuicyBenjamin/collagen/commit/90b442c904ed245d52e8c698182375c72451f408))
* **cli:** assumptions guess the problem behind a change and why it was solved this way ([e932736](https://github.com/JuicyBenjamin/collagen/commit/e932736e543b12afa35cfd7fe3fdbc7a5b37968c))
* **cli:** nobody takes over a review when who wrote the code is unknown; reviewers judge, CI tests ([8448165](https://github.com/JuicyBenjamin/collagen/commit/84481650472354bc3b4d1f95df7289ab6a16767a))
* **cli:** the open ticket tab stays whole in a narrow pane ([6976586](https://github.com/JuicyBenjamin/collagen/commit/69765867d3abfb73b33b3ba4947cf6ec0e23555d))
* **cli:** the ticket tabs are hovered and switched with the arrows ([0f78b2e](https://github.com/JuicyBenjamin/collagen/commit/0f78b2ebe27ce68059244430eff0c4522215402d))
* **p2p:** a ticket closed as done counts toward its epic ([6f7bf57](https://github.com/JuicyBenjamin/collagen/commit/6f7bf5754f07252555439dbbf63ec1fcfe9cc5e6))

## [0.20.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.19.0-alpha...cli-v0.20.0-alpha) (2026-10-04)


### ⚠ BREAKING CHANGES

* **cli:** protocol 9 — the room's log gains comment records. A peer on protocol 8 keeps entries written by 9 aside until it updates.

### Features

* **cli:** a review is written, then finished, as on GitHub ([9103225](https://github.com/JuicyBenjamin/collagen/commit/91032254173075bc29e48143d036243ab08968b0))
* **cli:** comment on lines as on GitHub: a + on hover, blocks, suggestions ([953f434](https://github.com/JuicyBenjamin/collagen/commit/953f434a04b73e392dcf43530c4be823d8ff13bd))
* **cli:** comments on your own pull request stay in collagen ([d4d5557](https://github.com/JuicyBenjamin/collagen/commit/d4d5557987dca5e9608ac24e77a4adab078bfee3))
* **cli:** the review page acts on the pull request through gh ([7cb1978](https://github.com/JuicyBenjamin/collagen/commit/7cb197806008670f9d2fc3c05443eadff6ba6410))
* **cli:** the review page shows what was said on GitHub — reviews, conversation, replies ([ec2ab3c](https://github.com/JuicyBenjamin/collagen/commit/ec2ab3c2fe5d101916c8bd1c8aa8d06ffcffb9d6))
* **cli:** your AI drafts review comments beside the code, you accept them ([1121aa2](https://github.com/JuicyBenjamin/collagen/commit/1121aa20f4112339e00e3ec1cc5938a87bcb299d))


### Bug Fixes

* **cli:** a finish is said once, holds the review while it goes, and nothing gets stuck ([54d17af](https://github.com/JuicyBenjamin/collagen/commit/54d17afca8becd78bb6e2f0b40a2a9b9afc5c6c1))
* **cli:** a finished review is said once, under who is signed in now, at one commit ([804ba2b](https://github.com/JuicyBenjamin/collagen/commit/804ba2baa2c7abff1935a27644144919493fa56b))
* **cli:** a new finish after a half-done one is a review of its own ([910833d](https://github.com/JuicyBenjamin/collagen/commit/910833dd70f9aac5b883d0c04042cf76be68cb1a))
* **cli:** a new finish keeps its words when an earlier one still cannot reach the room ([0d95887](https://github.com/JuicyBenjamin/collagen/commit/0d958877f074277b1fbfc43d7f741442f89dafed))

## [0.19.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.18.0-alpha...cli-v0.19.0-alpha) (2026-10-03)


### Features

* **cli:** a decision names the skill or agent file that guided it ([4cb6e7a](https://github.com/JuicyBenjamin/collagen/commit/4cb6e7a9f5348c24fe515d269b22a6bbb8ac2306))
* **cli:** a file that changed since it was viewed shows only what moved ([7090d36](https://github.com/JuicyBenjamin/collagen/commit/7090d36df86cab9f71bf1542e3e7f7aff344e5e2))
* **cli:** read a hunk's whole file on the review page ([34b0ff3](https://github.com/JuicyBenjamin/collagen/commit/34b0ff3f3e32e29fddd694ee588e62a5f9a1a3ae))
* **cli:** review units read by purpose, each change under a why ([a7c5a04](https://github.com/JuicyBenjamin/collagen/commit/a7c5a0491de06a330668e5b57225d97790f3cf8d))
* **cli:** the review page reads a change in units, each change once ([b48301b](https://github.com/JuicyBenjamin/collagen/commit/b48301ba1d30e4015a633e49f07951213988f524))


### Bug Fixes

* **cli:** a decision whose code is in no change still shows on the review page ([59bc06c](https://github.com/JuicyBenjamin/collagen/commit/59bc06c9654081068d1219d77415405d2bf536db))
* **cli:** a message arriving while details are read does not take the cursor ([11f63df](https://github.com/JuicyBenjamin/collagen/commit/11f63dff40e54b0cf916a150ff15e0a2b67099e3))
* **cli:** a review page leads with its title, the summary beneath it ([a64e9ed](https://github.com/JuicyBenjamin/collagen/commit/a64e9ed5e8e82e87723593477ec844c40395c20a))
* **cli:** an unfolded message taller than the list reads steadily ([b50e7e2](https://github.com/JuicyBenjamin/collagen/commit/b50e7e243271a16d379f7e51811f5673a5ddaa94))
* **cli:** letting go of a live stream closes its connection at once ([d2b494f](https://github.com/JuicyBenjamin/collagen/commit/d2b494f0dea8cfdccfbb1c8645db7814ea3e977c))
* **cli:** the epic offer hands the agent candidates to judge, not an order to ask ([43d5abe](https://github.com/JuicyBenjamin/collagen/commit/43d5abe0cc4c5a20defa6e8b6109b485bec45f96))
* **cli:** the epic offer on a filing names the epic by its title ([977cb52](https://github.com/JuicyBenjamin/collagen/commit/977cb52cf35b4164397b3c9b851282c2e094ef1c))
* **cli:** the epic tool names an epic, and the tickets it moves, by their titles ([5a4ff48](https://github.com/JuicyBenjamin/collagen/commit/5a4ff480d4adae2f5930da48d9247321804aff51))
* **cli:** the outbox names an epic by its title too ([3135696](https://github.com/JuicyBenjamin/collagen/commit/3135696e0df06cb5db8a799a5211775016e44127))
* **cli:** the overview list keeps the cursor in view as rows move under it ([e631d4b](https://github.com/JuicyBenjamin/collagen/commit/e631d4b9b542a1e4fb67c94fa316c2f74421b68a))
* **cli:** the overview list scrolls only when the cursor reaches its edge ([82a3be8](https://github.com/JuicyBenjamin/collagen/commit/82a3be84ad4c21b2650c2ab2fcf343bfd979e904))
* **cli:** the overview ticket list scrolls to the cursor instead of spilling its box ([5b57da1](https://github.com/JuicyBenjamin/collagen/commit/5b57da1002a7ff96747fb84cbb07e83f3524a7d0))
* **cli:** the review page's tool state is live, and a rebuilt page never answers 503 ([f121ff9](https://github.com/JuicyBenjamin/collagen/commit/f121ff90a87b13d6d830e019d716c933923f5e28))
* **cli:** the tickets hint fits 120 columns, its verdicts spelled out whole ([accd941](https://github.com/JuicyBenjamin/collagen/commit/accd941b96734a3e4cd0a51ce2cf8c9b466e932c))
* **cli:** the whole file and what moved since are read at the commit the page shows ([aa637f9](https://github.com/JuicyBenjamin/collagen/commit/aa637f9c428b432c2070f424296c9fbb2897e061))
* **cli:** types and peeks on the review page are of the commit the page shows ([3aa03e0](https://github.com/JuicyBenjamin/collagen/commit/3aa03e037fc3a20a67ad7c8b30714b9e271fcf4c))
* **p2p:** a build that evicted our own why puts it back from our history ([bf0cf8c](https://github.com/JuicyBenjamin/collagen/commit/bf0cf8cc47aaa382684ad1f1d80beb2f8b55889b))

## [0.18.0-alpha](https://github.com/JuicyBenjamin/collagen/compare/cli-v0.17.0-alpha...cli-v0.18.0-alpha) (2026-10-02)


### Features

* **cli:** an epic's author can rename it ([8dc510e](https://github.com/JuicyBenjamin/collagen/commit/8dc510ee462edb3f93306781d9ed9137b4e45af5))
* **cli:** every ticket has a short title, and its goal is the line beneath ([7dacb6f](https://github.com/JuicyBenjamin/collagen/commit/7dacb6f9b3b8d6dd6e92ae9184ac9ff59c43a166))


### Bug Fixes

* **cli:** 'filed together' goes by when tickets were filed, not last revised ([9186683](https://github.com/JuicyBenjamin/collagen/commit/9186683bf08312b4f6344556a507f94b4ea39086))
* **cli:** a plan's glyph is ≡, one column wide in every terminal ([d74ef64](https://github.com/JuicyBenjamin/collagen/commit/d74ef64c8c262e139ff217ec1b34934377fdb001))
* **cli:** an epic's rows keep the mark column, the tree line under its title ([d1a7fb7](https://github.com/JuicyBenjamin/collagen/commit/d1a7fb776bcc61c39e06d70433f0d4b123491eb8))
* **cli:** an epic's rows sit on the columns every other row uses ([380dc15](https://github.com/JuicyBenjamin/collagen/commit/380dc1591192faeaa7522b750eb7ca54324c67d9))
* **cli:** an epic's tickets sit on a tree under its crown, each with its kind ([f09b1c2](https://github.com/JuicyBenjamin/collagen/commit/f09b1c26464e16045d6c3b59130fc54244c3d9fa))
* **cli:** an epic's tree line sits under its title, past the crown ([4bdece4](https://github.com/JuicyBenjamin/collagen/commit/4bdece4a06a8e3fdcdee2e3dd9397d96dc46921b))
* **cli:** epics stand apart on the overview: a crown, space around, tickets shown ([d37296e](https://github.com/JuicyBenjamin/collagen/commit/d37296ef91f1b157fafa032a49bac6a166aeb8f1))
* **cli:** every row says its kind with a glyph, and its info lines up past the titles ([141fc61](https://github.com/JuicyBenjamin/collagen/commit/141fc61a50c8a6e561ab9306559d93c91464f87b))
* **cli:** get-tickets names an untitled epic by its goal, as the TUI does ([53dd169](https://github.com/JuicyBenjamin/collagen/commit/53dd1697da8f4581d71549e61b2df5f7210e6972))
* **cli:** the overview's columns fit the pane, measured in terminal cells ([e6638e5](https://github.com/JuicyBenjamin/collagen/commit/e6638e57bcd0b22be815db561c33e8cf04179182))
* **cli:** titles merge the same however copies are grouped, and stay on one line ([8c5758b](https://github.com/JuicyBenjamin/collagen/commit/8c5758b43e887fa91c103ba4d849c5ad8ab6cef3))

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
