import fs from "fs/promises";

export async function applyPatchTool({

  file,

  find,

  replace,

}) {

  const content =
    await fs.readFile(
      file,
      "utf8"
    );

  const updated =
    content.replace(
      find,
      replace
    );

  await fs.writeFile(
    file,
    updated,
    "utf8"
  );

  return {
    success: true,
  };

}