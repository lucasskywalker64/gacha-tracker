import { zipSync, strToU8 } from "fflate";

export function createMockPaimonXlsx(
    sheets: Record<string, Array<Array<string | number>>>
): Buffer {
    const files: Record<string, Uint8Array> = {};
    const sharedStrings: string[] = ["Type", "Name", "Time", "Rarity"]; // Default headers

    // 1. Relationship XML
    let relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`;

    // 2. Workbook XML
    let workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>`;

    let sheetIdx = 1;
    for (const sheetName of Object.keys(sheets)) {
        const rId = `rId${sheetIdx}`;
        const target = `worksheets/sheet${sheetIdx}.xml`;
        relsXml += `<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/>`;
        workbookXml += `<sheet name="${sheetName}" sheetId="${sheetIdx}" r:id="${rId}"/>`;

        const rows = sheets[sheetName];
        let sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>`;

        // Add header row (skipped by parser)
        sheetXml += `<row r="1">
<c r="A1" t="s"><v>0</v></c>
<c r="B1" t="s"><v>1</v></c>
<c r="C1" t="s"><v>2</v></c>
<c r="D1" t="s"><v>3</v></c>
</row>`;

        let rowIdx = 2;
        for (const row of rows) {
            sheetXml += `<row r="${rowIdx}">`;

            const addCell = (col: string, val: string | number, isShared: boolean) => {
                if (isShared) {
                    let idx = sharedStrings.indexOf(String(val));
                    if (idx === -1) {
                        idx = sharedStrings.length;
                        sharedStrings.push(String(val));
                    }
                    return `<c r="${col}${rowIdx}" t="s"><v>${idx}</v></c>`;
                } else {
                    return `<c r="${col}${rowIdx}"><v>${val}</v></c>`;
                }
            };

            sheetXml += addCell("A", row[0], true); // Type
            sheetXml += addCell("B", row[1], true); // Name
            sheetXml += addCell("C", row[2], true); // Time
            sheetXml += addCell("D", row[3], false); // Rarity (numeric)

            sheetXml += `</row>`;
            rowIdx++;
        }

        sheetXml += `</sheetData></worksheet>`;
        files[`xl/worksheets/sheet${sheetIdx}.xml`] = strToU8(sheetXml);
        sheetIdx++;
    }

    relsXml += `</Relationships>`;
    workbookXml += `</sheets></workbook>`;

    files["xl/workbook.xml"] = strToU8(workbookXml);
    files["xl/_rels/workbook.xml.rels"] = strToU8(relsXml);

    // Shared Strings
    let sstXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">`;
    for (const str of sharedStrings) {
        const escaped = str
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
        sstXml += `<si><t>${escaped}</t></si>`;
    }
    sstXml += `</sst>`;
    files["xl/sharedStrings.xml"] = strToU8(sstXml);

    const zipped = zipSync(files);
    return Buffer.from(zipped);
}
