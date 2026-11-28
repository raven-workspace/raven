//! Starting a shell in a PTY with its history on an inherited pipe (docs/specs/terminal.md §5.3).
//!
//! `portable-pty` opens the PTY, but its own spawn closes every descriptor above stderr in the child, which would
//! close the history pipe. So the child is started here instead, with the same steps portable-pty takes (a new
//! session, the PTY as controlling terminal, default signal handling), keeping exactly one extra descriptor:
//! `HISTORY_FD`, the read end of the pipe.

use std::fs::File;
use std::io::Write;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd, RawFd};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::process::CommandExt;
use std::process::{Child, Command};

use portable_pty::{MasterPty, PtySize, native_pty_system};

use super::shell::HISTORY_FD;
use super::{TerminalError, TerminalResult};

fn pty_error(error: impl std::fmt::Display) -> TerminalError {
    TerminalError::Pty(error.to_string())
}

/// A running shell: the PTY's master side and the child process.
pub struct Spawned {
    pub master: Box<dyn MasterPty + Send>,
    pub child: Child,
}

/// Start `cmd` in a new PTY of `cols` × `rows`. With `history`, the child can read those bytes from `HISTORY_FD`
/// until end of file; a thread writes them and closes the pipe.
pub fn spawn(mut cmd: Command, cols: u16, rows: u16, history: Option<Vec<u8>>) -> TerminalResult<Spawned> {
    let pair = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(pty_error)?;
    let tty = pair.master.tty_name().ok_or_else(|| pty_error("the PTY has no device name"))?;
    // std opens with close-on-exec; the child gets it only as its stdio.
    let slave = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOCTTY)
        .open(&tty)
        .map_err(pty_error)?;
    cmd.stdin(slave.try_clone().map_err(pty_error)?);
    cmd.stdout(slave.try_clone().map_err(pty_error)?);
    cmd.stderr(slave);

    let pipe = history.as_ref().map(|_| pipe()).transpose()?;
    let read_fd: Option<RawFd> = pipe.as_ref().map(|(read, _)| read.as_raw_fd());
    // SAFETY: the closure runs in the child between fork and exec and only calls async-signal-safe libc functions,
    // except the /dev/fd listing, which portable-pty's own spawn does the same way.
    unsafe {
        cmd.pre_exec(move || {
            for signal in [libc::SIGCHLD, libc::SIGHUP, libc::SIGINT, libc::SIGQUIT, libc::SIGTERM, libc::SIGALRM] {
                libc::signal(signal, libc::SIG_DFL);
            }
            let mut empty: libc::sigset_t = std::mem::zeroed();
            libc::sigemptyset(&mut empty);
            libc::sigprocmask(libc::SIG_SETMASK, &empty, std::ptr::null_mut());

            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            // stdin is the PTY's slave side by now: make it the controlling terminal.
            #[allow(clippy::cast_lossless)]
            if libc::ioctl(0, libc::TIOCSCTTY as _, 0) == -1 {
                return Err(std::io::Error::last_os_error());
            }
            if let Some(fd) = read_fd {
                if fd == HISTORY_FD {
                    let flags = libc::fcntl(fd, libc::F_GETFD);
                    libc::fcntl(fd, libc::F_SETFD, flags & !libc::FD_CLOEXEC);
                } else if libc::dup2(fd, HISTORY_FD) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
            }
            close_descriptors_above(if read_fd.is_some() { HISTORY_FD } else { 2 });
            Ok(())
        });
    }

    let child = cmd.spawn().map_err(pty_error)?;
    drop(pair.slave);

    if let (Some((read, write)), Some(bytes)) = (pipe, history) {
        // The child has its own copy; with ours closed, the child's is the only reader left.
        drop(read);
        std::thread::Builder::new()
            .name("raven-history-preload".into())
            .spawn(move || {
                let mut write = File::from(write);
                // A shell that exits before reading it all closes the pipe, and the write fails: nothing to do.
                let _ = write.write_all(&bytes);
            })
            .map_err(pty_error)?;
    }
    Ok(Spawned { master: pair.master, child })
}

/// A pipe whose two ends are both close-on-exec in this process.
fn pipe() -> TerminalResult<(OwnedFd, OwnedFd)> {
    let mut fds = [0 as RawFd; 2];
    // SAFETY: `fds` has room for the two descriptors pipe() writes.
    if unsafe { libc::pipe(fds.as_mut_ptr()) } == -1 {
        return Err(pty_error(std::io::Error::last_os_error()));
    }
    // SAFETY: pipe() just returned these descriptors, and nothing else owns them.
    let (read, write) = unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
    for fd in [&read, &write] {
        // SAFETY: fcntl on a descriptor this function owns.
        unsafe {
            let flags = libc::fcntl(fd.as_raw_fd(), libc::F_GETFD);
            libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, flags | libc::FD_CLOEXEC);
        }
    }
    Ok((read, write))
}

/// Close every descriptor above `keep` in the child, as portable-pty does, so the shell inherits nothing Raven
/// opened.
fn close_descriptors_above(keep: RawFd) {
    // macOS has /dev/fd as a directory of open descriptors; on Linux it links to /proc/self/fd.
    if let Ok(dir) = std::fs::read_dir("/dev/fd") {
        let fds: Vec<RawFd> = dir
            .filter_map(|entry| entry.ok()?.file_name().into_string().ok()?.parse().ok())
            .filter(|&fd| fd > keep)
            .collect();
        for fd in fds {
            // SAFETY: closing descriptors in the child just before exec.
            unsafe {
                libc::close(fd);
            }
        }
    }
}
