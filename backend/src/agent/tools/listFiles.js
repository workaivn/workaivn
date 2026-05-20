import fs from "fs/promises";

export async function listFilesTool({
  path,
}) {

  const files =
    await fs.readdir(path);

  return {
    success: true,
    files,
  };

}