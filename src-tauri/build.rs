fn main() {
    // The content runtime is embedded via include_bytes! in lib.rs; rebuild
    // when `npm run build:runtime` regenerates it.
    println!("cargo:rerun-if-changed=resources/content-runtime.js");
    tauri_build::build();
}
