import { expect, it } from "vitest";
import { replacementPreview, applyReplacements } from "./bulkReplace";
import { draftToItem } from "@chronoeon/domain";
import { itemReplacementPreview, applyItemReplacements } from "./bulkReplace";
import type { Entry } from "@chronoeon/domain";
const entry: Entry = { id: "one", title: "北京之行", titleZh: "北京之行", note: "北京\n北京", location: "北京海淀", category: "work", kind: "event", date: "2026-10-28", color: "red", createdAt: "2026-10-28T00:00:00Z", tags: ["北京", "北京行"] };
it("previews every literal field occurrence without mutating originals", () => {
 const rows = replacementPreview([entry], "北京", "北京市");
 expect(rows).toHaveLength(6);
 const [change] = applyReplacements(rows);
 expect(change.before).toBe(entry);
 expect(change.after).toMatchObject({ title: "北京市之行", titleZh: "北京市之行", note: "北京市\n北京市", location: "北京市海淀", tags: ["北京市", "北京市行"] });
 expect(entry.location).toBe("北京海淀");
});
it("only changes selected fields and handles special characters literally", () => {
 expect(replacementPreview([{ ...entry, location: "[a].* [a].*" }], "[a].*", "$1", "location")[0].after).toBe("$1 $1");
 const rows = replacementPreview([entry], "北京", "北京市", "location");
 expect(rows).toHaveLength(1); expect(applyReplacements(rows)[0].after.title).toBe(entry.title);
 expect(replacementPreview([entry], "", "anything")).toEqual([]);
 expect(replacementPreview([entry], "北京", "北京")).toEqual([]);
});
it("applies original tag indices before empty removal and deduplication", () => {
 const [change] = applyReplacements(replacementPreview([{ ...entry, tags: ["北京", "北京行", "行"] }], "北京", "", "tags"));
 expect(change.after.tags).toEqual(["行"]);
});

it("includes matching asset fields while retaining bill links and item identity",()=>{
 const item=draftToItem({name:"北京相机",calendarId:"default",category:"electronics",acquisition:"gift",acquiredOn:"2026-10-28",acquiredAt:"09:00",cost:0,currency:"CNY",location:"北京",notes:"北京购入"});
 const rows=itemReplacementPreview([item],"北京","北京市");
 expect(rows).toHaveLength(3);const [change]=applyItemReplacements(rows);
 expect(change.after).toMatchObject({id:item.id,name:"北京市相机",location:"北京市",notes:"北京市购入",updatedAt:item.updatedAt});
 expect(item.location).toBe("北京");
});
