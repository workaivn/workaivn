import "dotenv/config";
import dns from "node:dns";

dns.setServers(["8.8.8.8", "1.1.1.1"]);
import mongoose from "mongoose";
import AiAgent from "../models/AiAgent.js";
import AiProvider from "../models/AiProvider.js";

async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const providerMap = new Map(
      (await AiProvider.find({})).map(p => [p.code, p._id])
    );

    const updates = [
      { code: "ollama_coder", update: { priority: 1000, isActive: true, agentType: "coding", providerId: providerMap.get("ollama") } },
      { code: "groq_coding", update: { priority: 35, isActive: true, agentType: "coding", providerId: providerMap.get("groq") } }
    ];

    for (const { code, update } of updates) {
      const res = await AiAgent.findOneAndUpdate(
        { code },
        { $set: update },
        { new: true }
      );
      console.log(res ? `✔ Updated ${code} -> priority=${res.priority}` : `• Agent not found: ${code}`);
    }

    const codingAgents = await AiAgent.find({ agentType: "coding", isActive: true }).populate("providerId").sort({ priority: 1 });
    console.log("\nOrdered fallback list (coding agents, by priority asc):");
    for (const a of codingAgents) {
      console.log(`- ${a.name} (${a.code}) provider=${a.providerId?.code} priority=${a.priority}`);
    }

    await mongoose.disconnect();
  } catch (err) {
    console.error("Update priorities failed:", err.message);
    process.exit(1);
  }
}

main();
