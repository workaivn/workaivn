import * as service from "./auth.service.js";

export async function register(req, res) {
  try {
    const { email, password } = req.body;
    await service.register(email, password);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.toString() });
  }
}

export async function login(req, res) {
  try {
    const { email, password } = req.body;
    const token = await service.login(email, password);
    res.json({ token });
  } catch (e) {
    res.status(400).json({ error: e.toString() });
  }
}