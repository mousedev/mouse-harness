/**
 * `Workspace` over the local machine.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { ExecOptions, ExecResult, Workspace } from "./workspace.js";

export interface LocalWorkspaceOptions {
  root: string;
  env?: NodeJS.ProcessEnv;
}

/** Exit code reported when a command is killed for exceeding its timeout. */
export const LOCAL_EXEC_TIMEOUT_CODE = 124;

export function localWorkspace(opts: LocalWorkspaceOptions): Workspace {
  const root = opts.root.replace(/\/+$/, "") || "/";
  const resolveCwd = (cwd?: string) => (cwd && existsSync(cwd) ? cwd : root);

  function run(file: string, argv: string[], execOpts?: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(file, argv, {
        cwd: resolveCwd(execOpts?.cwd),
        env: opts.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      child.stdout.on("data", (d) => {
        stdout += String(d);
      });
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      const timer = execOpts?.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, execOpts.timeoutMs)
        : null;
      const onAbort = () => child.kill("SIGKILL");
      execOpts?.signal?.addEventListener("abort", onAbort, { once: true });
      child.on("error", (e) => {
        if (timer) clearTimeout(timer);
        execOpts?.signal?.removeEventListener("abort", onAbort);
        reject(e);
      });
      child.on("close", (code) => {
        if (timer) clearTimeout(timer);
        execOpts?.signal?.removeEventListener("abort", onAbort);
        resolve({ stdout, stderr, code: timedOut ? LOCAL_EXEC_TIMEOUT_CODE : (code ?? 1) });
      });
    });
  }

  return {
    root,
    exec: (cmd, execOpts) => run("bash", ["-lc", cmd], execOpts),
  };
}
