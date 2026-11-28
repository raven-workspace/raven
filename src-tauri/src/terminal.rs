//! The terminal core's first piece (RAV-69, docs/adr/0003): a PTY from `portable-pty` whose bytes
//! feed a headless libghostty-vt terminal, which Raven reads back as plain text and OSC 133 marks.
//!
//! Only built with the `terminal` Cargo feature. The session manager and IPC (RAV-71) build on
//! this; nothing in the app calls it yet.
//!
//! A libghostty-vt `Terminal` is `!Send`: every call on one terminal must come from the thread
//! that made it. A session therefore owns its `Screen` on one thread and moves bytes to it.

use std::cell::RefCell;
use std::io::Read;
use std::rc::Rc;

use libghostty_vt::Terminal;
use libghostty_vt::effect::SemanticPromptKind;
use libghostty_vt::fmt::{Format, Formatter};
use libghostty_vt::point::{Coordinate, Point};
use libghostty_vt::screen::CellSemanticContent;
use portable_pty::{Child, CommandBuilder, PtySize, native_pty_system};

/// Scrollback kept per terminal. libghostty-vt's own default is 10,000 bytes, about one page.
pub const SCROLLBACK_MAX_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum TerminalError {
    #[error("libghostty-vt: {0:?}")]
    Vt(libghostty_vt::Error),
    #[error("pty: {0}")]
    Pty(String),
}

impl From<libghostty_vt::Error> for TerminalError {
    fn from(error: libghostty_vt::Error) -> Self {
        Self::Vt(error)
    }
}

pub type TerminalResult<T> = Result<T, TerminalError>;

/// One OSC 133 step, as the shell reported it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkKind {
    /// `133;A`: a prompt starts.
    PromptStart,
    /// `133;B`: the user can type.
    InputStart,
    /// `133;C`: the command runs; what follows is its output.
    OutputStart,
    /// `133;D`: the command finished.
    CommandEnd,
}

/// An OSC 133 mark with where the cursor was when it arrived.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mark {
    pub kind: MarkKind,
    /// Row in screen coordinates (scrollback included, 0 at the top of history), so it stays
    /// put as more output scrolls the screen.
    pub row: u32,
    /// The exit code a `133;D` carried, if any.
    pub exit_code: Option<i32>,
    /// The command line a `133;C` carried (`cmdline_url=`), decoded; empty if the shell sent none.
    pub command: Vec<u8>,
}

/// A row of the screen split by OSC 133 semantic content.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct SemanticRow {
    pub prompt: String,
    pub input: String,
    pub output: String,
}

/// A headless terminal: the state every Log entry and evidence text is read from.
pub struct Screen {
    terminal: Terminal<'static, 'static>,
    marks: Rc<RefCell<Vec<Mark>>>,
}

impl Screen {
    pub fn new(cols: u16, rows: u16) -> TerminalResult<Self> {
        let mut terminal = Terminal::new(cols, rows)?;
        terminal.set_scrollback_max_bytes(Some(SCROLLBACK_MAX_BYTES))?;
        let marks = Rc::new(RefCell::new(Vec::new()));
        let sink = Rc::clone(&marks);
        terminal.on_semantic_prompt(move |term, event| {
            // Runs inside vt_write, where a panic aborts the process: no unwraps here.
            let kind = match event.kind() {
                Ok(SemanticPromptKind::PromptStart) => MarkKind::PromptStart,
                Ok(SemanticPromptKind::InputStart) => MarkKind::InputStart,
                Ok(SemanticPromptKind::OutputStart) => MarkKind::OutputStart,
                Ok(SemanticPromptKind::CommandEnd) => MarkKind::CommandEnd,
                _ => return,
            };
            let history = term.scrollback_rows().unwrap_or(0);
            let cursor = usize::from(term.cursor_y().unwrap_or(0));
            sink.borrow_mut().push(Mark {
                kind,
                row: u32::try_from(history + cursor).unwrap_or(u32::MAX),
                exit_code: event.exit_code(),
                command: event.command().to_vec(),
            });
        })?;
        Ok(Self { terminal, marks })
    }

    /// Feed bytes from the PTY.
    pub fn feed(&mut self, bytes: &[u8]) {
        self.terminal.vt_write(bytes);
    }

    /// Every OSC 133 mark so far, oldest first.
    pub fn marks(&self) -> Vec<Mark> {
        self.marks.borrow().clone()
    }

    /// Rows in scrollback, above the active screen.
    pub fn scrollback_rows(&self) -> TerminalResult<usize> {
        Ok(self.terminal.scrollback_rows()?)
    }

    /// The whole screen, scrollback included, as plain text: no ANSI, trailing spaces trimmed,
    /// soft-wrapped lines joined.
    pub fn plain_text(&self) -> TerminalResult<String> {
        let mut formatter = Formatter::new(&self.terminal)?;
        formatter.set_format(Format::Plain)?.set_trim(true)?.set_unwrap(true)?;
        let bytes = formatter.format_alloc(None)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    }

    /// The plain-text output of the command whose output contains screen row `row`: everything
    /// from its `133;C` to its `133;D`, as libghostty-vt's own output selection finds it.
    pub fn command_output(&self, row: u32) -> TerminalResult<Option<String>> {
        let cell = self.terminal.grid_ref(Point::Screen(Coordinate { x: 0, y: row }))?;
        let Some(selection) = self.terminal.select_output(cell)? else {
            return Ok(None);
        };
        let mut formatter = Formatter::new(&self.terminal)?;
        formatter
            .set_format(Format::Plain)?
            .set_trim(true)?
            .set_unwrap(true)?
            .set_selection(Some(selection))?;
        let bytes = formatter.format_alloc(None)?;
        Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
    }

    /// Screen row `row`, split into the text each OSC 133 mark tagged as prompt, input or output.
    pub fn semantic_row(&self, row: u32) -> TerminalResult<SemanticRow> {
        let mut split = SemanticRow::default();
        let mut graphemes = ['\0'; 16];
        for x in 0..self.terminal.cols()? {
            let cell = self.terminal.grid_ref(Point::Screen(Coordinate { x, y: row }))?;
            let len = cell.graphemes(&mut graphemes)?;
            let text = if len == 0 { &[' '][..] } else { &graphemes[..len] };
            let target = match cell.cell()?.semantic_content()? {
                CellSemanticContent::Prompt => &mut split.prompt,
                CellSemanticContent::Input => &mut split.input,
                CellSemanticContent::Output => &mut split.output,
            };
            target.extend(text);
        }
        for part in [&mut split.prompt, &mut split.input, &mut split.output] {
            part.truncate(part.trim_end().len());
        }
        Ok(split)
    }
}

/// The user's login shell: `$SHELL -l`, or `/bin/sh -l` when `$SHELL` is unset. The shell
/// always comes from Rust, never from the webview (docs/specs/terminal.md §5).
pub fn login_shell() -> CommandBuilder {
    let shell = std::env::var_os("SHELL")
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| "/bin/sh".into());
    let mut command = CommandBuilder::new(shell);
    command.arg("-l");
    command
}

/// Run `command` in a new PTY of `cols` × `rows` and feed everything it prints into a fresh
/// `Screen` until it exits. Returns the screen and the exit status.
pub fn run_to_exit(
    command: CommandBuilder,
    cols: u16,
    rows: u16,
) -> TerminalResult<(Screen, portable_pty::ExitStatus)> {
    let pty = native_pty_system()
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|error| TerminalError::Pty(error.to_string()))?;
    let mut child: Box<dyn Child + Send + Sync> = pty
        .slave
        .spawn_command(command)
        .map_err(|error| TerminalError::Pty(error.to_string()))?;
    // Close our copy of the slave, so the reader sees end of file once the child exits.
    drop(pty.slave);
    let mut reader = pty
        .master
        .try_clone_reader()
        .map_err(|error| TerminalError::Pty(error.to_string()))?;

    let mut screen = Screen::new(cols, rows)?;
    let mut buf = [0u8; 8192];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => screen.feed(&buf[..n]),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            // Linux reports EIO, not end of file, once the child side closes.
            Err(_) => break,
        }
    }
    let status = child.wait().map_err(|error| TerminalError::Pty(error.to_string()))?;
    Ok((screen, status))
}
