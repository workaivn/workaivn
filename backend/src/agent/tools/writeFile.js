import fs from "fs/promises";

export async function writeFileTool({
  path,
  content,
}) {

  await fs.writeFile(
    path,
    content,
    "utf8"
  );

  return {
    success: true,
  };

}