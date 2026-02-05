from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, field
from typing import Dict, Iterable, List, Optional

ReadingLevel = str


@dataclass(frozen=True)
class Person:
    name: str
    reading_level: ReadingLevel
    talkative: bool = False
    iep_front: bool = False
    avoid: List[str] = field(default_factory=list)


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
    writer.writerow(["name", "reading_level", "talkative", "iep_front", "avoid"])
    for person in people:
        writer.writerow(
            [
                person.name,
                person.reading_level,
                "yes" if person.talkative else "no",
                "yes" if person.iep_front else "no",
                ";".join(person.avoid),
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
    }


def parse_people_json(raw_json: str) -> List[Person]:
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc

    if not isinstance(data, list):
        raise ValueError("People JSON must be a list of objects.")

    people: List[Person] = []
    for entry in data:
        if not isinstance(entry, dict):
            raise ValueError("Each person entry must be an object.")
        name = str(entry.get("name", "")).strip()
        if not name:
            raise ValueError("Each person must have a name.")
        reading_level = str(entry.get("reading_level", "medium")).strip().lower()
        if reading_level not in {"low", "medium", "high"}:
            raise ValueError(f"Invalid reading_level for {name}.")
        talkative = bool(entry.get("talkative", False))
        iep_front = bool(entry.get("iep_front", False))
        avoid = entry.get("avoid", [])
        if not isinstance(avoid, list):
            raise ValueError(f"Avoid list for {name} must be a list.")
        avoid_list = [str(item) for item in avoid if str(item).strip()]
        people.append(
            Person(
                name=name,
                reading_level=reading_level,
                talkative=talkative,
                iep_front=iep_front,
                avoid=avoid_list,
            )
        )
    return people


def parse_people_table(raw_text: str) -> List[Person]:
    if not raw_text.strip():
        return []
    delimiter = "\t" if "\t" in raw_text else ","
    reader = csv.DictReader(io.StringIO(raw_text), delimiter=delimiter)
    if not reader.fieldnames:
        raise ValueError("People table must include headers.")
    required = {"name", "reading_level"}
    missing = required.difference({name.strip() for name in reader.fieldnames})
    if missing:
        raise ValueError("People table must include name and reading_level columns.")

    people: List[Person] = []
    for row in reader:
        name = str(row.get("name", "")).strip()
        if not name:
            continue
        reading_level = str(row.get("reading_level", "medium")).strip().lower()
        if reading_level not in {"low", "medium", "high"}:
            raise ValueError(f"Invalid reading_level for {name}.")
        talkative = _parse_bool(row.get("talkative"))
        iep_front = _parse_bool(row.get("iep_front"))
        avoid_raw = str(row.get("avoid", "")).strip()
        avoid_list = [item.strip() for item in avoid_raw.split(";") if item.strip()]
        people.append(
            Person(
                name=name,
                reading_level=reading_level,
                talkative=talkative,
                iep_front=iep_front,
                avoid=avoid_list,
            )
        )
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
