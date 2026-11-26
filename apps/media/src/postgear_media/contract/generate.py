"""Generates the Pydantic models from the contract's JSON Schema.

`npm run contract:python` runs this; `tests/test_contract.py` runs it into a
temporary file and fails when the committed `generated.py` differs, so a shape
changed on the Node side without regenerating fails `npm run validate`.

The options live here, once, so the command and the freshness test can never
disagree about them.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

HEADER = "# Do not edit: generated from packages/media-contract/schema/contract.json\n"
HEADER += "# by `npm run contract:python`. Change the Zod shapes, then regenerate.\n"

REPO_ROOT = Path(__file__).resolve().parents[5]
SCHEMA = REPO_ROOT / "packages" / "media-contract" / "schema" / "contract.json"
TARGET = Path(__file__).resolve().parent / "generated.py"

OPTIONS = [
    "--input-file-type",
    "jsonschema",
    "--output-model-type",
    "pydantic_v2.BaseModel",
    "--target-python-version",
    "3.13",
    "--use-annotated",
    "--field-constraints",
    "--use-standard-collections",
    "--use-union-operator",
    "--disable-timestamp",
    "--enum-field-as-literal",
    "all",
    "--use-title-as-name",
    "--snake-case-field",
    "--allow-population-by-field-name",
    "--extra-fields",
    "forbid",
    "--use-schema-description",
    "--use-field-description",
    "--use-double-quotes",
    # A named string (a storage key, an id) is a plain constrained `str` field,
    # not a wrapper object: `payload.audio_key`, never `payload.audio_key.root`.
    "--collapse-root-models",
    "--custom-file-header",
    HEADER.rstrip("\n"),
]


def generate(target: Path = TARGET, schema: Path = SCHEMA) -> Path:
    """Writes the models for `schema` into `target` and answers `target`."""
    executable = Path(sys.executable).with_name("datamodel-codegen")
    subprocess.run(  # noqa: S603 - fixed program and arguments
        [str(executable), "--input", str(schema), "--output", str(target), *OPTIONS],
        check=True,
        capture_output=True,
    )
    return target


if __name__ == "__main__":
    written = generate()
    sys.stdout.write(f"Wrote {written.relative_to(REPO_ROOT)}\n")
