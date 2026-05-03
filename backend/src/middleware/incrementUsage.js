// backend/src/middleware/incrementUsage.js

export async function incrementUsage(
  req,
  res,
  next
) {
  try {
    if (
      req.usageDoc &&
      req.usageType
    ) {
      req.usageDoc[
        req.usageType
      ] += 1;

      await req.usageDoc.save();
    }

    next();

  } catch (err) {
    next();
  }
}