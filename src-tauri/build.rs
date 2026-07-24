fn main() {
    // The content runtime is embedded via include_bytes! in lib.rs; rebuild
    // when `npm run build:runtime` regenerates it. It is a git-ignored build
    // artifact, so a fresh checkout won't have it — `tauri dev`/`tauri build`
    // regenerate it (beforeDevCommand/beforeBuildCommand), but a bare
    // `cargo build` needs it prebuilt. Fail with the fix instead of a cryptic
    // include_bytes! "No such file" error.
    println!("cargo:rerun-if-changed=resources/content-runtime.js");
    if !std::path::Path::new("resources/content-runtime.js").exists() {
        panic!(
            "content runtime not built: run `npm run build:runtime` first \
             (or build via `npm run tauri dev` / `tauri build`, which do it for you)."
        );
    }
    tauri_build::build();
}
