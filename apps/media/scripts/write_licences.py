"""Lists the Python packages installed beside this interpreter, with their licences.

    python scripts/write_licences.py --out /out/licenses/python-packages.md --title "..."

Run by `infra/docker/Dockerfile.media` at build time with each environment's
own interpreter (the service's `.venv`, and the voice program's when it is
built), so the list is exactly what that image holds. It reads only metadata
that is already installed: no network, no package index. The licence is the
package's `License-Expression` when it has one, else a short `License` field,
else its licence classifiers; the full texts stay in each package's
`.dist-info` folder, named in the last column. Standard library only, so any
interpreter can run it.
"""

from __future__ import annotations

import argparse
from importlib import metadata
from pathlib import Path

#: A `License` field longer than this is a whole licence text, not a name.
SHORT_LICENSE_CHARS = 80
CLASSIFIER_PREFIX = "License :: "


def licence_of(dist: metadata.Distribution) -> str:
    """The package's licence in a few words, or `not stated`."""
    meta = dist.metadata
    expression = (meta.get("License-Expression") or "").strip()
    if expression:
        return expression
    field = " ".join((meta.get("License") or "").split())
    if field and len(field) <= SHORT_LICENSE_CHARS and field.upper() != "UNKNOWN":
        return field
    names = [
        item.removeprefix(CLASSIFIER_PREFIX).split(" :: ")[-1]
        for item in meta.get_all("Classifier") or []
        if item.startswith(CLASSIFIER_PREFIX)
    ]
    if names:
        return ", ".join(sorted(set(names)))
    return "not stated (see the files)" if field else "not stated"


def licence_files(dist: metadata.Distribution) -> str:
    """The licence files the package declares, as written in its metadata."""
    files = dist.metadata.get_all("License-File") or []
    return ", ".join(sorted(set(files))) or "none declared"


def cell(text: str) -> str:
    return text.replace("|", "/").replace("\n", " ")


def table(title: str) -> str:
    """One Markdown table of every installed package, sorted by name."""
    seen: dict[str, metadata.Distribution] = {}
    for dist in metadata.distributions():
        name = (dist.metadata.get("Name") or "").strip()
        if name and name.lower() not in seen:
            seen[name.lower()] = dist
    lines = [
        f"# {title}",
        "",
        "Generated at build time from the installed packages' own metadata. Each",
        "package's licence texts are in its `.dist-info` folder (last column).",
        "",
        "| Package | Version | Licence | Licence files |",
        "|---|---|---|---|",
    ]
    for key in sorted(seen):
        dist = seen[key]
        lines.append(
            f"| {cell(dist.metadata['Name'])} | {cell(dist.version)} | "
            f"{cell(licence_of(dist))} | {cell(licence_files(dist))} |",
        )
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Write the installed packages and licences.")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--title", default="Python packages in this image")
    args = parser.parse_args()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(table(args.title), encoding="utf-8")


if __name__ == "__main__":
    main()
