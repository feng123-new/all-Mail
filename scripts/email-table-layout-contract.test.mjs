import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../web/src/components/DataWorkspace.css", import.meta.url),
  "utf8",
);

const externalMailboxScope =
  /\.workspace-frame--resource[\s\S]*?ant-table-selection-column:first-child[\s\S]*?th:nth-child\(9\)/;

test("external mailbox table has a scoped bounded layout contract", () => {
  assert.match(source, externalMailboxScope);
  assert.match(source, /--external-mailbox-table-min-width:\s*1640px/);
  assert.match(source, /overflow-x:\s*auto/);
  assert.match(
    source,
    /width:\s*max\(100%, var\(--external-mailbox-table-min-width\)\)\s*!important/,
  );
  assert.match(source, /table-layout:\s*fixed\s*!important/);

  const expectedColumnWidths = new Map([
    [1, 44],
    [2, 330],
    [3, 230],
    [4, 180],
    [5, 210],
    [6, 88],
    [7, 156],
    [8, 156],
    [9, 246],
  ]);

  for (const [column, width] of expectedColumnWidths) {
    assert.match(
      source,
      new RegExp(
        `col:nth-child\\(${column}\\)[\\s\\S]{0,900}?width:\\s*${width}px\\s*!important`,
      ),
    );
  }
});

test("long mailbox metadata is clipped instead of overlapping adjacent cells", () => {
  assert.match(
    source,
    /td:nth-child\(2\)[\s\S]{0,700}?text-overflow:\s*ellipsis/,
  );
  assert.match(source, /-webkit-line-clamp:\s*2/);
  assert.match(
    source,
    /td:nth-child\(3\)[\s\S]{0,1800}?div:last-child[\s\S]{0,120}?display:\s*none/,
  );
  assert.match(
    source,
    /td:nth-child\(4\)[\s\S]{0,700}?text-overflow:\s*ellipsis/,
  );
  assert.match(
    source,
    /td:nth-child\(5\)[\s\S]{0,700}?word-break:\s*normal\s*!important/,
  );
});
