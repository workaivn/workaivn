export function normalizeToolPayload(parsed) {
  const toolName = String(parsed?.tool || "").toUpperCase();
  const rawArgs = (parsed && typeof parsed.args === "object" && parsed.args) ? parsed.args : {};
  const args = { ...rawArgs };

  if (toolName === "APPLY_PATCH") {
    args.file = args.file ?? parsed.file;
    args.find = args.find ?? parsed.find;
    args.replace = args.replace ?? parsed.replace;
  } else if (toolName === "READ_FILE") {
    args.path = args.path ?? parsed.path;
  } else if (toolName === "WRITE_FILE") {
    args.path = args.path ?? parsed.path;
    args.content = args.content ?? parsed.content;
  } else if (toolName === "VALIDATE_PATCH") {
    args.file = args.file ?? parsed.file;
  } else if (toolName === "RUN_TERMINAL") {
    args.command = args.command ?? parsed.command;
  }

  return { toolName, args };
}
