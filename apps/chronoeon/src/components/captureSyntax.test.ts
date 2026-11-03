import { expect, it } from "vitest";
import { captureSyntaxGroups } from "./captureSyntax";
it("uses English priority and urgency tokens in the English cheatsheet", () => {
  const tokens=captureSyntaxGroups("en").flatMap(group => group.items.map(item => item.insert));
  expect(tokens).toContain("!high "); expect(tokens).toContain("!!high ");
  expect(tokens.every(token => !/[\p{Script=Han}]/u.test(token))).toBe(true);
});
