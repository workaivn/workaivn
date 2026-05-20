import { exec }
  from "child_process";

export function runTerminalTool({
  command,
}) {

  return new Promise((resolve) => {

    exec(
      command,
      {
        timeout: 60000,
      },
      (
        error,
        stdout,
        stderr
      ) => {

        resolve({
          success: !error,
          stdout,
          stderr,
        });

      }
    );

  });

}