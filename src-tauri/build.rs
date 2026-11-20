fn main() {
    #[cfg(target_os = "windows")]
    prefer_llvm_windres_if_path_has_spaces();

    tauri_build::build();
}

#[cfg(target_os = "windows")]
fn prefer_llvm_windres_if_path_has_spaces() {
    use std::env;
    use std::path::PathBuf;
    use std::process::{Command, Stdio};

    let out_dir = env::var_os("OUT_DIR").unwrap_or_default();
    let has_spaces = out_dir.to_string_lossy().contains(' ');
    if !has_spaces {
        return;
    }

    let is_llvm = |exe: &str| -> bool {
        Command::new(exe)
            .args(["-V"])
            .stdin(Stdio::null())
            .stderr(Stdio::null())
            .output()
            .map(|o| o.stdout.starts_with(b"llvm-windres"))
            .unwrap_or(false)
    };

    if is_llvm("windres") {
        return;
    }

    let Some(path_var) = env::var_os("PATH") else {
        return;
    };
    let dirs: Vec<PathBuf> = env::split_paths(&path_var).collect();
    if let Some(llvm_dir) = dirs
        .iter()
        .find(|dir| {
            let candidate = dir.join("windres.exe");
            candidate.is_file() && candidate.to_str().map(&is_llvm).unwrap_or(false)
        })
        .cloned()
    {
        let mut new_dirs = Vec::with_capacity(dirs.len() + 1);
        new_dirs.push(llvm_dir.clone());
        new_dirs.extend(dirs.into_iter().filter(|d| d != &llvm_dir));
        if let Ok(joined) = env::join_paths(new_dirs) {
            env::set_var("PATH", joined);
        }
    }
}
