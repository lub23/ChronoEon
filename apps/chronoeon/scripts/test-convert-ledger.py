"""Synthetic-workbook tests; no personal workbook or live database is accessed."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import json
import subprocess
import sys
import unittest
from xml.sax.saxutils import escape
from zipfile import ZipFile

SCRIPT = Path(__file__).with_name("convert-ledger.py")
spec = importlib.util.spec_from_file_location("convert_ledger", SCRIPT)
converter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(converter)


def cell(address, value, formula=None):
    if isinstance(value, str):
        return f'<c r="{address}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
    return f'<c r="{address}">{"<f>" + escape(formula) + "</f>" if formula else ""}<v>{value}</v></c>'


def workbook(path, records=None):
    categories = [("收入", "工资"), ("饮食", "正餐"), ("消费", "日用"), ("外出", "交通"), ("健康", "看病"), ("人情", "礼物")]
    config = '<row r="1">' + ''.join(cell(f'{column}1', parent) for column, (parent, _) in zip("ABCDEF", categories)) + '</row>'
    config += '<row r="2">' + ''.join(cell(f'{column}2', child) for column, (_, child) in zip("ABCDEF", categories)) + '</row>'
    rows = '<row r="1">' + ''.join(cell(f'{column}1', value) for column, value in zip("ABCDEFGHIJ", converter.HEADERS)) + '</row>'
    records = records if records is not None else [
        [46266.52361111111, "Synthetic income", "收入", "工资", 123.45, "Cash", "Keep\nlines", "one tag", 2026, 9],
        [46267, "Synthetic expense", "饮食", "正餐", 23.45, "Cash", None, None, 2026, 9],
    ]
    for number, record in enumerate(records, 2):
        rows += f'<row r="{number}">' + ''.join(cell(f'{column}{number}', value, f'YEAR(A{number})' if column == "I" else f'MONTH(A{number})' if column == "J" else None) for column, value in zip("ABCDEFGHIJ", record) if value is not None) + '</row>'
    def sheet(contents):
        return '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + contents + '</sheetData></worksheet>'
    with ZipFile(path, "w") as archive:
        archive.writestr("xl/workbook.xml", '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="基本配置" r:id="rId1"/><sheet name="收支" r:id="rId2"/></sheets></workbook>')
        archive.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>')
        archive.writestr("xl/worksheets/sheet1.xml", sheet(config))
        archive.writestr("xl/worksheets/sheet2.xml", sheet(rows))


class ConverterTests(unittest.TestCase):
    def test_exact_cents_hidden_time_tags_and_unchanged_source(self):
        with TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic.xlsm"
            workbook(source)
            before = source.read_bytes()
            payload, report = converter.convert(source)
            self.assertEqual(before, source.read_bytes())
            self.assertEqual(payload["source"]["sha256"], hashlib.sha256(before).hexdigest())
            self.assertEqual(payload["summary"], {"count": 2, "incomeCount": 1, "expenseCount": 1, "incomeCents": 12345,
                                                 "expenseCents": 2345, "netCents": 10000, "firstDate": "2026-09-01", "lastDate": "2026-09-02"})
            self.assertEqual(payload["transactions"][0]["time"], "12:34")
            self.assertEqual(payload["transactions"][0]["tags"], ["one tag"])
            self.assertEqual(payload["transactions"][0]["note"], "Keep\nlines")
            self.assertEqual(report["timedTransactions"], 1)
            self.assertNotIn("Synthetic", json.dumps(report))

    def test_content_ids_survive_row_insertion_and_duplicates_are_not_dropped(self):
        with TemporaryDirectory() as folder:
            source = Path(folder) / "synthetic.xlsm"
            bill = [46267, "Synthetic", "饮食", "正餐", 23.45, "Cash", None, None, 2026, 9]
            workbook(source, [bill])
            first, _ = converter.convert(source)
            preceding = [46266, "Earlier", "收入", "工资", 100, "Cash", None, None, 2026, 9]
            workbook(source, [preceding, bill, bill])
            second, report = converter.convert(source)
            self.assertEqual(first["transactions"][0]["id"], second["transactions"][1]["id"])
            self.assertNotEqual(second["transactions"][1]["id"], second["transactions"][2]["id"])
            self.assertEqual(report["exactDuplicateGroups"], 1)
            self.assertEqual(second["summary"]["count"], 3)

    def test_stale_cache_invalid_category_and_fractional_cents_are_rejected(self):
        for column, value in [(8, 2025), (3, "Unknown"), (4, 1.001), (4, -1), (0, 46267.00001157407)]:
            with self.subTest(column=column, value=value), TemporaryDirectory() as folder:
                source = Path(folder) / "synthetic.xlsm"
                bill = [46267, "Synthetic confidential text", "饮食", "正餐", 23.45, "Cash", None, None, 2026, 9]
                bill[column] = value
                workbook(source, [bill])
                with self.assertRaises(converter.LedgerError) as error:
                    converter.convert(source)
                self.assertNotIn("Synthetic confidential text", str(error.exception))

    def test_private_output_is_exclusive_and_stdout_contains_only_aggregates(self):
        with TemporaryDirectory() as folder:
            source, output = Path(folder) / "synthetic.xlsm", Path(folder) / "private.json"
            workbook(source)
            command = [sys.executable, str(SCRIPT), str(source), "--output", str(output)]
            result = subprocess.run(command, capture_output=True, encoding="utf-8")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn("Synthetic", result.stdout)
            self.assertEqual(len(json.loads(output.read_text(encoding="utf-8"))["transactions"]), 2)
            before = output.read_bytes()
            self.assertNotEqual(subprocess.run(command, capture_output=True).returncode, 0)
            self.assertEqual(output.read_bytes(), before)
            with self.assertRaises(converter.LedgerError):
                converter.check_output_path(SCRIPT.parent / "private.json", source)


if __name__ == "__main__":
    unittest.main()
