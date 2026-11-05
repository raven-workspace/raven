/*!
 * Raven built-in command library.
 * Commands adapted from oscp-notes-2026 by WattoCyber (https://gitlab.com/WattoCyber/oscp-notes-2026).
 * Copyright (c) 2026 SamsonCyber
 * @license MIT (https://opensource.org/license/mit)
 */
/**
 * Built-in command library: the one source of commands for every checklist goal.
 * Entries with source 'oscp-notes' are adapted from oscp-notes-2026 (MIT, notice above); entries with source
 * 'raven' come from Raven's own cheatsheets.
 *
 * Order matters: within a goal, the first command is the preferred one (penelope > nc, gobuster > ffuf,
 * ligolo-ng > chisel > ssh, nxc > crackmapexec, impacket-* > others), so files are concatenated in stage order.
 *
 * Matchers are conservative: a command gets `match` only when its binary and flags name the goal without
 * guessing. Commands whose success is an outcome (getting a shell, running an exploit) or whose flags are
 * shared by several goals (password sprays) carry no matcher: a missed tick is cheaper than a false one.
 */
import type { LibraryCommand } from '../types';
import { ENUM_COMMANDS } from './enum';
import { ENUM_SERVICE_COMMANDS } from './enumServices';
import { WEB_COMMANDS } from './web';
import { FOOTHOLD_COMMANDS } from './foothold';
import { WINDOWS_COMMANDS } from './windows';
import { LINUX_COMMANDS } from './linux';
import { LOOT_COMMANDS } from './loot';
import { PIVOT_COMMANDS } from './pivot';
import { AD_NOCREDS_DA_COMMANDS } from './ad';
import { AD_USER_COMMANDS } from './adUser';
import { AD_USER_PATH_COMMANDS } from './adUserPaths';
import { MISC_COMMANDS } from './misc';
import { FIELD_MANUAL_COMMANDS } from './fieldManual';

export const BUILTIN_LIBRARY: LibraryCommand[] = [
  ...ENUM_COMMANDS,
  ...ENUM_SERVICE_COMMANDS,
  ...WEB_COMMANDS,
  ...FOOTHOLD_COMMANDS,
  ...WINDOWS_COMMANDS,
  ...LINUX_COMMANDS,
  ...LOOT_COMMANDS,
  ...PIVOT_COMMANDS,
  ...AD_NOCREDS_DA_COMMANDS,
  ...AD_USER_COMMANDS,
  ...AD_USER_PATH_COMMANDS,
  ...MISC_COMMANDS,
  ...FIELD_MANUAL_COMMANDS,
];
