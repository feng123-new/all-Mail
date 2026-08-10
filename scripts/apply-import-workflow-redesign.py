#!/usr/bin/env python3
from pathlib import Path
import re

index_path = Path("web/src/pages/emails/index.tsx")
source = index_path.read_text()


def replace_once(old: str, new: str, label: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    source = source.replace(old, new)


replace_once("\tInboxOutlined,\n", "", "remove obsolete Inbox icon import")
replace_once(
    "\tgetProviderImportTemplates,\n",
    "",
    "remove inline template dependency",
)
replace_once(
    "\tForm,\n\tInput,\n\tModal,",
    "\tForm,\n\tGrid,\n\tInput,\n\tModal,",
    "add responsive Grid import",
)
replace_once("\twidth260Style,\n", "", "remove obsolete import width helper")
replace_once(
    'import { emailsInlineI18n } from "./inlineMessages";\n',
    'import MailImportWorkflow from "./ImportWorkflow";\n'
    'import MailboxRowActions from "./MailboxRowActions";\n'
    'import { emailsInlineI18n } from "./inlineMessages";\n',
    "add mailbox workflow components",
)
replace_once('const { Dragger } = Upload;\n', "", "remove inline Dragger alias")
replace_once(
    '\tconst [searchParams] = useSearchParams();\n',
    '\tconst [searchParams] = useSearchParams();\n'
    '\tconst screens = Grid.useBreakpoint();\n'
    '\tconst useCompactActions = screens.md === false;\n',
    "add responsive mailbox action breakpoint",
)
replace_once(
    '\tconst [importModalVisible, setImportModalVisible] = useState(false);\n',
    '\tconst [importModalVisible, setImportModalVisible] = useState(false);\n'
    '\tconst [toolMenuOpen, setToolMenuOpen] = useState(false);\n',
    "add controlled tools menu state",
)

state_pattern = re.compile(
    r'\n\tconst \[importContent, setImportContent\] = useState\(""\);'
    r'\n\tconst \[separator, setSeparator\] = useState\("----"\);'
    r'\n\tconst \[importGroupId, setImportGroupId\] = useState<number \| undefined>\('
    r'\n\t\tundefined,'
    r'\n\t\);'
)
source, state_count = state_pattern.subn("", source)
if state_count != 1:
    raise SystemExit(
        f"remove legacy import state: expected one match, found {state_count}"
    )

template_pattern = re.compile(
    r'\n\tconst importTemplates = useMemo\('
    r'.*?'
    r'\n\tconst legacyImportTemplates = useMemo\('
    r'.*?'
    r'\n\t\);',
    re.S,
)
source, template_count = template_pattern.subn("", source)
if template_count != 1:
    raise SystemExit(
        f"remove legacy import templates: expected one match, found {template_count}"
    )

handler_pattern = re.compile(
    r'\n\tconst handleImport = async \(\) => \{.*?\n\t\};\n\n'
    r'\tconst handleExport = async \(\) => \{',
    re.S,
)
source, handler_count = handler_pattern.subn(
    '\n\tconst handleExport = async () => {', source
)
if handler_count != 1:
    raise SystemExit(
        f"remove legacy import handler: expected one match, found {handler_count}"
    )

replace_once(
    "const res = await emailsContract.export(ids, separator, groupId);",
    'const res = await emailsContract.export(ids, "----", groupId);',
    "keep canonical export separator",
)
replace_once(
    '\t\t\tonClick: () => setImportModalVisible(true),\n',
    '\t\t\tonClick: () => {\n'
    '\t\t\t\tsetToolMenuOpen(false);\n'
    '\t\t\t\tsetImportModalVisible(true);\n'
    '\t\t\t},\n',
    "close tools menu before opening import workflow",
)
replace_once(
    '<Dropdown menu={{ items: toolActionItems }}>',
    '<Dropdown\n'
    '\t\t\t\t\t\t\topen={toolMenuOpen}\n'
    '\t\t\t\t\t\t\tonOpenChange={setToolMenuOpen}\n'
    '\t\t\t\t\t\t\tmenu={{ items: toolActionItems }}\n'
    '\t\t\t\t\t\t>',
    "control tools dropdown visibility",
)

action_pattern = re.compile(
    r'\t\t\t\{\n'
    r'\t\t\t\ttitle: t\(adminI18n\.common\.actions\),\n'
    r'\t\t\t\tkey: "action",\n'
    r'\t\t\t\twidth: 220,\n'
    r'\t\t\t\trender: \(_: unknown, record: EmailAccount\) => \(\n'
    r'.*?'
    r'\n\t\t\t\t\),\n'
    r'\t\t\t\},\n',
    re.S,
)
action_replacement = """\t\t\t{
\t\t\t\ttitle: t(adminI18n.common.actions),
\t\t\t\tkey: \"action\",
\t\t\t\twidth: useCompactActions ? 154 : 220,
\t\t\t\trender: (_: unknown, record: EmailAccount) => (
\t\t\t\t\t<MailboxRowActions
\t\t\t\t\t\tcompact={useCompactActions}
\t\t\t\t\t\thasNewInboxMessages={hasNewMailboxMessages(record, \"INBOX\")}
\t\t\t\t\t\tcanRevealPassword={canRevealStoredAccountLoginPassword(record)}
\t\t\t\t\t\thasStoredPassword={record.hasStoredAccountLoginPassword}
\t\t\t\t\t\tonOpenInbox={() => void handleViewMails(record, \"INBOX\")}
\t\t\t\t\t\tonOpenSent={() => void handleViewMails(record, \"SENT\")}
\t\t\t\t\t\tonRevealPassword={() => void handleRowPasswordReveal(record)}
\t\t\t\t\t\tonCheckConnection={() => void handleCheckSingleMailbox(record)}
\t\t\t\t\t\tonEdit={() => void handleEdit(record)}
\t\t\t\t\t\tonDelete={() => handleDelete(record.id)}
\t\t\t\t\t/>
\t\t\t\t),
\t\t\t},
"""
source, action_count = action_pattern.subn(action_replacement, source)
if action_count != 1:
    raise SystemExit(
        f"replace mailbox action column: expected one match, found {action_count}"
    )

replace_once(
    '\t\t\thasNewMailboxMessages,\n\t\t\tt,\n',
    '\t\t\thasNewMailboxMessages,\n\t\t\tuseCompactActions,\n\t\t\tt,\n',
    "track responsive action dependency",
)

import_modal_pattern = re.compile(
    r'\n\t\t\t\{/\* 批量导入 Modal \*/\}\n'
    r'.*?'
    r'\n\t\t\t</Modal>\n\n'
    r'\t\t\t\{/\* 邮件列表 Modal \*/\}',
    re.S,
)
workflow_mount = """
\t\t\t<MailImportWorkflow
\t\t\t\topen={importModalVisible}
\t\t\t\tgroups={groups}
\t\t\t\tonClose={() => setImportModalVisible(false)}
\t\t\t\tonImported={async () => {
\t\t\t\t\tawait Promise.all([fetchData(), fetchGroups()]);
\t\t\t\t}}
\t\t\t/>

\t\t\t{/* 邮件列表 Modal */}"""
source, modal_count = import_modal_pattern.subn(workflow_mount, source)
if modal_count != 1:
    raise SystemExit(
        f"replace legacy import modal: expected one match, found {modal_count}"
    )

for token in (
    "setImportContent",
    "recommendedImportTemplates",
    "legacyImportTemplates",
    "const handleImport =",
    "const { Dragger }",
):
    if token in source:
        raise SystemExit(f"legacy import token remains: {token}")

index_path.write_text(source)

preview_path = Path("web/src/pages/emails/importPreview.ts")
preview = preview_path.read_text()
preview = preview.replace(
    "function maskParts(parts: string[], visibleIndexes: number[]): string {",
    "function maskParts(\n"
    "  parts: string[],\n"
    "  visibleIndexes: number[],\n"
    "  separator: string,\n"
    "): string {",
)
preview = preview.replace("    .join('----');", "    .join(separator);")
preview = preview.replace(
    "  profile: TokenProfile,\n): ImportPreviewRow {",
    "  profile: TokenProfile,\n  separator: string,\n): ImportPreviewRow {",
)
preview = preview.replace(
    "maskParts(parts, profile.visibleIndexes)",
    "maskParts(parts, profile.visibleIndexes, separator)",
)
preview = preview.replace(
    "  parts: string[],\n): ImportPreviewRow {\n  const email = parts[0]",
    "  parts: string[],\n  separator: string,\n): ImportPreviewRow {\n"
    "  const email = parts[0]",
)
preview = preview.replace(
    "maskParts(parts, [0])", "maskParts(parts, [0], separator)"
)
preview = preview.replace(
    "maskParts(parts, [])", "maskParts(parts, [], separator)"
)
preview = preview.replace(
    "return parseTokenizedLine(lineNumber, raw, parts, tokenProfile);",
    "return parseTokenizedLine(\n"
    "      lineNumber,\n"
    "      raw,\n"
    "      parts,\n"
    "      tokenProfile,\n"
    "      separator,\n"
    "    );",
)
preview = preview.replace(
    "return parseEmailFirstLine(lineNumber, raw, parts);",
    "return parseEmailFirstLine(lineNumber, raw, parts, separator);",
)
if ".join('----')" in preview or "maskParts(parts, [0])" in preview:
    raise SystemExit("separator-aware preview patch was incomplete")
preview_path.write_text(preview)
