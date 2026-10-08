import type { KeyboardEvent } from "react";

/**
 * 中文输入法正在选字：这时的回车 / Esc 是给输入法的，不能当成提交或取消。
 * WebKit 里确认选字的那次回车 isComposing 已经是 false，只能靠 keyCode 229 认出来。
 */
export const isComposing = (e: KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;
