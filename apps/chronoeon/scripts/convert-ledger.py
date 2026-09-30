#!/usr/bin/env python3
"""Read a ledger workbook without Excel, macros, recalculation, or source writes.

Default/--check prints only aggregates. --output writes a private JSON payload
outside Git repositories using exclusive creation; transaction text is never
printed. Uses only Python's standard library.
"""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
from io import BytesIO
import json
import re
from pathlib import Path
import sys
import uuid
from zipfile import BadZipFile, ZipFile
import xml.etree.ElementTree as ET

NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
HEADERS = ["日期", "标题", "项目", "明细", "金额", "支付方式", "备注", "标签", "年", "月"]


class LedgerError(ValueError):
    pass


def parse_tags(value: str | None) -> list[str]:
    if not value:
        return []
    return [tag for tag in re.split(r"[,\s、，]+", value) if tag]


def rich_text(element: ET.Element | None) -> str | None:
    if element is None:
        return None
    return "".join(node.text or "" for node in [*element.findall("s:t", NS), *element.findall("s:r/s:t", NS)])


def convert(workbook: Path) -> tuple[dict, dict]:
    original = workbook.read_bytes()
    source_hash = hashlib.sha256(original).hexdigest()
    with ZipFile(BytesIO(original)) as archive:
        if sum(item.file_size for item in archive.infolist()) > 128 * 1024 * 1024:
            raise LedgerError("Workbook contents exceed 128 MiB")
        shared = [rich_text(item) for item in ET.fromstring(archive.read("xl/sharedStrings.xml"))] if "xl/sharedStrings.xml" in archive.namelist() else []

        def cell_value(cell: ET.Element) -> str | None:
            kind = cell.get("t")
            if kind == "e":
                raise LedgerError(f"Spreadsheet error at cell {cell.get('r')}")
            if kind == "inlineStr":
                return rich_text(cell.find("s:is", NS))
            value = cell.find("s:v", NS)
            if value is None or value.text is None:
                return None
            if kind == "s":
                try:
                    return shared[int(value.text)]
                except (ValueError, IndexError):
                    raise LedgerError("Invalid shared-string reference") from None
            return value.text

        book = ET.fromstring(archive.read("xl/workbook.xml"))
        props = book.find("s:workbookPr", NS)
        epoch = datetime(1904, 1, 1) if props is not None and props.get("date1904") in ("1", "true") else datetime(1899, 12, 30)
        links = {item.get("Id"): item.get("Target") for item in ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))}
        sheets = {}
        for sheet in book.findall("s:sheets/s:sheet", NS):
            target = links[sheet.get(f"{{{REL}}}id")]
            target = target.lstrip("/") if target.startswith("/") else "xl/" + target
            sheets[sheet.get("name")] = ET.fromstring(archive.read(target))
        if "基本配置" not in sheets or "收支" not in sheets:
            raise LedgerError("Required sheets 基本配置 and 收支 are missing")
        config_cells = {cell.get("r"): cell_value(cell) for cell in sheets["基本配置"].findall("s:sheetData/s:row/s:c", NS)}
        categories = []
        for column in "ABCDEF":
            name = config_cells.get(column + "1")
            if not name or "/" in name:
                raise LedgerError("Invalid primary category header")
            sub = [config_cells[f"{column}{row}"] for row in range(2, 1 + max(int(key[len(column):]) for key in config_cells if key.startswith(column))) if config_cells.get(f"{column}{row}")]
            if not sub or len(set(sub)) != len(sub) or any("/" in item for item in sub):
                raise LedgerError("Invalid subcategory catalog")
            categories.append({"id": "ledger-" + hashlib.sha256(name.encode("utf-8")).hexdigest()[:24], "name": name,
                               "direction": "income" if name == "收入" else "expense", "sub": sub})
        if len({category["name"] for category in categories}) != len(categories):
            raise LedgerError("Duplicate primary category headers")
        by_name = {category["name"]: category for category in categories}
        sheet_rows = sheets["收支"].findall("s:sheetData/s:row", NS)
        stale_date_caches = 0
        if not sheet_rows or [cell_value(cell) for cell in sheet_rows[0] if cell.get("r").rstrip("0123456789") in "ABCDEFGHIJ"] != HEADERS:
            raise LedgerError("Transaction columns do not match the supported workbook schema")
        transactions = []
        duplicates = Counter()
        timed = 0
        normalized_midnight = 0
        for row in sheet_rows[1:]:
            number = int(row.get("r"))
            cells = {cell.get("r").rstrip("0123456789"): cell for cell in row}
            values = {column: cell_value(cells[column]) if column in cells else None for column in "ABCDEFGHIJ"}
            if not any(value is not None for value in values.values()):
                continue
            if any(not values[column] or not values[column].strip() for column in "ABCDEF"):
                raise LedgerError(f"Missing required value at transaction row {number}")
            if any(cells[column].find("s:f", NS) is not None for column in "ABCDEFGH" if column in cells):
                raise LedgerError(f"Input formulas require explicit review at row {number}")
            category = by_name.get(values["C"])
            if category is None or values["D"] not in category["sub"]:
                raise LedgerError(f"Unknown category pair at row {number}")
            try:
                serial = Decimal(values["A"])
                if not serial.is_finite() or serial < 1:
                    raise InvalidOperation
                date = epoch + timedelta(days=int(serial))
                seconds = int(((serial % 1) * 86400).to_integral_value(rounding=ROUND_HALF_UP))
                if seconds >= 86400:
                    raise LedgerError(f"Ambiguous date precision at row {number}")
                if seconds % 60:
                    raise LedgerError(f"Sub-minute time cannot be represented without loss at row {number}")
                date += timedelta(seconds=seconds)
                amount = Decimal(values["E"])
                cents = amount * 100
                if not amount.is_finite() or cents != cents.to_integral_value() or cents <= 0 or cents > 2**53 - 1:
                    raise InvalidOperation
            except (InvalidOperation, ValueError, OverflowError):
                raise LedgerError(f"Invalid date or positive cent amount at row {number}") from None
            if values["I"] != str(date.year) or values["J"] != str(date.month):
                stale_date_caches += 1
            # Ledger rows are never all-day events. A workbook 00:00 is kept as a
            # real clock time and normalized to 01:00 so it remains visible in Day
            # view and cannot be mistaken for the absence of a start time.
            if date.hour == 0 and date.minute == 0:
                date += timedelta(hours=1)
                normalized_midnight += 1
            item = {"row": number, "date": date.date().isoformat(), "title": values["B"],
                    "categoryId": category["id"], "subcategory": values["D"], "amountCents": int(cents),
                    "payment": values["F"], "tags": parse_tags(values["H"]),
                    "time": date.strftime("%H:%M")}
            timed += 1
            if values["G"]:
                item["note"] = values["G"]
            # Workbook rows have no stable ID. Content + occurrence preserves
            # identities when earlier rows are inserted, without dropping genuine
            # identical transactions. Never match existing app bills heuristically.
            identity = json.dumps({key: value for key, value in item.items() if key != "row"}, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            occurrence = duplicates[identity]
            duplicates[identity] += 1
            item["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL, "app.chronoeon/ledger/" + identity + "/" + str(occurrence)))
            transactions.append(item)
        if not transactions:
            raise LedgerError("Refusing an empty ledger replacement")
        directions = {category["id"]: category["direction"] for category in categories}

        def summarize(rows: list[dict]) -> dict:
            income = [item for item in rows if directions[item["categoryId"]] == "income"]
            expense = [item for item in rows if directions[item["categoryId"]] == "expense"]
            received = sum(item["amountCents"] for item in income)
            spent = sum(item["amountCents"] for item in expense)
            return {"count": len(rows), "incomeCount": len(income), "expenseCount": len(expense), "incomeCents": received,
                    "expenseCents": spent, "netCents": received - spent,
                    "firstDate": min(item["date"] for item in rows), "lastDate": max(item["date"] for item in rows)}

        summary = summarize(transactions)
        payload = {"format": "chronoeon-ledger", "version": 1, "source": {"sha256": source_hash, "sheet": "收支"},
                   "currency": "CNY", "categories": categories, "transactions": transactions, "summary": summary}
        report = {"source": payload["source"], "summary": summary, "primaryCategories": len(categories),
                  "subcategories": sum(len(category["sub"]) for category in categories), "timedTransactions": timed,
                  "normalizedMidnight": normalized_midnight,
                  "staleDateCaches": stale_date_caches,
                  "exactDuplicateGroups": sum(count > 1 for count in duplicates.values()),
                  "monthly": {month: summarize([item for item in transactions if item["date"].startswith(month)]) for month in sorted({item["date"][:7] for item in transactions})}}
    # Ensure a concurrent spreadsheet edit did not race conversion.
    if hashlib.sha256(workbook.read_bytes()).hexdigest() != source_hash:
        raise LedgerError("Source workbook changed during conversion")
    return payload, report


def check_output_path(output: Path, workbook: Path) -> None:
    for source in (Path(__file__).resolve(), workbook.resolve()):
        for parent in source.parents:
            if (parent / ".git").exists() and output.is_relative_to(parent):
                raise LedgerError("Private import payload must be written outside Git repositories")
    if output == workbook.resolve():
        raise LedgerError("Cannot overwrite the source workbook")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="Validate and print only aggregate statistics (default)")
    mode.add_argument("--output", type=Path, help="Create a private JSON payload outside the repository; never overwrite an existing file")
    args = parser.parse_args()
    try:
        payload, report = convert(args.workbook)
        if args.output:
            output = args.output.resolve()
            check_output_path(output, args.workbook)
            with output.open("x", encoding="utf-8") as stream:
                json.dump(payload, stream, ensure_ascii=False, separators=(",", ":"))
                stream.write("\n")
            report["payloadWritten"] = True
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except LedgerError as error:
        print(str(error), file=sys.stderr)
    except (OSError, BadZipFile, ET.ParseError, KeyError, TypeError):
        print("Could not read the supported workbook or create a new private output file", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    raise SystemExit(main())
