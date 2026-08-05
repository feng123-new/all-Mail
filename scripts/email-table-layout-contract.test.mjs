import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const overrideSource = readFileSync(
  new URL("../web/src/components/ExternalMailboxTable.css", import.meta.url),
  "utf8",
);
const workspaceSource = readFileSync(
  new URL("../web/src/components/DataWorkspace.tsx", import.meta.url),
  "utf8",
);
const shellSource = readFileSync(
  new URL("../web/src/layouts/MainLayout.tsx", import.meta.url),
  "utf8",
);

const externalMailboxScope =
  /\.workspace-frame--resource[\s\S]*?ant-table-selection-column:first-child[\s\S]*?th:nth-child\(9\)/;

test("external mailbox overrides load after the generic workspace table styles", () => {
  const genericImport = workspaceSource.indexOf("./DataWorkspace.css");
  const mailboxImport = workspaceSource.indexOf("./ExternalMailboxTable.css");

  assert.notEqual(genericImport, -1);
  assert.notEqual(mailboxImport, -1);
  assert.ok(mailboxImport > genericImport);
});

test("external mailbox table uses the page viewport instead of a fixed nested layer", () => {
  assert.match(overrideSource, externalMailboxScope);
  assert.doesNotMatch(overrideSource, /1640px/);
  assert.match(overrideSource, /overflow-x:\s*hidden\s*!important/);
  assert.match(overrideSource, /max-height:\s*none\s*!important/);
  assert.match(overrideSource, /overflow-y:\s*visible\s*!important/);
  assert.match(overrideSource, /width:\s*100%\s*!important/);
  assert.match(overrideSource, /min-width:\s*0\s*!important/);
  assert.match(overrideSource, /table-layout:\s*fixed\s*!important/);
  assert.match(shellSource, /routeMeta\.key === '\/emails' \? 1920 : 1520/);
  assert.match(shellSource, /<PageSurface maxWidth=\{pageSurfaceMaxWidth\}>/);
});

test("external mailbox rows stay dense and responsive without horizontal scrolling", () => {
  assert.match(overrideSource, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(overrideSource, /height:\s*24px/);
  assert.match(overrideSource, /text-overflow:\s*ellipsis/);
  assert.match(overrideSource, /@media \(max-width:\s*1600px\)/);
  assert.match(overrideSource, /@media \(max-width:\s*1220px\)/);
  assert.match(overrideSource, /@media \(max-width:\s*820px\)/);
  assert.match(
    overrideSource,
    /col:nth-child\(5\)[\s\S]{0,180}?th:nth-child\(5\)[\s\S]{0,180}?td:nth-child\(5\)[\s\S]{0,220}?display:\s*none\s*!important/,
  );
  assert.match(
    overrideSource,
    /col:nth-child\(8\)[\s\S]{0,180}?th:nth-child\(8\)[\s\S]{0,180}?td:nth-child\(8\)[\s\S]{0,220}?display:\s*none\s*!important/,
  );
});
