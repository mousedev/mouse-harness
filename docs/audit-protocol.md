# The MOUSE_AUDIT protocol

Source: `parseAuditBlock`, `buildContinuePrompt`, and `auditFooter` in `packages/core/src/loop.ts`.

## What the model is asked for

Every continue prompt ends with this footer:

```
When you are finished, end your reply with an audit of the original task, one line per requirement, in exactly this form:
MOUSE_AUDIT
- [done] <requirement>: <the file, test, or command output that proves it>
- [todo] <requirement>: <what is still missing>
END_MOUSE_AUDIT
Mark a requirement done only with evidence you produced in this workspace.
```

The first turn (your instruction, sent unchanged) does not carry the footer, so the first audit block normally appears after the first `audit` round.

## What is accepted

`parseAuditBlock(text)` looks at the final assistant text of the most recent turn.

- It finds the last `MOUSE_AUDIT` opener in the text. Because `MOUSE_AUDIT` is a substring of `END_MOUSE_AUDIT`, an opener that is actually the tail of a closer is skipped and the search continues backwards.
- The body runs from the opener to the next `END_MOUSE_AUDIT`, or to the end of the text when the closer is missing.
- Each line matching `- [<marker>] <item>` or `* [<marker>] <item>` is an item. Markers: `done`, `x`, or `X` count as done; `todo` or a single space (`[ ]`) count as todo. Leading whitespace is allowed. Other lines in the body are ignored.
- The item text is everything after the marker, trimmed. Mouse does not interpret it; the `<requirement>: <evidence>` shape is a convention for readers.
- If the block has no items at all, the result is `null`, the same as no block.

The result is `{ done: string[], todo: string[] }`.

## How it is used

A run is `satisfied` when, at the top of a round, all three hold:

1. the workspace fingerprint differs from the one taken before the first turn (something changed);
2. zero checks failed in this round's probe;
3. `parseAuditBlock` returned a block with zero `todo` items.

The model's block never advances the task state on its own. The checks and the tamper scan are what the loop believes; the block is the model's declaration that it has nothing left, and it is only honoured once the environment agrees.

When an `audit` round is sent and the previous block listed `todo` items, those items are quoted back under "You previously listed these as not done:".

An `audit` round in which the model edits nothing but replies with a clean block does not count towards the stall limit; the next iteration exits `satisfied` (provided the checks still pass).

## Example

```
Implemented the flag and the tests; `pnpm test` passes (14 tests).

MOUSE_AUDIT
- [done] --json flag on the CLI: src/cli.ts parses it, test/cli.test.ts covers both outputs
- [done] tests pass: `pnpm test` exit 0, 14 passed
- [todo] README mention: not yet added
END_MOUSE_AUDIT
```

This block has one `todo`, so the loop sends another `audit` round quoting that item. A reply whose block has only `done` lines ends the run, if the checks pass.
