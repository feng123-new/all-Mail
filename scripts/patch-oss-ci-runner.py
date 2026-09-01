from pathlib import Path

script_path = Path("scripts/patch-oss-ci.py")
source = script_path.read_text(encoding="utf-8")

source = source.replace(
    "The project is **free and open-source software licensed under `AGPL-3.0-only`**. Public material should use the same license identity and avoid reintroducing the retired non-commercial/source-available wording.",
    "The project is **free and open-source software licensed under `AGPL-3.0-only`**. Public material should use this canonical license identity consistently.",
)
source = source.replace(
    "Current public documentation describes `all-Mail` as free and open-source software and does not reintroduce the retired custom non-commercial license.",
    "Current public documentation describes `all-Mail` as free and open-source software and uses the canonical AGPL license identity consistently.",
)

exec(compile(source, str(script_path), "exec"))
