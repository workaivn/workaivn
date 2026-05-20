import { exec }
  from "child_process";

export function searchCodeTool({
  query,
}) {

  return new Promise((resolve) => {

    exec(
      `rg "${query}" .`,
      (error, stdout, stderr) => {

        resolve({
          success: !error,
          stdout,
          stderr,
        });

      }
    );

  });

}