from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

ReadingLevel = str
VALID_READING_LEVELS = {"low", "medium", "high"}


@dataclass(frozen=True)
class Person:
    name: str
    reading_level: ReadingLevel
    talkative: bool = False
    iep_front: bool = False
    avoid: List[str] = field(default_factory=list)
    must_sit_by: List[str] = field(default_factory=list)


Chart = List[List[Optional[str]]]


def default_people() -> List[Person]:
    return [
        Person("Avery", "high", talkative=False, iep_front=True, avoid=["Kai"]),
        Person("Blake", "low", talkative=True, avoid=["Maya"]),
        Person("Casey", "medium", talkative=False),
        Person("Drew", "high", talkative=True),
        Person("Emery", "low", talkative=False, iep_front=False),
        Person("Finley", "medium", talkative=True, avoid=["Avery"]),
        Person("Gray", "high", talkative=False),
        Person("Harper", "low", talkative=True),
        Person("Indigo", "medium", talkative=False, iep_front=True),
        Person("Jules", "high", talkative=False),
        Person("Kai", "medium", talkative=True, avoid=["Avery"]),
        Person("Maya", "low", talkative=False, avoid=["Blake"]),
        Person("Nova", "high", talkative=True),
        Person("Oak", "medium", talkative=False),
        Person("Parker", "low", talkative=False),
        Person("Quinn", "high", talkative=True),
        Person("Riley", "medium", talkative=False),
        Person("Sawyer", "low", talkative=True),
        Person("Tatum", "medium", talkative=False),
        Person("Vale", "high", talkative=False),
    ]


def people_to_json(people: Iterable[Person]) -> str:
    return json.dumps([person_to_dict(person) for person in people], indent=2)


def people_to_table(people: Iterable[Person]) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["name", "reading_level", "talkative", "iep_front", "avoid", "must_sit_by"])
    for person in people:
        writer.writerow(
            [
                person.name,
                person.reading_level,
                "yes" if person.talkative else "no",
                "yes" if person.iep_front else "no",
                ";".join(person.avoid),
                ";".join(person.must_sit_by),
            ]
        )
    return output.getvalue().strip()


def person_to_dict(person: Person) -> Dict[str, object]:
    return {
        "name": person.name,
        "reading_level": person.reading_level,
        "talkative": person.talkative,
        "iep_front": person.iep_front,
        "avoid": list(person.avoid),
        "must_sit_by": list(person.must_sit_by),
    }


def parse_people_json(raw_json: str) -> List[Person]:
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc

    if not isinstance(data, list):
        raise ValueError("People JSON must be a list of objects.")

    return [_person_from_json_entry(entry) for entry in data]


def parse_people_table(raw_text: str) -> List[Person]:
    if not raw_text.strip():
        return []
    delimiter = "\t" if "\t" in raw_text else ","
    reader = csv.DictReader(io.StringIO(raw_text), delimiter=delimiter, skipinitialspace=True)
    if not reader.fieldnames:
        raise ValueError("People table must include headers.")
    missing = {"name", "reading_level"}.difference(
        {name.strip() for name in reader.fieldnames}
    )
    if missing:
        raise ValueError("People table must include name and reading_level columns.")

    people: List[Person] = []
    for row in reader:
        person = _person_from_table_row(row)
        if person is not None:
            people.append(person)
    return people


def chart_to_json(chart: Chart) -> str:
    return json.dumps(chart)


def chart_from_json(raw_json: str) -> Chart:
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid chart JSON: {exc}") from exc
    if not isinstance(data, list):
        raise ValueError("Chart JSON must be a 2D list.")
    return [[seat if seat is None else str(seat) for seat in row] for row in data]


def _parse_bool(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    return text in {"1", "true", "yes", "y"}


def _person_from_json_entry(entry: object) -> Person:
    if not isinstance(entry, dict):
        raise ValueError("Each person entry must be an object.")

    name = _require_name(entry.get("name", ""))
    reading_level = _normalize_reading_level(name, entry.get("reading_level", "medium"))
    return Person(
        name=name,
        reading_level=reading_level,
        talkative=bool(entry.get("talkative", False)),
        iep_front=bool(entry.get("iep_front", False)),
        avoid=_list_field(entry.get("avoid", []), name, "Avoid"),
        must_sit_by=_list_field(entry.get("must_sit_by", []), name, "Must-sit-by"),
    )


def _person_from_table_row(row: Dict[str, object]) -> Optional[Person]:
    name = str(row.get("name", "")).strip()
    if not name:
        return None
    reading_level = _normalize_reading_level(name, row.get("reading_level", "medium"))
    return Person(
        name=name,
        reading_level=reading_level,
        talkative=_parse_bool(row.get("talkative")),
        iep_front=_parse_bool(row.get("iep_front")),
        avoid=_semicolon_list(row.get("avoid", "")),
        must_sit_by=_semicolon_list(row.get("must_sit_by", "")),
    )


def _require_name(value: object) -> str:
    name = str(value).strip()
    if not name:
        raise ValueError("Each person must have a name.")
    return name


def _normalize_reading_level(name: str, value: object) -> str:
    reading_level = str(value).strip().lower()
    if reading_level not in VALID_READING_LEVELS:
        raise ValueError(f"Invalid reading_level for {name}.")
    return reading_level


def _list_field(value: object, name: str, field_label: str) -> List[str]:
    if not isinstance(value, list):
        raise ValueError(f"{field_label} list for {name} must be a list.")
    return [str(item) for item in value if str(item).strip()]


def _semicolon_list(value: object) -> List[str]:
    return [item.strip() for item in str(value).strip().split(";") if item.strip()]
