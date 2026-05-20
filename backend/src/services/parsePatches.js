export function parsePatches(
  text = ""
) {

  try {

    const start =
      text.indexOf("[");

    const end =
      text.lastIndexOf("]");

    if (
      start === -1 ||
      end === -1
    ) {

      return [];

    }

    const json =
      text.slice(
        start,
        end + 1
      );

    const patches =
      JSON.parse(json);

    if (
      !Array.isArray(
        patches
      )
    ) {

      return [];

    }

    return patches.filter(p =>

      p.file &&
      p.find &&
      p.replace

    );

  } catch {

    return [];

  }

}