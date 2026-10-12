# Merged stack review audit

Audited PRs #1–#3 and #5–#10 against main at ab4093f6174e3cad0d39322b0f1e22e578be00df. All nine PRs are merged. There are 16 findings; seven were already addressed by later commits in the merged stack, and nine findings map to eight remaining fixes.

| PR | Finding | Resolution |
| --- | --- | --- |
| [#1](https://github.com/and1truong/omd/pull/1#discussion_r4243814672) | Mutable subscriber state | Already fixed: deeply immutable published state. Added regression covering retained snapshots. |
| [#1](https://github.com/and1truong/omd/pull/1#discussion_r4243814681) | Stale undo/redo controls during notification | Already fixed: history stacks change before publish. Added subscriber-level regression. |
| [#1](https://github.com/and1truong/omd/pull/1#discussion_r4243814682) | Synthetic page container ID collision | Reject the reserved page alias on toggle, tab and accordion containers before import or mutation. |
| [#2](https://github.com/and1truong/omd/pull/2#discussion_r4243831081) | Full notebook snapshot per keystroke | Already replaced by record patches in IndexedDB and journal IDs in RAM. No content/history quantity quota added; unreachable journals are pruned and unchanged image bytes are separated from drawing patches. |
| [#2](https://github.com/and1truong/omd/pull/2#discussion_r4243831084) | IME input discarded by background rendering | Defer notebook rendering while composing; persist final text to the original page, then render the newest state. |
| [#3](https://github.com/and1truong/omd/pull/3#discussion_r4243851899) | Previously valid v1 dates rejected on upgrade | Normalize legacy Date.parse-compatible strings during JSON import/migration. New commands retain explicit ISO/timezone requirements; raw saved bytes remain intact. |
| [#5](https://github.com/and1truong/omd/pull/5#discussion_r4243910438) | Agent revisions use the page counter | Read and history tools return the notebook counter as revision; read snapshots include pageRevision separately. |
| [#5](https://github.com/and1truong/omd/pull/5#discussion_r4243910439) | Keyboard selection disappears below palette viewport | Scroll the selected option into view after arrow navigation. |
| [#6](https://github.com/and1truong/omd/pull/6#discussion_r4243936299) | Ambiguous diagram composite keys | JSON tuple keys separate page and block IDs. |
| [#6](https://github.com/and1truong/omd/pull/6#discussion_r4243936300) | Canvas placeholder selector rejects quotes/backslashes | Already fixed with CSS.escape; native browser regression retains coverage. |
| [#6](https://github.com/and1truong/omd/pull/6#discussion_r4243936306) | Old Mermaid error remains after clearing source | Clear the error when showing the empty-source prompt. |
| [#7](https://github.com/and1truong/omd/pull/7#discussion_r4244166822) | Root render-list key collides with a user container | Same reserved-container validation prevents ambiguous lists from reaching the renderer. |
| [#8](https://github.com/and1truong/omd/pull/8#discussion_r4244292667) | Width checkbox diverges after a quota failure | Synchronize controls from retained preferences in the error path. |
| [#9](https://github.com/and1truong/omd/pull/9#discussion_r4244403005) | Same-parent Move to appends the page | Already fixed: unchanged parent selections do not dispatch a move. |
| [#10](https://github.com/and1truong/omd/pull/10#discussion_r4244553548) | Unreachable durable undo journals accumulate | Already fixed: redo/reload/close cleanup and Web Lock leases for abandoned sessions; regression covers another live tab. |
| [#10](https://github.com/and1truong/omd/pull/10#pullrequestreview-5486407886) | Canvas tools report success before async operations finish | Already fixed: open/close promises are awaited and errors propagated. |

## PR #9 WebMCP coverage

The 50-tool registry includes list_pages, get_page, page_add, page_select, page_update, page_move, page_remove, open_palette, get_view and set_view. Creation and movement accept parentId; movement includes subtree/sibling ordering; deletion removes a subtree; list_pages includes hierarchy/depth/count metadata; set_view controls collapsedPageIds. The shared model enforces cycles, the 32-level hierarchy boundary and at least one surviving page. Existing block tools can target inactive pages through pageId.

Notification permission, installation and persistent-storage requests use prepare tools that open the required real user-click flows. Import retains confirmation and backup. These browser requirements are exposed explicitly, rather than claiming automatic permission grants.
