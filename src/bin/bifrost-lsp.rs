use std::{env, path::PathBuf, process::ExitCode};

fn main() -> ExitCode {
    match run(env::args().skip(1).collect()) {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: Vec<String>) -> Result<(), String> {
    match args.first().map(String::as_str) {
        Some("pack-engine-profile") => {
            if args.len() != 1 {
                return Err("pack-engine-profile takes no arguments".into());
            }
            println!("{}", brokk_bifrost::open_pack_engine_profile());
            return Ok(());
        }
        Some("--version" | "-V") => {
            if args.len() != 1 {
                return Err("--version takes no arguments".into());
            }
            println!("bifrost-lsp {}", env!("CARGO_PKG_VERSION"));
            return Ok(());
        }
        Some("--help" | "-h") => {
            println!(
                "bifrost-lsp [--root PATH] [--lsp | --server lsp]\n\nUtilities:\n  pack-engine-profile  Print the exact linked engine profile as JSON\n  --version            Print the standalone server version"
            );
            return Ok(());
        }
        _ => {}
    }
    let mut root = env::current_dir().map_err(|error| format!("current directory: {error}"))?;
    let mut arguments = args.into_iter();
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--root" => {
                root = PathBuf::from(arguments.next().ok_or("--root requires a path")?);
            }
            "--lsp" => {}
            "--server" => {
                if arguments.next().as_deref() != Some("lsp") {
                    return Err("--server requires the mode lsp".into());
                }
            }
            unknown => return Err(format!("unknown argument `{unknown}`")),
        }
    }
    brokk_bifrost_lsp::run_lsp_stdio_server(root)
}
