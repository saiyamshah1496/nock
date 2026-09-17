#!/usr/bin/env node
import { startMcpServer } from "./index.js";

startMcpServer().catch((err) => {
  console.error(err);
  process.exit(1);
});

