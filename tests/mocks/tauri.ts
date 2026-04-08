/**
 * Tauri command mock helpers for tests.
 *
 * Provides utilities to mock Tauri invoke() calls so tests
 * don't require a running Tauri backend.
 */
import { vi } from "vitest";

// -- Types matching src/lib/errors.ts (created in step 04) --

export interface TauriCommandError {
  message: string;
  command: string;
  path?: string;
}

export type FileResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TauriCommandError };

export type DialogResult =
  | { cancelled: false; path: string }
  | { cancelled: true };

// -- File read mocks --

export function mockReadFileSuccess(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    value: content,
  } satisfies FileResult<string>);
}

export function mockReadFileError(message: string, path?: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    error: { message, command: "read_file", path },
  } satisfies FileResult<string>);
}

// -- File write mocks --

export function mockWriteFileSuccess() {
  return vi.fn().mockResolvedValue({
    ok: true,
    value: undefined,
  } satisfies FileResult<void>);
}

export function mockWriteFileError(message: string, path?: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    error: { message, command: "write_file", path },
  } satisfies FileResult<void>);
}

// -- Dialog mocks --

export function mockDialogCancelled() {
  return vi.fn().mockResolvedValue({
    cancelled: true,
  } satisfies DialogResult);
}

export function mockDialogSuccess(path: string) {
  return vi.fn().mockResolvedValue({
    cancelled: false,
    path,
  } satisfies DialogResult);
}
