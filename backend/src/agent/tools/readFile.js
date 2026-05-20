import fs from "fs/promises";

export async function readFileTool({
  path,
}) {

  const content =
    await fs.readFile(
      path,
      "utf8"
    );

  return {
    success: true,
    content,
  };

}