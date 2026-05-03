// backend/src/config/plans.js

export const PLANS = {
  free: {
    name: "Free",
    price: 0,

    limits: {
      chatPerDay: 10,
      filePerDay: 3,
      imagePerDay: 2,
      toolPerDay: 5
    }
  },

  pro: {
    name: "Pro",
    price: 99000,

    limits: {
      chatPerDay: 200,
      filePerDay: 30,
      imagePerDay: 20,
      toolPerDay: 100
    }
  },

  business: {
    name: "Business",
    price: 499000,

    limits: {
      chatPerDay: 999999,
      filePerDay: 999999,
      imagePerDay: 999999,
      toolPerDay: 999999
    }
  }
};


/* helper */

export function getPlan(
  plan = "free"
) {
  return (
    PLANS[plan] ||
    PLANS.free
  );
}