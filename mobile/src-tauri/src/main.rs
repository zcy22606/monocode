// 桌面上直接跑手机端（调试用）；手机上走 lib.rs 的 mobile_entry_point。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    soloyard_mobile_lib::run()
}
