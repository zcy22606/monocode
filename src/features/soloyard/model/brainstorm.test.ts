import { describe, expect, it } from "vitest";
import { defaultFolderName, FOLDER_NAME, isBrainstormCwd } from "./brainstorm";

describe("头脑风暴", () => {
  it("默认文件夹名是开始时间", () => {
    expect(defaultFolderName(new Date(2026, 9, 5, 9, 7))).toBe("2026-10-05-0907");
  });
  it("工作区本身和它下面的子文件夹算头脑风暴（侧栏把工作区当「头脑风暴」项目）", () => {
    const root = "/Users/me/Library/Application Support/x/workspace";
    expect(isBrainstormCwd(`${root}/2026-10-05-0907`, root)).toBe(true);
    expect(isBrainstormCwd(`${root}/2026-10-05-0907/`, root)).toBe(true);
    expect(isBrainstormCwd(root, root)).toBe(true);
    expect(isBrainstormCwd(`${root}/`, root)).toBe(true);
    expect(isBrainstormCwd(`${root}-other/a`, root)).toBe(false);
    expect(isBrainstormCwd("/Users/me/code/app", root)).toBe(false);
    expect(isBrainstormCwd(`${root}/a`, null)).toBe(false);
  });
  it("文件夹名不允许空格和中文", () => {
    expect(FOLDER_NAME.test("xhs-assistant_v1.2")).toBe(true);
    expect(FOLDER_NAME.test("小红书")).toBe(false);
    expect(FOLDER_NAME.test("my app")).toBe(false);
  });
});
